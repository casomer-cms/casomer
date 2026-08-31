// Browser tests: the delivered site, served and driven in real Chromium.
// This is where TRANSITIONS stops being doctrine: the cookbook is the
// runtime's test plan, and hydration idempotence (DEVELOPMENT section 4)
// gets its browser-level proof. Run with npm run test:browser; these
// stay out of the default suite because they build the fixture and
// launch a browser.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';

import { buildSite } from '../src/compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../src/schema/loadPackage.ts';
import { startPreviewServer, type PreviewServer } from '../src/cli/previewServer.ts';

const fixtureRoot = fileURLToPath( new URL( '../fixtures/site-basic/', import.meta.url ) );

let browser: Browser;
let server: PreviewServer;

before( async () =>
{
    const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-browser-' ) );
    const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
    const result = await buildSite( {
        contentDirectory: join( fixtureRoot, 'content' ),
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

describe( 'alpine hydration on built pages', () =>
{
    it( 'boots Alpine against minified output: entities decode, state toggles', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );

        // The x-data seeded through { json } and entity encoding is live.
        const title = await page.evaluate(
            () => ( window as never as { Alpine: { $data ( el: Element ): { title: string } } } )
                .Alpine.$data( document.querySelector( 'article' ) as Element ).title,
        );

        assert.equal( title, 'Hello' );

        // The scrim is x-show bound to state; clicking the button flips it.
        // The scrim is an unstyled empty div in this CSS-less build, so
        // assert the mechanism x-show actually uses: the inline display.
        await page.waitForFunction( () => ( document.querySelector( '.scrim' ) as HTMLElement ).style.display === 'none' );
        await page.click( 'button' );
        await page.waitForFunction( () => ( document.querySelector( '.scrim' ) as HTMLElement ).style.display !== 'none' );
        await page.close();
    } );

    // Hydration idempotence (DEVELOPMENT section 4): booting Alpine must
    // not visibly change the static page, and the console stays silent.
    it( 'hydrates without console errors', async () =>
    {
        const page = await browser.newPage();
        const errors: string[] = [];

        page.on( 'console', ( message ) =>
        {
            if ( message.type() === 'error' ) { errors.push( message.text() ); }
        } );
        page.on( 'pageerror', ( error ) => errors.push( error.message ) );

        await page.goto( server.url );
        await page.waitForTimeout( 250 );

        // The stylesheet 404s by design in this build; everything else
        // must be clean.
        assert.deepEqual( errors.filter( ( text ) => !text.includes( '404' ) ), [] );
        await page.close();
    } );
} );

describe( 'tier 2 soft navigation', () =>
{
    it( 'swaps main without a full page load and updates title and URL', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () => { ( window as never as { casomerMarker: boolean } ).casomerMarker = true; } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForSelector( 'h2:has-text("About")' );

        const survived = await page.evaluate(
            () => ( window as never as { casomerMarker?: boolean } ).casomerMarker === true,
        );

        assert.equal( survived, true, 'the window survived, so no full navigation happened' );
        assert.equal( await page.title(), 'About' );
        await page.close();
    } );

    it( 'returns home on browser back, still without a full load', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () => { ( window as never as { casomerMarker: boolean } ).casomerMarker = true; } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForSelector( 'h2:has-text("About")' );
        await page.goBack();
        await page.waitForFunction( () => document.title === 'Home' );

        const survived = await page.evaluate(
            () => ( window as never as { casomerMarker?: boolean } ).casomerMarker === true,
        );

        assert.equal( survived, true );
        assert.equal( await page.title(), 'Home' );
        await page.close();
    } );

    it( 'falls back to real navigation when the destination cannot be fetched', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () =>
        {
            ( window as never as { casomerMarker: boolean } ).casomerMarker = true;

            const anchor = document.createElement( 'a' );

            anchor.href = '/missing/';
            anchor.textContent = 'ghost';
            anchor.id = 'ghost-link';
            document.querySelector( 'main' )?.append( anchor );
        } );
        await page.click( '#ghost-link' );
        await page.waitForURL( '**/missing/' );

        const survived = await page.evaluate(
            () => ( window as never as { casomerMarker?: boolean } ).casomerMarker === true,
        );

        assert.equal( survived, false, 'a real navigation replaced the window' );
        await page.close();
    } );

    it( 'gives reduced-motion visitors tier 1: plain navigation, Alpine intact', async () =>
    {
        const context = await browser.newContext( { reducedMotion: 'reduce' } );
        const page = await context.newPage();

        await page.goto( server.url );

        // Alpine conveniences stay: the button still toggles.
        await page.click( 'button' );
        await page.waitForFunction( () => ( document.querySelector( '.scrim' ) as HTMLElement ).style.display !== 'none' );

        await page.evaluate( () => { ( window as never as { casomerMarker: boolean } ).casomerMarker = true; } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );

        const survived = await page.evaluate(
            () => ( window as never as { casomerMarker?: boolean } ).casomerMarker === true,
        );

        assert.equal( survived, false, 'tier 1 is plain navigation' );
        await context.close();
    } );
} );
