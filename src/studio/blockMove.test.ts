// A block moves (EDITOR 2, the selection tag's grip): out of its list
// and into the container at the seam's index in one write, the new
// path returned; never into itself; a same-list move accounts for the
// hole it leaves; a template part never crosses into another.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

type Block = { component?: string; slug?: string; blocks?: Block[]; props?: { content?: string } };

describe( 'the block move route', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let homeId: string;

    const api = async ( path: string, method: string, body: unknown ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const homeBlocks = async (): Promise<Block[]> =>
    {
        const pages = JSON.parse( await readFile( join( contentDirectory, 'pages.json' ), 'utf8' ) ) as { pages: { id: string; blocks: Block[] }[] };

        return pages.pages.find( ( page ) => page.id === homeId )?.blocks ?? [];
    };
    const names = ( blocks: Block[] ): string[] => blocks.map( ( block ) => block.slug ?? block.props?.content ?? ( block.blocks === undefined ? '?' : 'section' ) );

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-move-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };

        homeId = site.pages.find( ( page ) => page.slug === 'home' )?.id ?? '';

        // Three markdown blocks after the fixture's own two, in order.
        for ( const content of [ 'A', 'B', 'C' ] )
        {
            assert.equal( ( await api( '/api/block', 'POST', { pageId: homeId, container: '', block: { component: 'core/markdown', props: { content } } } ) ).status, 200 );
        }
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'moves a block up its own list, accounting for the hole it leaves', async () =>
    {
        const before = names( await homeBlocks() );

        assert.deepEqual( before.slice( -3 ), [ 'A', 'B', 'C' ] );

        const last = before.length - 1;
        const response = await api( '/api/block-move', 'POST', { pageId: homeId, path: `blocks[${last}]`, container: '', index: last - 2 } );

        assert.equal( response.status, 200 );
        assert.deepEqual( await response.json(), { moved: true, path: `blocks[${last - 2}]` } );
        assert.deepEqual( names( await homeBlocks() ).slice( -3 ), [ 'C', 'A', 'B' ] );
    } );

    it( 'moves a block down its own list to the end', async () =>
    {
        const blocks = await homeBlocks();
        const from = blocks.length - 3;
        const response = await api( '/api/block-move', 'POST', { pageId: homeId, path: `blocks[${from}]`, container: '', index: blocks.length } );

        assert.equal( response.status, 200 );
        assert.deepEqual( await response.json(), { moved: true, path: `blocks[${blocks.length - 1}]` } );
        assert.deepEqual( names( await homeBlocks() ).slice( -3 ), [ 'A', 'B', 'C' ] );
    } );

    it( 'moves a block into a section and back out', async () =>
    {
        const blocks = await homeBlocks();
        const section = blocks.findIndex( ( block ) => block.blocks !== undefined );
        const last = blocks.length - 1;

        assert.notEqual( section, -1 );

        const into = await api( '/api/block-move', 'POST', { pageId: homeId, path: `blocks[${last}]`, container: `blocks[${section}]`, index: 0 } );

        assert.equal( into.status, 200 );
        assert.deepEqual( await into.json(), { moved: true, path: `blocks[${section}].blocks[0]` } );

        const nested = ( await homeBlocks() )[ section ]?.blocks ?? [];

        assert.equal( nested[ 0 ]?.props?.content, 'C' );

        const out = await api( '/api/block-move', 'POST', { pageId: homeId, path: `blocks[${section}].blocks[0]`, container: '', index: last } );

        assert.equal( out.status, 200 );
        assert.deepEqual( await out.json(), { moved: true, path: `blocks[${last}]` } );
        assert.deepEqual( names( await homeBlocks() ).slice( -3 ), [ 'A', 'B', 'C' ] );
    } );

    it( 'refuses a move into itself and a move naming nothing', async () =>
    {
        const blocks = await homeBlocks();
        const section = blocks.findIndex( ( block ) => block.blocks !== undefined );

        assert.equal( ( await api( '/api/block-move', 'POST', { pageId: homeId, path: `blocks[${section}]`, container: `blocks[${section}]`, index: 0 } ) ).status, 400 );
        assert.equal( ( await api( '/api/block-move', 'POST', { pageId: homeId, path: '', container: '', index: 0 } ) ).status, 400 );
        assert.equal( ( await api( '/api/block-move', 'POST', { pageId: homeId, path: 'blocks[0]', container: '' } ) ).status, 400 );
    } );

    it( 'keeps a template part to itself', async () =>
    {
        assert.equal( ( await api( '/api/block', 'POST', { template: 'default', container: 'header', index: 0, block: { component: 'core/markdown', props: { content: 'H' } } } ) ).status, 200 );
        assert.equal( ( await api( '/api/block-move', 'POST', { template: 'default', path: 'header[0]', container: 'footer', index: 0 } ) ).status, 400 );
    } );
} );
