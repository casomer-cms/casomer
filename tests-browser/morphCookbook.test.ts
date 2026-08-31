// The cookbook as a test plan (TRANSITIONS section 3): name hygiene
// (2.1), stillness under capture (2.3), and persistent chrome (2.8),
// exercised against the built fixture in real Chromium. The fixture's
// card renders on both pages with data-morph="card-photo", so home to
// about is a paired morph.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

import { buildSite } from '../src/compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../src/schema/loadPackage.ts';
import { startPreviewServer, type PreviewServer } from '../src/cli/previewServer.ts';

const fixtureRoot = fileURLToPath( new URL( '../fixtures/site-basic/', import.meta.url ) );

let browser: Browser;
let server: PreviewServer;

interface LastTransition
{
    names: string[];
    sweptStale: number;
}

const lastTransition = ( page: Page ): Promise<LastTransition | null> =>
    page.evaluate( () => ( window as never as { casomer: { lastTransition: LastTransition | null } } ).casomer.lastTransition );

const inlineNamesInMain = ( page: Page ): Promise<number> =>
    page.evaluate( () => document.querySelectorAll( 'main [style*="view-transition-name"]' ).length );

before( async () =>
{
    const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-cookbook-' ) );
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

describe( 'name hygiene (cookbook 2.1)', () =>
{
    it( 'pairs the card photo across pages and clears every name after landing', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForFunction(
            () => ( window as never as { casomer: { lastTransition: unknown } } ).casomer.lastTransition !== null,
        );

        assert.deepEqual( ( await lastTransition( page ) )?.names, [ 'card-photo' ] );
        assert.equal( await inlineNamesInMain( page ), 0, 'names are ephemeral dressing, never resting state' );
        await page.close();
    } );

    it( 'sweeps stale names before setting any', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () =>
        {
            const straggler = document.createElement( 'div' );

            straggler.style.viewTransitionName = 'left-over-from-a-lightbox';
            document.querySelector( 'main' )?.append( straggler );
        } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForFunction(
            () => ( window as never as { casomer: { lastTransition: unknown } } ).casomer.lastTransition !== null,
        );

        const transition = await lastTransition( page );

        assert.equal( transition?.sweptStale, 1 );
        assert.equal( await inlineNamesInMain( page ), 0 );
        await page.close();
    } );

    it( 'names only one element when a morph name is duplicated', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () =>
        {
            const duplicate = document.createElement( 'span' );

            duplicate.setAttribute( 'data-morph', 'card-photo' );
            document.querySelector( 'main' )?.append( duplicate );
        } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForFunction(
            () => ( window as never as { casomer: { lastTransition: unknown } } ).casomer.lastTransition !== null,
        );

        assert.deepEqual( ( await lastTransition( page ) )?.names, [ 'card-photo' ] );
        await page.close();
    } );
} );

describe( 'stillness under capture (cookbook 2.3)', () =>
{
    it( 'freezes during the transition and unfreezes after', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () =>
        {
            const seen: boolean[] = [];

            ( window as never as { casomerFreezeLog: boolean[] } ).casomerFreezeLog = seen;
            new MutationObserver( () =>
            {
                seen.push( document.documentElement.classList.contains( 'casomer-vt' ) );
            } ).observe( document.documentElement, { attributes: true, attributeFilter: [ 'class' ] } );
        } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForFunction(
            () => ( window as never as { casomer: { lastTransition: unknown } } ).casomer.lastTransition !== null,
        );

        const log = await page.evaluate(
            () => ( window as never as { casomerFreezeLog: boolean[] } ).casomerFreezeLog,
        );

        assert.ok( log.includes( true ), 'the freeze class appeared during the transition' );
        assert.equal(
            await page.evaluate( () => document.documentElement.classList.contains( 'casomer-vt' ) ),
            false,
            'and is gone once the transition finishes',
        );
        await page.close();
    } );
} );

describe( 'persistent chrome (cookbook 2.8)', () =>
{
    it( 'keeps chrome names stable and the elements themselves across navigations', async () =>
    {
        const page = await browser.newPage();

        await page.goto( server.url );
        await page.evaluate( () =>
        {
            ( document.querySelector( 'header' ) as HTMLElement ).dataset.sameElement = 'yes';
        } );
        await page.click( 'a[href="/about/"]' );
        await page.waitForURL( '**/about/' );
        await page.waitForFunction(
            () => ( window as never as { casomer: { lastTransition: unknown } } ).casomer.lastTransition !== null,
        );

        const chrome = await page.evaluate( () => ( {
            headerName: ( document.querySelector( 'header' ) as HTMLElement ).style.viewTransitionName,
            footerName: ( document.querySelector( 'footer' ) as HTMLElement ).style.viewTransitionName,
            sameElement: ( document.querySelector( 'header' ) as HTMLElement ).dataset.sameElement,
        } ) );

        assert.equal( chrome.headerName, 'casomer-header' );
        assert.equal( chrome.footerName, 'casomer-footer' );
        assert.equal( chrome.sameElement, 'yes', 'chrome is never re-rendered; only main swaps' );
        await page.close();
    } );
} );
