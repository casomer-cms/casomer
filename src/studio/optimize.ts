// Upload-time media optimization (SCHEMA 13.4, Mikey: "if we're
// storing images in a repo then I say we must optimize"). Images are
// downsized to the site's maxEdge and re-encoded as webp - ONE
// delivered file version, small enough that committing media stays
// reasonable. Codecs are the Squoosh lineage compiled to WebAssembly
// (@jsquash - Apache-2.0, vendable, no native binaries, nothing
// phones out), instantiated from files on disk. Anything that cannot
// or should not convert (SVG, GIF, documents, a decode failure)
// passes through untouched - optimization never blocks an upload.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode.js';
import resize, { initResize } from '@jsquash/resize';

export interface OptimizeSettings
{
    readonly maxEdge: number;
    readonly quality: number;
}

export interface OptimizedUpload
{
    readonly bytes: Buffer;
    readonly extension: string;
    readonly converted: boolean;
}

export const defaultMediaSettings: OptimizeSettings = { maxEdge: 2560, quality: 80 };

// The Squoosh codecs construct browser ImageData; Node has none, so
// a minimal spec-shaped stand-in fills the global before any codec
// runs. Guarded: a future Node that ships ImageData wins.
interface ImageDataLike
{
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
}

if ( ( globalThis as { ImageData?: unknown } ).ImageData === undefined )
{
    class NodeImageData
    {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;
        readonly colorSpace = 'srgb';

        constructor ( dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number )
        {
            if ( typeof dataOrWidth === 'number' )
            {
                this.width = dataOrWidth;
                this.height = widthOrHeight;
                this.data = new Uint8ClampedArray( dataOrWidth * widthOrHeight * 4 );
                return;
            }

            this.data = dataOrWidth;
            this.width = widthOrHeight;
            this.height = height ?? Math.floor( dataOrWidth.length / 4 / widthOrHeight );
        }
    }

    ( globalThis as { ImageData?: unknown } ).ImageData = NodeImageData;
}

const require = createRequire( import.meta.url );

async function compileWasm ( specifier: string ): Promise<WebAssembly.Module>
{
    return WebAssembly.compile( await readFile( require.resolve( specifier ) ) );
}

let codecs: Promise<void> | undefined;

function codecsReady (): Promise<void>
{
    // Node's V8 has had wasm SIMD on by default since 16.4, so the
    // simd encoder build is always the right pairing here (the
    // package's own init picks the simd glue after its own check).
    codecs = codecs ?? ( async () =>
    {
        await Promise.all( [
            compileWasm( '@jsquash/webp/codec/enc/webp_enc_simd.wasm' ).then( ( module ) => initWebpEncode( module ) ),
            compileWasm( '@jsquash/webp/codec/dec/webp_dec.wasm' ).then( ( module ) => initWebpDecode( module ) ),
            compileWasm( '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm' ).then( ( module ) => initJpegDecode( module ) ),
            compileWasm( '@jsquash/png/codec/pkg/squoosh_png_bg.wasm' ).then( ( module ) => initPngDecode( module ) ),
            compileWasm( '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm' ).then( ( module ) => initResize( module ) ),
        ] );
    } )();

    return codecs;
}

// EXIF orientation (tag 0x0112) from the JPEG's APP1 segment - the
// decoder hands back raw sensor orientation, and a sideways photo
// must not publish sideways. Anything unparsable reads as upright.
export function jpegOrientation ( bytes: Buffer ): number
{
    try
    {
        if ( bytes.length < 4 || bytes[ 0 ] !== 0xFF || bytes[ 1 ] !== 0xD8 ) { return 1; }

        let offset = 2;

        while ( offset + 4 <= bytes.length )
        {
            if ( bytes[ offset ] !== 0xFF ) { return 1; }

            const marker = bytes[ offset + 1 ] as number;

            if ( marker === 0xDA || marker === 0xD9 ) { return 1; }

            const size = bytes.readUInt16BE( offset + 2 );

            if ( marker === 0xE1 && offset + 10 <= bytes.length && bytes.toString( 'latin1', offset + 4, offset + 10 ) === 'Exif\0\0' )
            {
                const tiff = offset + 10;
                const little = bytes.toString( 'latin1', tiff, tiff + 2 ) === 'II';
                const read16 = ( at: number ): number => ( little ? bytes.readUInt16LE( at ) : bytes.readUInt16BE( at ) );
                const read32 = ( at: number ): number => ( little ? bytes.readUInt32LE( at ) : bytes.readUInt32BE( at ) );
                const ifd = tiff + read32( tiff + 4 );
                const count = read16( ifd );

                for ( let entry = 0; entry < count; entry += 1 )
                {
                    const at = ifd + 2 + entry * 12;

                    if ( at + 10 > bytes.length ) { return 1; }

                    if ( read16( at ) === 0x0112 )
                    {
                        const value = read16( at + 8 );

                        return value >= 1 && value <= 8 ? value : 1;
                    }
                }

                return 1;
            }

            offset += 2 + size;
        }

        return 1;
    }
    catch
    {
        return 1;
    }
}

function applyOrientation ( image: ImageDataLike, orientation: number ): ImageDataLike
{
    if ( orientation <= 1 || orientation > 8 ) { return image; }

    const { width, height } = image;
    const swap = orientation >= 5;
    const outWidth = swap ? height : width;
    const outHeight = swap ? width : height;
    const source = new Uint32Array( image.data.buffer, image.data.byteOffset, width * height );
    const target = new Uint32Array( outWidth * outHeight );

    for ( let y = 0; y < height; y += 1 )
    {
        for ( let x = 0; x < width; x += 1 )
        {
            let tx = x;
            let ty = y;

            if ( orientation === 2 ) { tx = width - 1 - x; }

            if ( orientation === 3 )
            {
                tx = width - 1 - x;
                ty = height - 1 - y;
            }

            if ( orientation === 4 ) { ty = height - 1 - y; }

            if ( orientation === 5 )
            {
                tx = y;
                ty = x;
            }

            if ( orientation === 6 )
            {
                tx = height - 1 - y;
                ty = x;
            }

            if ( orientation === 7 )
            {
                tx = height - 1 - y;
                ty = width - 1 - x;
            }

            if ( orientation === 8 )
            {
                tx = y;
                ty = width - 1 - x;
            }

            target[ ty * outWidth + tx ] = source[ y * width + x ] as number;
        }
    }

    const Constructor = ( globalThis as unknown as { ImageData: new ( data: Uint8ClampedArray, width: number, height: number ) => ImageDataLike } ).ImageData;

    return new Constructor( new Uint8ClampedArray( target.buffer ), outWidth, outHeight );
}

function fitWithin ( width: number, height: number, maxEdge: number ): { width: number; height: number } | null
{
    const longest = Math.max( width, height );

    if ( longest <= maxEdge ) { return null; }

    const scale = maxEdge / longest;

    return {
        width: Math.max( 1, Math.round( width * scale ) ),
        height: Math.max( 1, Math.round( height * scale ) ),
    };
}

function toArrayBuffer ( bytes: Buffer ): ArrayBuffer
{
    return bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) as ArrayBuffer;
}

export async function optimizeUpload (
    bytes: Buffer,
    extension: string,
    settings: OptimizeSettings = defaultMediaSettings,
): Promise<OptimizedUpload>
{
    const kind = extension.toLowerCase();

    if ( ![ '.jpg', '.jpeg', '.png', '.webp' ].includes( kind ) )
    {
        return { bytes, extension, converted: false };
    }

    try
    {
        await codecsReady();

        let image: ImageDataLike;

        if ( kind === '.png' ) { image = await decodePng( toArrayBuffer( bytes ) ) as ImageDataLike; }
        else if ( kind === '.webp' ) { image = await decodeWebp( toArrayBuffer( bytes ) ) as ImageDataLike; }
        else
        {
            image = await decodeJpeg( toArrayBuffer( bytes ) ) as ImageDataLike;
            image = applyOrientation( image, jpegOrientation( bytes ) );
        }

        const target = fitWithin( image.width, image.height, settings.maxEdge );

        // An in-bounds webp is already the delivered shape.
        if ( kind === '.webp' && target === null )
        {
            return { bytes, extension, converted: false };
        }

        const resized = target === null
            ? image
            : await resize( image as never, { width: target.width, height: target.height } ) as unknown as ImageDataLike;
        const encoded = Buffer.from( await encodeWebp( resized as never, { quality: settings.quality } ) );

        // A downsize always wins; at equal dimensions only a smaller
        // file does - a tiny PNG icon can out-compress its webp.
        if ( target === null && encoded.length >= bytes.length )
        {
            return { bytes, extension, converted: false };
        }

        return { bytes: encoded, extension: '.webp', converted: true };
    }
    catch
    {
        return { bytes, extension, converted: false };
    }
}
