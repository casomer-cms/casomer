// The 404 page as a reserved page (SCHEMA 13.6): synthesized by the
// loader when pages.json lacks it, carrying a retired site.notFound;
// outside the tree and the menus; emitted as 404.html only when
// authored; rules on parent and draft.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from '../compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { loadSiteDirectory, NOT_FOUND_PAGE_ID } from './loadSiteDirectory.ts';
import { materializeMenu } from './urlTree.ts';
import { serializeCanonicalJson, type JsonValue } from './canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const markdown = ( content: string ): Record<string, unknown> => ( { component: 'core/markdown', props: { content, width: 'prose' } } );

async function fixture (): Promise<string>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-404-' ) );

    await cp( join( fixtureRoot, 'content' ), directory, { recursive: true } );
    return directory;
}

const exists = async ( path: string ): Promise<boolean> => access( path ).then( () => true, () => false );

describe( 'the reserved 404 page', () =>
{
    it( 'is synthesized last from a retired site.notFound and stays out of the tree and the menus', async () =>
    {
        const directory = await fixture();
        const siteFile = join( directory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        site.notFound = [ markdown( 'Lost.' ) ];
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const packages = loadedPackage === undefined ? [] : [ loadedPackage ];
        const result = await loadSiteDirectory( directory, packages );

        assert.deepEqual( result.issues, [] );

        const last = result.pages.at( -1 );

        assert.equal( last?.slug, '404' );
        assert.equal( last?.id, NOT_FOUND_PAGE_ID );
        assert.equal( last?.blocks.length, 1, 'the retired notFound blocks ride along' );
        assert.equal( result.pageCount, 2, 'the count speaks the file' );

        const menu = materializeMenu( { topLevelPages: true, items: [] }, result.pages, [], [] );

        assert.ok( menu.some( ( item ) => item.page !== undefined ), 'the top-level rule materializes rows' );
        assert.ok( !menu.some( ( item ) => item.page === NOT_FOUND_PAGE_ID ), 'never a menu row' );

        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-404-out-' ) );
        const built = await buildSite( { contentDirectory: directory, outputDirectory, packages, css: false } );

        assert.deepEqual( built.issues, [] );
        assert.match( await readFile( join( outputDirectory, '404.html' ), 'utf8' ), /Lost\./ );
        assert.equal( await exists( join( outputDirectory, '404', 'index.html' ) ), false, 'no /404/ address' );
    } );

    it( 'emits nothing when unauthored, and refuses a parent or a draft', async () =>
    {
        const directory = await fixture();
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const packages = loadedPackage === undefined ? [] : [ loadedPackage ];
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-404-empty-' ) );
        const built = await buildSite( { contentDirectory: directory, outputDirectory, packages, css: false } );

        assert.deepEqual( built.issues, [] );
        assert.equal( await exists( join( outputDirectory, '404.html' ) ), false, 'never a stub' );

        const pagesFile = join( directory, 'pages.json' );
        const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
        const home = document.pages.find( ( page ) => page.slug === 'home' );

        document.pages.push( { id: NOT_FOUND_PAGE_ID, title: 'Not found', slug: '404', blocks: [], parent: home?.id, draft: true } );
        await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

        const result = await loadSiteDirectory( directory, packages );
        const messages = result.issues.map( ( issue ) => `${issue.path}: ${issue.message}` );

        assert.ok( messages.some( ( m ) => m.includes( '.parent:' ) && m.includes( '404 page' ) ), messages.join( '\n' ) );
        assert.ok( messages.some( ( m ) => m.includes( '.draft:' ) && m.includes( '404 page' ) ), messages.join( '\n' ) );
    } );
} );
