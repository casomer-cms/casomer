// Header and footer as every site's partials, placed by the implicit
// default template (SCHEMA 12.5 and 12.6, Mikey 2026-09-02), and the
// layouts of collections and taxonomies naming the page template they
// render through, with rename and delete sweeping them like pages.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { loadSiteDirectory } from '../content/loadSiteDirectory.ts';
import { serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const markdown = ( content: string ): Record<string, unknown> => ( { component: 'core/markdown', props: { content, width: 'prose' } } );

describe( 'header and footer as partials', () =>
{
    it( 'reads the implicit default as the two partials around the slot, and keeps a regions file on its own chrome', async () =>
    {
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const packages = loadedPackage === undefined ? [] : [ loadedPackage ];
        const plain = await loadSiteDirectory( join( fixtureRoot, 'content' ), packages );

        assert.deepEqual( plain.config.templates.default, { header: [ { partial: 'header' } ], blocks: [ { slot: 'content' } ], footer: [ { partial: 'footer' } ] } );
        assert.deepEqual( plain.config.partials?.header, [] );
        assert.deepEqual( plain.config.partials?.footer, [] );

        const directory = await mkdtemp( join( tmpdir(), 'casomer-regions-' ) );

        await cp( join( fixtureRoot, 'content' ), directory, { recursive: true } );

        const siteFile = join( directory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        site.regions = { header: [ markdown( 'Own header.' ) ] };
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        const spelled = await loadSiteDirectory( directory, packages );

        assert.equal( spelled.config.templates.default?.header?.length, 1, 'the spelled region is the header' );
        assert.deepEqual( spelled.config.templates.default?.footer, [ { partial: 'footer' } ], 'the unspelled part is the partial' );
    } );
} );

describe( 'layout templates over the studio API', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const collection = async (): Promise<Record<string, unknown>> => ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as Promise<Record<string, unknown>>;
    const eventsJson = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( contentDirectory, 'events.json' ), 'utf8' ) ) as Record<string, unknown>;
    const siteJson = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( contentDirectory, 'site.json' ), 'utf8' ) ) as Record<string, unknown>;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-layouts-' ) );
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

    it( 'writes the header partial through the old surface name, and the default template shows it everywhere', async () =>
    {
        const inserted = await call( '/api/block', { region: 'header', container: '', index: 0, block: markdown( 'Site header.' ) } );

        assert.equal( inserted.status, 200 );

        const site = await siteJson();

        assert.equal( ( site.partials as Record<string, unknown[]> | undefined )?.header?.length, 1, 'the write landed in site.partials.header' );
        assert.equal( ( site.templates as Record<string, unknown> | undefined )?.default, undefined, 'no template materialized for it' );

        const home = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();
        const index = await ( await fetch( `${base}/preview/events/?t=${server.token}` ) ).text();

        assert.match( home, /<header[^>]*>[\s\S]*Site header\.[\s\S]*<\/header>/ );
        assert.match( index, /<header[^>]*>[\s\S]*Site header\.[\s\S]*<\/header>/, 'the collection index wears the same chrome' );

        const refused = await call( '/api/partial', { name: 'header' }, 'DELETE' );

        assert.equal( refused.status, 400, 'the header partial never deletes' );

        const snapshot = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { partials: string[] };

        assert.ok( snapshot.partials.includes( 'header' ) && snapshot.partials.includes( 'footer' ), 'both list as partials' );
    } );

    it( 'lets a collection index and its entry template choose a page template, and refuses a name the site lacks', async () =>
    {
        await call( '/api/template', { name: 'Listing' } );
        await call( '/api/block', { template: 'listing', part: 'header', container: '', index: 0, block: markdown( 'Listing header.' ) } );

        const chosen = await call( '/api/collection', { file: 'events.json', patch: { indexTemplate: 'listing' } }, 'PUT' );

        assert.equal( chosen.status, 200 );
        assert.equal( ( await collection() ).indexTemplate, 'listing' );
        assert.equal( ( ( await eventsJson() ).index as Record<string, unknown> ).template, 'listing', 'index.template in the file' );

        const index = await ( await fetch( `${base}/preview/events/?t=${server.token}` ) ).text();

        assert.match( index, /Listing header\./, 'the index renders through the chosen template' );
        assert.ok( !index.includes( 'Site header.' ), 'and not through the default' );

        const entryChosen = await call( '/api/collection', { file: 'events.json', patch: { entryTemplate: 'listing' } }, 'PUT' );

        assert.equal( entryChosen.status, 200 );
        assert.equal( ( ( await eventsJson() ).layouts as Record<string, Record<string, unknown>> ).default?.template, 'listing', 'layouts.default.template in the file' );

        const missing = await call( '/api/collection', { file: 'events.json', patch: { indexTemplate: 'nope' } }, 'PUT' );

        assert.equal( missing.status, 400 );

        const cleared = await call( '/api/collection', { file: 'events.json', patch: { entryTemplate: null } }, 'PUT' );

        assert.equal( cleared.status, 200 );
        assert.equal( ( ( await eventsJson() ).layouts as Record<string, Record<string, unknown>> ).default?.template, undefined, 'null clears the key' );
        assert.equal( ( await collection() ).entryTemplate, null );
    } );

    it( 'sweeps layouts on a template rename and a delete, like pages', async () =>
    {
        const renamed = await ( await call( '/api/template-rename', { from: 'listing', to: 'Catalog' } ) ).json() as { swept: number };

        assert.equal( renamed.swept, 1, 'the index layout followed' );
        assert.equal( ( ( await eventsJson() ).index as Record<string, unknown> ).template, 'catalog' );

        const deleted = await ( await call( '/api/template', { name: 'catalog' }, 'DELETE' ) ).json() as { moved: number };

        assert.equal( deleted.moved, 1 );
        assert.equal( ( ( await eventsJson() ).index as Record<string, unknown> ).template, undefined, 'back on the default' );
    } );
} );
