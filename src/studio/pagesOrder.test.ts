// The pages table's drag (SCHEMA 13.6): one write carries the whole
// order and every page's parent. Home stays first and the reserved
// 404 last, neither takes a parent nor grants one, the tree never
// loops, and a file still lacking the 404 gets it in the same write.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { NOT_FOUND_PAGE_ID } from '../content/loadSiteDirectory.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

type PageRecord = { id: string; slug: string; parent?: string };

describe( 'the page order route', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let home: PageRecord;
    let about: PageRecord;

    const put = async ( pages: { id: string; parent?: string }[] ): Promise<Response> => fetch( `${base}/api/pages-order?t=${server.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( { pages } ),
    } );
    const pagesJson = async (): Promise<PageRecord[]> => ( JSON.parse( await readFile( join( contentDirectory, 'pages.json' ), 'utf8' ) ) as { pages: PageRecord[] } ).pages;
    const snapshotPages = async (): Promise<PageRecord[]> => ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: PageRecord[] } ).pages;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-order-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;

        const pages = await snapshotPages();

        home = pages.find( ( page ) => page.slug === 'home' ) as PageRecord;
        about = pages.find( ( page ) => page.slug === 'about' ) as PageRecord;
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'writes the order with parents, materializing the 404 into a file that lacked it', async () =>
    {
        assert.equal( ( await pagesJson() ).some( ( page ) => page.slug === '404' ), false, 'the fixture file has no 404 yet' );

        const nested = await put( [ { id: home.id }, { id: about.id }, { id: NOT_FOUND_PAGE_ID } ] );

        assert.equal( nested.status, 200 );

        const written = await pagesJson();

        assert.deepEqual( written.map( ( page ) => page.slug ), [ 'home', 'about', '404' ] );
        assert.equal( written.find( ( page ) => page.slug === '404' )?.id, NOT_FOUND_PAGE_ID );
    } );

    it( 'refuses a parent on home or the 404, a parent that is home or the 404, and a loop', async () =>
    {
        const homeParented = await put( [ { id: home.id, parent: about.id }, { id: about.id }, { id: NOT_FOUND_PAGE_ID } ] );
        const underHome = await put( [ { id: home.id }, { id: about.id, parent: home.id }, { id: NOT_FOUND_PAGE_ID } ] );
        const under404 = await put( [ { id: home.id }, { id: about.id, parent: NOT_FOUND_PAGE_ID }, { id: NOT_FOUND_PAGE_ID } ] );
        const self = await put( [ { id: home.id }, { id: about.id, parent: about.id }, { id: NOT_FOUND_PAGE_ID } ] );

        assert.equal( homeParented.status, 400 );
        assert.equal( underHome.status, 400 );
        assert.equal( under404.status, 400 );
        assert.equal( self.status, 400 );
        assert.equal( ( await pagesJson() ).find( ( page ) => page.slug === 'about' )?.parent, undefined, 'nothing landed' );
    } );

    it( 'keeps home first and the 404 last, and wants every page exactly once', async () =>
    {
        const aboutFirst = await put( [ { id: about.id }, { id: home.id }, { id: NOT_FOUND_PAGE_ID } ] );
        const notFoundEarly = await put( [ { id: home.id }, { id: NOT_FOUND_PAGE_ID }, { id: about.id } ] );
        const missing = await put( [ { id: home.id }, { id: about.id } ] );
        const doubled = await put( [ { id: home.id }, { id: about.id }, { id: about.id } ] );

        assert.equal( aboutFirst.status, 400 );
        assert.equal( notFoundEarly.status, 400 );
        assert.equal( missing.status, 400 );
        assert.equal( doubled.status, 400 );
    } );
} );
