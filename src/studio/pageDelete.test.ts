// Deleting a parent page (Mikey, 2026-09-02): its children - pages
// and mounted collections - rise one level, to where it was.

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

describe( 'deleting a parent page', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const pagesJson = async (): Promise<PageRecord[]> => ( JSON.parse( await readFile( join( contentDirectory, 'pages.json' ), 'utf8' ) ) as { pages: PageRecord[] } ).pages;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-page-delete-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'lifts child pages and a mounted collection to the deleted page\'s level', async () =>
    {
        const about = ( await pagesJson() ).find( ( page ) => page.slug === 'about' ) as PageRecord;
        const middle = await ( await call( '/api/page', { title: 'Middle' } ) ).json() as { id: string };
        const leaf = await ( await call( '/api/page', { title: 'Leaf' } ) ).json() as { id: string };
        const home = ( await pagesJson() ).find( ( page ) => page.slug === 'home' ) as PageRecord;

        // about > middle > leaf, and the events collection mounted under middle.
        // The reserved 404 always closes the order (the route
        // materializes it into the file).
        const order = [ { id: home.id }, { id: about.id }, { id: middle.id, parent: about.id }, { id: leaf.id, parent: middle.id }, { id: NOT_FOUND_PAGE_ID } ];

        const ordered = await call( '/api/pages-order', { pages: order }, 'PUT' );

        assert.equal( ordered.status, 200 );

        const mounted = await call( '/api/collection', { file: 'events.json', patch: { parent: middle.id } }, 'PUT' );

        assert.equal( mounted.status, 200 );

        const deleted = await call( '/api/page', { id: middle.id }, 'DELETE' );

        assert.equal( deleted.status, 200 );

        const pages = await pagesJson();

        assert.equal( pages.some( ( page ) => page.id === middle.id ), false );
        assert.equal( pages.find( ( page ) => page.id === leaf.id )?.parent, about.id, 'the child rose to the parent\'s parent' );

        const events = JSON.parse( await readFile( join( contentDirectory, 'events.json' ), 'utf8' ) ) as { parent?: string };

        assert.equal( events.parent, about.id, 'the mounted collection rose with it' );

        // Deleting a top-level parent frees its children to the root.
        const freed = await call( '/api/page', { id: about.id }, 'DELETE' );

        assert.equal( freed.status, 200 );
        assert.equal( ( await pagesJson() ).find( ( page ) => page.id === leaf.id )?.parent, undefined );
    } );
} );
