// Page templates in the browser (SCHEMA 12.6, TRANSITIONS 2.8): soft
// navigation between pages on different templates swaps the chrome
// that changed along with the content, and leaves identical chrome
// alone. Built from the fixture with two templates, served, and driven
// in real Chromium.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';

import { buildSite } from '../src/compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../src/schema/loadPackage.ts';
import { startPreviewServer, type PreviewServer } from '../src/cli/previewServer.ts';
import { serializeCanonicalJson, type JsonValue } from '../src/content/canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../fixtures/site-basic/', import.meta.url ) );

let browser: Browser;
let server: PreviewServer;

const markdown = ( content: string ): Record<string, unknown> => ( { component: 'core/markdown', props: { content, width: 'prose' } } );

before( async () =>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-template-chrome-' ) );

    await cp( join( fixtureRoot, 'content' ), directory, { recursive: true } );

    const siteFile = join( directory, 'site.json' );
    const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

    site.templates = {
        default: { header: [ markdown( 'Site header.' ) ], blocks: [ { slot: 'content' } ], footer: [ markdown( 'Shared footer.' ) ] },
        landing: { header: [ markdown( 'Landing header.' ) ], blocks: [ { slot: 'content' } ], footer: [ markdown( 'Shared footer.' ) ] },
    };
    await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

    const pagesFile = join( directory, 'pages.json' );
    const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
    const home = document.pages.find( ( page ) => page.slug === 'home' );
    const about = document.pages.find( ( page ) => page.slug === 'about' );

    if ( home !== undefined ) { ( home.blocks as unknown[] ).push( markdown( '[Go about](/about/)' ) ); }
    if ( about !== undefined ) { about.template = 'landing'; }

    await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

    const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-template-chrome-out-' ) );
    const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
    const result = await buildSite( {
        contentDirectory: directory,
        outputDirectory,
        packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        css: false,
    } );

    assert.deepEqual( result.issues, [] );
    server = await startPreviewServer( outputDirectory );
    browser = await chromium.launch();
} );

after( async () =>
{
    await browser?.close();
    await server?.close();
} );

describe( 'template chrome across soft navigation', () =>
{
    it( 'swaps a changed header and keeps an identical footer element', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        assert.match( await page.textContent( 'body > header' ) ?? '', /Site header\./ );

        // A marker on window, and the footer element held by
        // reference: a full load would lose the first, a swap the
        // second.
        await page.evaluate( () =>
        {
            const scope = window as never as { probe: number; footerRef: Element | null };

            scope.probe = 1;
            scope.footerRef = document.querySelector( 'body > footer' );
        } );

        await page.click( 'a[href="/about/"]' );
        await page.waitForFunction( () => ( document.querySelector( 'body > header' )?.textContent ?? '' ).includes( 'Landing header.' ) );

        assert.equal( await page.evaluate( () => ( window as never as { probe: number } ).probe ), 1, 'the navigation was soft' );
        assert.equal(
            await page.evaluate( () => document.querySelector( 'body > footer' ) === ( window as never as { footerRef: Element | null } ).footerRef ),
            true,
            'identical chrome is the same element',
        );
        assert.match( await page.textContent( 'body > header' ) ?? '', /Landing header\./ );

        // And back: the default header returns.
        await page.goBack();
        await page.waitForFunction( () => ( document.querySelector( 'body > header' )?.textContent ?? '' ).includes( 'Site header.' ) );
        assert.equal( await page.evaluate( () => ( window as never as { probe: number } ).probe ), 1 );
        await page.close();
    } );
} );
