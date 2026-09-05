// The Section inspector and the Layout card (SCHEMA 11): the block
// route answers a section with its record and every block with its
// wrapper layout; a write sets keys one at a time and a null clears
// them; the block summary carries a section's explicit direction.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

type Block = { section?: Record<string, unknown>; blocks?: Block[]; size?: unknown; spaceBefore?: unknown; hidden?: unknown };

describe( 'arrangement through the block route', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let homeId: string;
    let sectionPath: string;

    const read = async ( path: string ): Promise<Record<string, unknown>> => await ( await fetch( `${base}/api/block?t=${server.token}&page=${homeId}&path=${encodeURIComponent( path )}` ) ).json() as Record<string, unknown>;
    const write = async ( body: Record<string, unknown> ): Promise<number> => ( await fetch( `${base}/api/block?t=${server.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( { pageId: homeId, ...body } ),
    } ) ).status;
    const homeBlocks = async (): Promise<Block[]> =>
    {
        const pages = JSON.parse( await readFile( join( contentDirectory, 'pages.json' ), 'utf8' ) ) as { pages: { id: string; blocks: Block[] }[] };

        return pages.pages.find( ( page ) => page.id === homeId )?.blocks ?? [];
    };

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-arrange-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string; blocks: { kind: string; direction?: string }[] }[] };
        const home = site.pages.find( ( page ) => page.slug === 'home' );

        homeId = home?.id ?? '';

        const index = home?.blocks.findIndex( ( block ) => block.kind === 'section' ) ?? -1;

        assert.notEqual( index, -1 );
        sectionPath = `blocks[${index}]`;
        assert.equal( home?.blocks[ index ]?.direction, 'row' );
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'reads a section as its record and its wrapper layout', async () =>
    {
        const loaded = await read( sectionPath );

        assert.equal( loaded.kind, 'section' );
        assert.deepEqual( loaded.section, { gap: 'md', direction: 'row', minHeight: 'third' } );
        assert.deepEqual( loaded.layout, { size: null, spaceBefore: { base: 'sm', md: 'lg' }, spaceAfter: null, pull: null, hidden: false } );
        assert.ok( Array.isArray( ( loaded.tokens as Record<string, string[]> ).spacing ) );
    } );

    it( 'writes section keys one at a time and clears them with null', async () =>
    {
        assert.equal( await write( { path: sectionPath, section: { padding: 'lg', justify: 'center', wrap: true } } ), 200 );
        assert.deepEqual( ( await homeBlocks() )[ 1 ]?.section, { gap: 'md', direction: 'row', minHeight: 'third', padding: 'lg', justify: 'center', wrap: true } );

        assert.equal( await write( { path: sectionPath, section: { direction: null, wrap: false, minHeight: '' } } ), 200 );
        assert.deepEqual( ( await homeBlocks() )[ 1 ]?.section, { gap: 'md', padding: 'lg', justify: 'center' } );

        const summary = ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; blocks: { direction?: string }[] }[] } ).pages.find( ( page ) => page.id === homeId )?.blocks[ 1 ];

        assert.equal( summary?.direction, undefined );
    } );

    it( 'writes a child\'s wrapper layout and a section\'s own', async () =>
    {
        const child = `${sectionPath}.blocks[0]`;

        assert.equal( await write( { path: child, wrapper: { size: '1/2', spaceBefore: 'lg', hidden: true } } ), 200 );

        const nested = ( await homeBlocks() )[ 1 ]?.blocks?.[ 0 ];

        assert.equal( nested?.size, '1/2' );
        assert.equal( nested?.spaceBefore, 'lg' );
        assert.equal( nested?.hidden, true );
        assert.deepEqual( ( await read( child ) ).layout, { size: '1/2', spaceBefore: 'lg', spaceAfter: null, pull: null, hidden: true } );

        assert.equal( await write( { path: child, wrapper: { size: null, hidden: false } } ), 200 );

        const cleared = ( await homeBlocks() )[ 1 ]?.blocks?.[ 0 ];

        assert.equal( cleared?.size, undefined );
        assert.equal( cleared?.hidden, undefined );
        assert.equal( cleared?.spaceBefore, 'lg' );

        assert.equal( await write( { path: sectionPath, wrapper: { spaceAfter: 'xl' } } ), 200 );
        assert.equal( ( await homeBlocks() )[ 1 ]?.spaceBefore !== undefined, true );
    } );

    it( 'refuses a section record sent to a component and leaves it untouched', async () =>
    {
        assert.equal( await write( { path: 'blocks[0]', section: { gap: 'lg' } } ), 400 );
        assert.equal( ( await homeBlocks() )[ 0 ]?.section, undefined );
    } );
} );
