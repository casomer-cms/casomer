#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire( import.meta.url );
const { version } = require( '../package.json' );

const commands = new Set( [ 'studio', 'save', 'build', 'preview', 'init', 'publish', 'credential' ] );
const command = process.argv[ 2 ];

if ( commands.has( command ) )
{
    const cliMain = fileURLToPath( new URL( '../src/cli/main.ts', import.meta.url ) );
    const result = spawnSync(
        process.execPath,
        [ '--experimental-strip-types', '--disable-warning=ExperimentalWarning', cliMain, ...process.argv.slice( 2 ) ],
        { stdio: 'inherit' },
    );

    process.exit( result.status ?? 1 );
}

console.log( `
  casomer v${version}

  The JSON-native CMS. Visual editing in, static sites out -
  with view transitions that make static feel alive.

  Commands so far:
    caso init [--remote url]
    caso studio [--content dir] [--port n] [--host host] [--token t] [--package dir] [--open]
    caso save
    caso build [--content dir] [--out dir] [--package dir] [--pretty]
    caso preview [--dir dir] [--port n]
    caso publish

  Follow along: https://casomer.com
` );
