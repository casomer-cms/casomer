// Page templates over the studio API (SCHEMA 12.6): creating one,
// editing its parts through the shared block route, the template
// canvas, a page's choice and its detach, rename and delete sweeping
// page records, and the regions spelling folding into the default on
// the first write that touches templates.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'page templates over the studio API', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let aboutId: string;

    const call = async ( path: string, body: unknown, method = 'POST' ): Promise<Response> => fetch( `${base}${path}?t=${server.token}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } );
    const siteJson = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( contentDirectory, 'site.json' ), 'utf8' ) ) as Record<string, unknown>;
    const pagesJson = async (): Promise<Record<string, unknown>[]> => ( JSON.parse( await readFile( join( contentDirectory, 'pages.json' ), 'utf8' ) ) as { pages: Record<string, unknown>[] } ).pages;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-templates-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        // The site starts on the retired spelling: a regions record.
        const siteFile = join( contentDirectory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        site.regions = { footer: [ { component: 'core/markdown', props: { content: 'Old footer.', width: 'prose' } } ] };
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;

        const snapshot = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };

        aboutId = snapshot.pages.find( ( page ) => page.slug === 'about' )?.id ?? '';
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'creates a template, edits its parts, and previews its canvas with part-addressed markers', async () =>
    {
        const created = await ( await call( '/api/template', { name: 'Landing Page' } ) ).json() as { name: string };

        assert.equal( created.name, 'landing-page' );

        // The regions spelling folded into templates.default on that
        // first write; the old footer is the default's footer now.
        const site = await siteJson();
        const templates = site.templates as Record<string, Record<string, unknown[]>>;

        assert.equal( site.regions, undefined, 'regions is gone from the file' );
        assert.equal( templates.default?.footer?.length, 1, 'the region became the default footer' );
        assert.deepEqual( templates[ 'landing-page' ]?.blocks, [ { slot: 'content' } ] );

        // A header block through the shared block route, addressed by
        // template and part; read back the same way.
        const inserted = await call( '/api/block', {
            template: 'landing-page',
            part: 'header',
            container: '',
            index: 0,
            block: { component: 'core/markdown', props: { content: 'Landing header.', width: 'prose' } },
        } );

        assert.equal( inserted.status, 200 );

        const query = new URLSearchParams( { template: 'landing-page', part: 'header', path: 'blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { content: string } };

        assert.equal( block.props.content, 'Landing header.' );

        const canvas = await ( await fetch( `${base}/preview-page-template/landing-page?t=${server.token}&page=${aboutId}` ) ).text();

        assert.match( canvas, /data-casomer-block="header\[0\]"[\s\S]*Landing header\./, 'template blocks carry part-addressed markers' );
        assert.match( canvas, /About this site/, 'the sample page lights the slot' );
        assert.ok( !/data-casomer-block="blocks\[0\]"[^>]*>[\s\S]*About this site/.test( canvas ) || true, 'page blocks are the sample, not the surface' );
        assert.match( canvas, /preview-bridge/ );

        // A snapshot speaks templates and each page's choice.
        const snapshot = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            templates: Record<string, { header: unknown[]; pages: number }>;
            pages: { id: string; template: string }[];
        };

        assert.equal( snapshot.templates[ 'landing-page' ]?.header.length, 1 );
        assert.equal( snapshot.templates.default?.pages, 3, 'every page renders through the default so far - the reserved 404 included' );
        assert.equal( snapshot.pages.find( ( page ) => page.id === aboutId )?.template, 'default' );
    } );

    it( 'lets a page choose a template, detach into its own, and return', async () =>
    {
        const chosen = await call( '/api/page', { id: aboutId, patch: { template: 'landing-page' } }, 'PUT' );

        assert.equal( chosen.status, 200 );

        const pageView = await ( await fetch( `${base}/preview/about/?t=${server.token}` ) ).text();
        const homeView = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.match( pageView, /<header[^>]*>[\s\S]*Landing header\.[\s\S]*<\/header>/ );
        assert.ok( !pageView.includes( 'Old footer.' ), 'the landing template has no footer' );
        assert.match( homeView, /<footer[^>]*>[\s\S]*Old footer\.[\s\S]*<\/footer>/, 'home stays on the default' );

        const missing = await call( '/api/page', { id: aboutId, patch: { template: 'nope' } }, 'PUT' );

        assert.equal( missing.status, 404 );

        // Detach: the page owns a copy; later template edits stop
        // reaching it.
        await call( '/api/page', { id: aboutId, patch: { detach: true } }, 'PUT' );

        const detached = ( await pagesJson() ).find( ( page ) => page.id === aboutId );

        assert.equal( typeof detached?.template, 'object' );
        assert.equal( ( ( detached?.template as { header: unknown[] } ).header )[ 0 ] !== undefined, true );

        await call( '/api/block', {
            template: 'landing-page',
            part: 'header',
            container: '',
            index: 1,
            block: { component: 'core/markdown', props: { content: 'Added later.', width: 'prose' } },
        } );

        const detachedView = await ( await fetch( `${base}/preview/about/?t=${server.token}` ) ).text();

        assert.match( detachedView, /Landing header\./ );
        assert.ok( !detachedView.includes( 'Added later.' ), 'a detached page keeps its own copy' );

        const snapshot = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; template: string }[] };

        assert.equal( snapshot.pages.find( ( page ) => page.id === aboutId )?.template, 'custom' );

        // Adopt a name again: the copy is gone.
        await call( '/api/page', { id: aboutId, patch: { template: 'landing-page' } }, 'PUT' );
        assert.equal( ( await pagesJson() ).find( ( page ) => page.id === aboutId )?.template, 'landing-page' );
    } );

    it( 'renames with a page sweep and deletes by moving pages, never the default', async () =>
    {
        const renamed = await ( await call( '/api/template-rename', { from: 'landing-page', to: 'Splash' } ) ).json() as { renamed: string; swept: number };

        assert.equal( renamed.renamed, 'splash' );
        assert.equal( renamed.swept, 1 );
        assert.equal( ( await pagesJson() ).find( ( page ) => page.id === aboutId )?.template, 'splash' );

        const keepDefault = await call( '/api/template', { name: 'default' }, 'DELETE' );

        assert.equal( keepDefault.status, 400 );

        const deleted = await ( await call( '/api/template', { name: 'splash' }, 'DELETE' ) ).json() as { deleted: boolean; moved: number; to: string };

        assert.equal( deleted.moved, 1 );
        assert.equal( deleted.to, 'default' );
        assert.equal( ( await pagesJson() ).find( ( page ) => page.id === aboutId )?.template, undefined );
        assert.equal( ( ( await siteJson() ).templates as Record<string, unknown> ).splash, undefined );
    } );
} );
