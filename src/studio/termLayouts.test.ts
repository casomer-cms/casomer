// Named term layouts (SCHEMA 13.4): a taxonomy holds several, a term
// chooses one, the canvas edits one by name, and the visitor's term
// page renders through the term's choice.

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

describe( 'named term layouts', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const taxonomy = async (): Promise<{ layouts: Record<string, { entries: number }>; terms: { id: string; name: string; layout?: string }[] }> => ( await fetch( `${base}/api/taxonomy?file=kinds.json&t=${server.token}` ) ).json() as Promise<{ layouts: Record<string, { entries: number }>; terms: { id: string; name: string; layout?: string }[] }>;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-term-layouts-' ) );
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

    it( 'creates a layout on a taxonomy, edits it by name, and a term follows it', async () =>
    {
        assert.equal( ( await call( '/api/taxonomy', { label: 'Kinds' } ) ).status, 200 );
        assert.equal( ( await call( '/api/term', { file: 'kinds.json', name: 'Talks' } ) ).status, 200 );

        const created = await ( await call( '/api/layout', { file: 'kinds.json', name: 'Poster' } ) ).json() as { name: string };

        assert.equal( created.name, 'poster' );

        const written = await call( '/api/block', { doc: 'kinds', surface: 'template', layout: 'poster', container: '', index: 0, block: markdown( 'Poster only.' ) } );

        assert.equal( written.status, 200 );

        const file = JSON.parse( await readFile( join( contentDirectory, 'kinds.json' ), 'utf8' ) ) as { layouts: Record<string, unknown>; layout?: unknown };

        assert.ok( file.layouts.default !== undefined && file.layouts.poster !== undefined );
        assert.equal( file.layout, undefined );

        const canvas = await ( await fetch( `${base}/preview-term-template/kinds?layout=poster&t=${server.token}` ) ).text();

        assert.match( canvas, /Poster only\./ );

        const term = ( await taxonomy() ).terms.find( ( candidate ) => candidate.name === 'Talks' );

        assert.ok( term !== undefined );

        const chosen = await call( '/api/term', { file: 'kinds.json', id: term.id, layout: 'poster' }, 'PUT' );

        assert.equal( chosen.status, 200 );

        const after = await taxonomy();

        assert.equal( after.terms.find( ( candidate ) => candidate.id === term.id )?.layout, 'poster' );
        assert.equal( after.layouts.poster?.entries, 1 );

        const page = await ( await fetch( `${base}/preview/kinds/talks/?t=${server.token}` ) ).text();

        assert.match( page, /Poster only\./, 'the term page renders through its chosen layout' );

        const deleted = await ( await call( '/api/layout', { file: 'kinds.json', name: 'poster' }, 'DELETE' ) ).json() as { moved: number };

        assert.equal( deleted.moved, 1 );
        assert.equal( ( await taxonomy() ).terms.find( ( candidate ) => candidate.id === term.id )?.layout, undefined );
    } );
} );
