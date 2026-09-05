// Test support: a real, deterministic PNG built by hand (no encoder
// dependency), for the optimizer and the avatar route.

import { deflateSync } from 'node:zlib';

function crc32 ( bytes: Buffer ): number
{
    let crc = 0xFFFFFFFF;

    for ( const byte of bytes )
    {
        crc ^= byte;

        for ( let bit = 0; bit < 8; bit += 1 )
        {
            crc = ( crc >>> 1 ) ^ ( 0xEDB88320 & -( crc & 1 ) );
        }
    }

    return ( crc ^ 0xFFFFFFFF ) >>> 0;
}

function pngChunk ( type: string, data: Buffer ): Buffer
{
    const length = Buffer.alloc( 4 );

    length.writeUInt32BE( data.length );

    const body = Buffer.concat( [ Buffer.from( type, 'latin1' ), data ] );
    const crc = Buffer.alloc( 4 );

    crc.writeUInt32BE( crc32( body ) );
    return Buffer.concat( [ length, body, crc ] );
}

export function makePng ( width: number, height: number ): Buffer
{
    const header = Buffer.alloc( 13 );

    header.writeUInt32BE( width, 0 );
    header.writeUInt32BE( height, 4 );
    header[ 8 ] = 8; // bit depth
    header[ 9 ] = 6; // RGBA
    header[ 10 ] = 0;
    header[ 11 ] = 0;
    header[ 12 ] = 0;

    const raw = Buffer.alloc( height * ( width * 4 + 1 ) );

    for ( let y = 0; y < height; y += 1 )
    {
        const row = y * ( width * 4 + 1 );

        for ( let x = 0; x < width; x += 1 )
        {
            // A gradient, so the encoder has real work to do.
            raw[ row + 1 + x * 4 ] = x % 256;
            raw[ row + 2 + x * 4 ] = y % 256;
            raw[ row + 3 + x * 4 ] = ( x + y ) % 256;
            raw[ row + 4 + x * 4 ] = 255;
        }
    }

    return Buffer.concat( [
        Buffer.from( [ 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A ] ),
        pngChunk( 'IHDR', header ),
        pngChunk( 'IDAT', deflateSync( raw ) ),
        pngChunk( 'IEND', Buffer.alloc( 0 ) ),
    ] );
}
