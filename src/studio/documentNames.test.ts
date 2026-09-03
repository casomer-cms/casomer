// One namespace for collection and taxonomy names (Mikey,
// 2026-09-02): a label another document carries, in either kind and
// in any case, is refused on create and on rename - two "Events"
// would collide in the rail and at /events/.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'collection and taxonomy names', () =>
{
    let server: StudioServer;
    let base: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );

    before( async () =>
    {
        const contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-names-' ) );

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

    it( 'refuses a taken label on create, across kinds and case', async () =>
    {
        const taxonomy = await call( '/api/taxonomy', { label: 'Event Types' } );

        assert.equal( taxonomy.status, 200, 'the fixture has no taxonomy; this one is the other kind' );

        const sameKind = await call( '/api/collection', { label: 'Events' } );
        const otherKind = await call( '/api/taxonomy', { label: 'events' } );
        const taxonomyTaken = await call( '/api/collection', { label: 'Event Types' } );
        const slugTaken = await call( '/api/collection', { label: 'EVENTS!' } );

        assert.equal( sameKind.status, 409 );
        assert.equal( otherKind.status, 409 );
        assert.equal( taxonomyTaken.status, 409 );
        assert.equal( slugTaken.status, 409, 'the slug would own an existing file' );
        assert.match( ( await sameKind.json() as { error: string } ).error, /already exists/ );

        const fresh = await call( '/api/collection', { label: 'Talks' } );

        assert.equal( fresh.status, 200 );
    } );

    it( 'refuses a taken label on rename, and lets a document keep its own', async () =>
    {
        const clash = await call( '/api/collection', { file: 'talks.json', patch: { label: 'Event Types' } }, 'PUT' );
        const own = await call( '/api/collection', { file: 'talks.json', patch: { label: 'talks' } }, 'PUT' );
        const taxonomyClash = await call( '/api/taxonomy', { file: 'event-types.json', patch: { label: 'Talks' } }, 'PUT' );

        assert.equal( clash.status, 409 );
        assert.equal( own.status, 200, 'its own name in another case is not a clash' );
        assert.equal( taxonomyClash.status, 409 );
    } );

    it( 'keeps addresses apart from pages: labels may repeat, /events/ may not', async () =>
    {
        // A new page called Events steps around the collection's address.
        const page = await ( await call( '/api/page', { title: 'Events' } ) ).json() as { id: string; slug: string };

        assert.equal( page.slug, 'events-2' );

        // Renaming a top-level page onto a document's stem is refused.
        const renamed = await call( '/api/page', { id: page.id, patch: { slug: 'events' } }, 'PUT' );

        assert.equal( renamed.status, 409 );
        assert.match( ( await renamed.json() as { error: string } ).error, /collection already owns/ );

        // A document whose stem a top-level page owns is refused too.
        const aboutCollection = await call( '/api/collection', { label: 'About' } );

        assert.equal( aboutCollection.status, 409 );
        assert.match( ( await aboutCollection.json() as { error: string } ).error, /page already owns/ );
    } );
} );
