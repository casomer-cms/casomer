// The chrome's prebuilt stylesheet (DEVELOPMENT: chrome styling): the
// Tailwind block lifts out of index.html, the served index swaps the
// browser compiler for one link, and the build compiles the block
// plus the chrome's own classes into a real sheet.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildChromeCss, chromeWithoutCompiler, extractChromeTailwind } from './chromeCss.ts';

const sample = `<head>
    <script src="/vendor/tailwind.js"></script>
    <style type="text/tailwindcss">
        @theme { --color-amber: #E8A13D; }
    </style>
    <style>body { margin: 0; }</style>
</head>`;

describe( 'the chrome stylesheet', () =>
{
    let scratch: string | undefined;

    after( async () =>
    {
        if ( scratch !== undefined ) { await rm( scratch, { recursive: true, force: true } ); }
    } );

    it( 'lifts the Tailwind block out of the page', () =>
    {
        assert.match( extractChromeTailwind( sample ), /@theme \{ --color-amber: #E8A13D; \}/ );
        assert.throws( () => extractChromeTailwind( '<head></head>' ), /no text\/tailwindcss/ );
    } );

    it( 'serves the page with a link where the compiler stood', () =>
    {
        const served = chromeWithoutCompiler( sample );

        assert.equal( served.includes( '/vendor/tailwind.js' ), false );
        assert.equal( served.includes( 'text/tailwindcss' ), false );
        assert.match( served, /<link rel="stylesheet" href="\/chrome\.css">/ );
        assert.match( served, /<style>body \{ margin: 0; \}<\/style>/ );
        assert.equal( chromeWithoutCompiler( '<p>plain</p>' ), '<p>plain</p>' );
    } );

    it( 'builds a sheet carrying the chrome\'s tokens and utilities', async () =>
    {
        scratch = await mkdtemp( join( tmpdir(), 'casomer-chrome-css-' ) );

        const output = join( scratch, 'chrome.css' );
        const result = await buildChromeCss( output );
        const css = await readFile( output, 'utf8' );

        assert.equal( result.output, output );
        assert.ok( result.bytes > 20_000, `sheet is ${result.bytes} bytes` );
        assert.match( css, /--color-amber:/ );
        assert.match( css, /\.bg-amber\b/ );
        assert.match( css, /\.rounded-xl\b/ );
        assert.equal( css.includes( '@source' ), false );
    } );
} );
