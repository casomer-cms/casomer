// Named entry layouts (SCHEMA 13.4, Mikey 2026-09-02): a collection
// holds several, entries choose one or go rogue, the canvas edits one
// by name, and delete moves followers to the default.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const markdown = ( content: string ): Record<string, unknown> => ( { component: 'core/markdown', props: { content, width: 'prose' } } );

describe( 'named entry layouts', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let entryId: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const collection = async (): Promise<{ layouts: Record<string, { template: string | null; entries: number }>; entries: { id: string; layout?: string; hasOwnBlocks: boolean; values: Record<string, unknown> }[] }> => ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as Promise<{ layouts: Record<string, { template: string | null; entries: number }>; entries: { id: string; layout?: string; hasOwnBlocks: boolean; values: Record<string, unknown> }[] }>;
    const eventsJson = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( contentDirectory, 'events.json' ), 'utf8' ) ) as Record<string, unknown>;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-layouts-named-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;
        entryId = ( await collection() ).entries[ 0 ]?.id ?? '';
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'reads the single layout as default, creates a named one, and edits it by name', async () =>
    {
        const before = await collection();

        assert.ok( before.layouts.default !== undefined, 'the fixture\'s single layout is the default' );
        assert.equal( before.layouts.default?.entries, before.entries.filter( ( entry ) => !entry.hasOwnBlocks ).length, 'every conforming entry follows the default' );

        const created = await ( await call( '/api/layout', { file: 'events.json', name: 'Wide Card' } ) ).json() as { name: string };

        assert.equal( created.name, 'wide-card' );

        const file = await eventsJson();
        const layouts = file.layouts as Record<string, { blocks: unknown[] }>;

        assert.equal( file.layout, undefined, 'the single object folded into layouts' );
        assert.ok( layouts.default !== undefined && layouts[ 'wide-card' ] !== undefined );

        const written = await call( '/api/block', { doc: 'events', surface: 'template', layout: 'wide-card', container: '', index: 0, block: markdown( 'Wide only.' ) } );

        assert.equal( written.status, 200 );
        assert.match( JSON.stringify( ( await eventsJson() ).layouts ), /Wide only\./ );

        const canvas = await ( await fetch( `${base}/preview-entry-template/events?layout=wide-card&t=${server.token}` ) ).text();
        const plain = await ( await fetch( `${base}/preview-entry-template/events?t=${server.token}` ) ).text();

        assert.match( canvas, /Wide only\./, 'the canvas renders the named layout' );
        assert.ok( !plain.includes( 'Wide only.' ), 'the default is untouched' );

        const taken = await call( '/api/layout', { file: 'events.json', name: 'wide card' } );

        assert.equal( taken.status, 409 );
    } );

    it( 'lets an entry choose a layout, and the visitor sees it', async () =>
    {
        const chosen = await call( '/api/entry', { file: 'events.json', id: entryId, layout: 'wide-card' }, 'PUT' );

        assert.equal( chosen.status, 200 );

        const after = await collection();

        assert.equal( after.entries.find( ( entry ) => entry.id === entryId )?.layout, 'wide-card' );
        assert.equal( after.layouts[ 'wide-card' ]?.entries, 1 );
        assert.equal( after.layouts.default?.entries, after.entries.filter( ( entry ) => !entry.hasOwnBlocks ).length - 1 );

        const title = String( after.entries.find( ( entry ) => entry.id === entryId )?.values.title ?? '' );
        const slug = title.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
        const page = await ( await fetch( `${base}/preview/events/${slug}/?t=${server.token}` ) ).text();

        assert.match( page, /Wide only\./, 'the entry page renders through its chosen layout' );

        const missing = await call( '/api/entry', { file: 'events.json', id: entryId, layout: 'nope' }, 'PUT' );

        assert.equal( missing.status, 404 );

        const templated = await call( '/api/collection', { file: 'events.json', patch: { layoutTemplates: { 'wide-card': 'default' } } }, 'PUT' );

        assert.equal( templated.status, 200 );
    } );

    it( 'diverges from the chosen layout, and delete moves followers to the default', async () =>
    {
        const diverged = await call( '/api/entry-layout', { file: 'events.json', id: entryId, action: 'diverge' } );

        assert.equal( diverged.status, 200 );

        const rogue = ( await eventsJson() ).entries as { id: string; blocks?: unknown[] }[];

        assert.match( JSON.stringify( rogue.find( ( entry ) => entry.id === entryId )?.blocks ), /Wide only\./, 'the copy came from the chosen layout' );

        await call( '/api/entry-layout', { file: 'events.json', id: entryId, action: 'adopt' } );

        const keepDefault = await call( '/api/layout', { file: 'events.json', name: 'default' }, 'DELETE' );

        assert.equal( keepDefault.status, 400 );

        const deleted = await ( await call( '/api/layout', { file: 'events.json', name: 'wide-card' }, 'DELETE' ) ).json() as { moved: number };

        assert.equal( deleted.moved, 1 );
        assert.equal( ( await collection() ).entries.find( ( entry ) => entry.id === entryId )?.layout, undefined );
    } );
} );
