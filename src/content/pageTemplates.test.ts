// Page templates (SCHEMA 12.6): the chrome and the main layout a page
// renders through, shared by name; regions mirrored onto the default;
// a page's own inline template; the slot at any depth; and the
// loader's judgement of a misplaced slot or a misspelled name.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from '../compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { loadSiteDirectory } from './loadSiteDirectory.ts';
import { serializeCanonicalJson, type JsonValue } from './canonicalJson.ts';
import { validateSiteConfig } from './siteConfig.ts';
import { type SchemaIssue } from '../schema/manifest.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const customId = '5b7f1c2e-8d9a-4b3c-9e1f-2a3b4c5d6e7f';

const markdown = ( content: string ): Record<string, unknown> => ( { component: 'core/markdown', props: { content, width: 'prose' } } );

async function templatedFixture (): Promise<{ directory: string }>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-templates-' ) );

    await cp( join( fixtureRoot, 'content' ), directory, { recursive: true } );

    const siteFile = join( directory, 'site.json' );
    const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

    site.partials = { subfooter: [ markdown( 'Sub footer band.' ) ] };
    site.templates = {
        // The default nests its slot: a row section holding a sidebar
        // and the content.
        default: {
            header: [ markdown( 'Site header.' ) ],
            blocks: [ { section: {}, blocks: [ markdown( 'Sidebar.' ), { slot: 'content' } ] } ],
            footer: [ markdown( 'Site footer.' ) ],
        },
        landing: {
            header: [ markdown( 'Landing header.' ) ],
            blocks: [ { slot: 'content' }, { partial: 'subfooter' } ],
        },
    };
    site.notFound = [ markdown( 'Lost.' ) ];
    await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

    const pagesFile = join( directory, 'pages.json' );
    const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
    const about = document.pages.find( ( page ) => page.slug === 'about' );

    if ( about !== undefined ) { about.template = 'landing'; }

    document.pages.push( {
        id: customId,
        title: 'Custom',
        slug: 'custom',
        template: { header: [ markdown( 'Custom header.' ) ], blocks: [ { slot: 'content' } ] },
        blocks: [ markdown( '# Custom title\n\nCustom body.' ) ],
    } );
    await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

    return { directory };
}

describe( 'page templates', () =>
{
    it( 'mirrors regions onto the default template, once', () =>
    {
        const issues: SchemaIssue[] = [];
        const config = validateSiteConfig( {
            casomerSchema: 1,
            theme: { colors: { primary: '#000', secondary: '#fff', accent: '#f90' } },
            regions: { header: [ markdown( 'Old header.' ) ] },
        }, issues );

        assert.deepEqual( issues, [] );
        assert.equal( config.templates.default?.header?.length, 1, 'the region became the default header' );
        assert.deepEqual( config.templates.default?.blocks, [ { slot: 'content' } ], 'the mirrored default is the bare slot around it' );

        // A file carrying both keeps its own default.
        const both = validateSiteConfig( {
            casomerSchema: 1,
            theme: { colors: { primary: '#000', secondary: '#fff', accent: '#f90' } },
            regions: { header: [ markdown( 'Old header.' ) ] },
            templates: { default: { blocks: [ { slot: 'content' } ] } },
        }, issues );

        assert.deepEqual( issues, [] );
        assert.equal( both.templates.default?.header, undefined );
    } );

    it( 'judges the slot: exactly one in a template, none anywhere else, and names with did-you-mean', async () =>
    {
        const { directory } = await templatedFixture();
        const siteFile = join( directory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;
        const templates = site.templates as Record<string, unknown>;

        templates.twice = { blocks: [ { slot: 'content' }, { section: {}, blocks: [ { slot: 'content' } ] } ] };
        templates.none = { blocks: [ markdown( 'No slot.' ) ], header: [ { slot: 'content' } ] };
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        const pagesFile = join( directory, 'pages.json' );
        const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
        const home = document.pages.find( ( page ) => page.slug === 'home' );
        const about = document.pages.find( ( page ) => page.slug === 'about' );

        if ( home !== undefined ) { ( home.blocks as unknown[] ).push( { slot: 'content' } ); }
        if ( about !== undefined ) { about.template = 'landng'; }

        await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const result = await loadSiteDirectory( directory, loadedPackage === undefined ? [] : [ loadedPackage ] );
        const messages = result.issues.map( ( issue ) => `${issue.path}: ${issue.message}` );

        assert.ok( messages.some( ( m ) => m.startsWith( 'site.templates.twice.blocks:' ) && m.includes( 'found 2' ) ), messages.join( '\n' ) );
        assert.ok( messages.some( ( m ) => m.startsWith( 'site.templates.none.blocks:' ) && m.includes( 'found 0' ) ), messages.join( '\n' ) );
        assert.ok( messages.some( ( m ) => m.startsWith( 'site.templates.none.header:' ) && m.includes( 'chrome holds no slot' ) ), messages.join( '\n' ) );
        assert.ok( messages.some( ( m ) => m.includes( 'pages[0].blocks[' ) && m.includes( 'belongs in a page template' ) ), messages.join( '\n' ) );
        assert.ok( messages.some( ( m ) => m.includes( '.template: There is no page template "landng"' ) && m.includes( 'landing' ) ), messages.join( '\n' ) );
    } );

    it( 'builds every page through its template: chrome, nested slot, partials, an inline template, the 404', async () =>
    {
        const { directory } = await templatedFixture();
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-templates-out-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const home = await readFile( join( outputDirectory, 'index.html' ), 'utf8' );
        const about = await readFile( join( outputDirectory, 'about', 'index.html' ), 'utf8' );
        const custom = await readFile( join( outputDirectory, 'custom', 'index.html' ), 'utf8' );
        const notFound = await readFile( join( outputDirectory, '404.html' ), 'utf8' );
        const events = await readFile( join( outputDirectory, 'events', 'index.html' ), 'utf8' );

        // The default: chrome outside main, the sidebar row inside it
        // with the page's own content beside the sidebar.
        assert.match( home, /<header[^>]*>[\s\S]*Site header\.[\s\S]*<\/header>/ );
        assert.match( home, /<footer[^>]*>[\s\S]*Site footer\.[\s\S]*<\/footer>/ );
        assert.match( home, /<main[\s\S]*Sidebar\.[\s\S]*Hello[\s\S]*<\/main>/, 'the nested slot pours the page in beside the sidebar' );
        assert.ok( !home.includes( 'Sub footer band.' ), 'the landing partial is not on the default' );

        // The landing template: its own header, no footer, the
        // sub-footer partial after the content inside main.
        assert.match( about, /<header[^>]*>[\s\S]*Landing header\.[\s\S]*<\/header>/ );
        assert.match( about, /<footer[^>]*><\/footer>/, 'an absent footer is an empty landmark, still named for the transition' );
        assert.match( about, /<main[\s\S]*About this site[\s\S]*Sub footer band\.[\s\S]*<\/main>/ );
        assert.ok( !about.includes( 'Sidebar.' ) );

        // A page-owned template.
        assert.match( custom, /<header[^>]*>[\s\S]*Custom header\.[\s\S]*<\/header>/ );
        assert.match( custom, /Custom body\./ );
        assert.ok( !custom.includes( 'Site header.' ) );

        // Every other visitor page renders through the default: the
        // 404 and a collection index alike.
        assert.match( notFound, /<header[^>]*>[\s\S]*Site header\.[\s\S]*<\/header>/ );
        assert.match( notFound, /Lost\./ );
        assert.match( events, /<header[^>]*>[\s\S]*Site header\.[\s\S]*<\/header>/ );

        // One h1 per page still: the first heading in the composed main.
        for ( const page of [ home, about, custom ] )
        {
            assert.equal( ( page.match( /<h1[\s>]/g ) ?? [] ).length, 1 );
        }
    } );
} );
