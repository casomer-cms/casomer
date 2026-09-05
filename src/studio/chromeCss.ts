// The chrome's stylesheet, prebuilt for the published package
// (DEVELOPMENT: chrome styling). In development the chrome compiles
// its Tailwind in the browser from the <style type="text/tailwindcss">
// block in index.html, so a new utility class works the moment it is
// typed. At npm-publish time this module compiles that same block,
// plus every class the chrome's markup and script use, into
// studio/app/chrome.css; the server then serves index.html with the
// browser compiler swapped for one <link>. Same source, one build.
//
// Known limit, accepted: a class composed at runtime from strings
// that never appears literally in index.html or app.js is not in
// the prebuilt sheet. Keep class names literal in the source.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify( execFile );

export const chromeDirectory = fileURLToPath( new URL( '../../studio/app/', import.meta.url ) );

const styleOpen = '<style type="text/tailwindcss">';
const styleClose = '</style>';
const compilerTag = '<script src="/vendor/tailwind.js"></script>';

// The Tailwind block as written in index.html.
export function extractChromeTailwind ( html: string ): string
{
    const start = html.indexOf( styleOpen );

    if ( start === -1 ) { throw new Error( 'index.html has no text/tailwindcss style block.' ); }

    const end = html.indexOf( styleClose, start );

    if ( end === -1 ) { throw new Error( 'index.html\'s text/tailwindcss style block never closes.' ); }

    return html.slice( start + styleOpen.length, end );
}

// index.html as the published package serves it: no browser
// compiler, the prebuilt sheet linked where the block stood.
export function chromeWithoutCompiler ( html: string, href = '/chrome.css' ): string
{
    const start = html.indexOf( styleOpen );
    const end = start === -1 ? -1 : html.indexOf( styleClose, start );

    if ( start === -1 || end === -1 ) { return html; }

    const linked = `${html.slice( 0, start )}<link rel="stylesheet" href="${href}">${html.slice( end + styleClose.length )}`;

    return linked.replace( `${compilerTag}\n`, '' ).replace( compilerTag, '' );
}

function resolveTailwind (): { entry: string; cli: string }
{
    const require = createRequire( import.meta.url );
    const entry = join( dirname( require.resolve( 'tailwindcss/package.json' ) ), 'index.css' ).replaceAll( '\\', '/' );
    const packageFile = require.resolve( '@tailwindcss/cli/package.json' );
    const binField = ( require( '@tailwindcss/cli/package.json' ) as { bin: Record<string, string> | string } ).bin;
    const binPath = typeof binField === 'string' ? binField : Object.values( binField )[ 0 ] as string;

    return { entry, cli: join( dirname( packageFile ), binPath ) };
}

export interface ChromeCssBuild
{
    readonly output: string;
    readonly bytes: number;
}

// Compile the chrome's sheet. The source CSS is written beside
// index.html for the moment of the build so @source paths stay
// relative, then removed.
export async function buildChromeCss ( output = join( chromeDirectory, 'chrome.css' ) ): Promise<ChromeCssBuild>
{
    const html = await readFile( join( chromeDirectory, 'index.html' ), 'utf8' );
    const { entry, cli } = resolveTailwind();
    const source = join( chromeDirectory, 'chrome.source.css' );
    const css = `@import "${entry}";\n@source "./index.html";\n@source "./app.js";\n@source "./strings.js";\n${extractChromeTailwind( html )}\n`;

    await writeFile( source, css, 'utf8' );

    try
    {
        await run( process.execPath, [ cli, '--input', source, '--output', output, '--minify' ], { cwd: chromeDirectory } );
    }
    finally
    {
        await rm( source, { force: true } );
    }

    const built = await readFile( output, 'utf8' );

    return { output, bytes: Buffer.byteLength( built ) };
}

// npm run chrome:build
if ( process.argv[ 1 ] !== undefined && pathToFileURL( resolve( process.argv[ 1 ] ) ).href === import.meta.url )
{
    const result = await buildChromeCss();

    console.log( `built ${result.output} (${Math.round( result.bytes / 1024 )} KB)` );
}
