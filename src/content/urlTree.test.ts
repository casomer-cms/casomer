// The URL tree (SCHEMA 13.6): path computation, loader validation,
// and build emission - nested pages, mounted collections, cascading
// drafts, and the collision rule generalized to every scope.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectionIsDraft, collectionPathSegments, pageIsDraft, pagePathSegments, pagesById } from './urlTree.ts';
import { loadSiteDirectory } from './loadSiteDirectory.ts';
import { serializeCanonicalJson, type JsonValue } from './canonicalJson.ts';
import { buildSite } from '../compiler/buildSite.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

const homeId = '3f2b8c1a-9d4e-4f6a-8b2c-1e5d7a9c3b4f';
const historyId = '11111111-2222-4333-8444-555555555555';
const secretId = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const insideId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

async function treeFixture (): Promise<{ directory: string; aboutId: string }>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-tree-' ) );

    await cp( join( fixtureRoot, 'content' ), directory, { recursive: true } );

    const pagesFile = join( directory, 'pages.json' );
    const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
    const aboutId = String( document.pages.find( ( page ) => page.slug === 'about' )?.id );

    document.pages.push(
        { id: historyId, title: 'History', slug: 'history', parent: aboutId, blocks: [] },
        { id: secretId, title: 'Secret', slug: 'secret', draft: true, blocks: [] },
        { id: insideId, title: 'Inside', slug: 'inside', parent: secretId, blocks: [] },
    );
    await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

    const eventsFile = join( directory, 'events.json' );
    const events = JSON.parse( await readFile( eventsFile, 'utf8' ) ) as Record<string, unknown>;

    events.parent = aboutId;
    await writeFile( eventsFile, serializeCanonicalJson( events as JsonValue ), 'utf8' );

    return { directory, aboutId };
}

describe( 'the URL tree', () =>
{
    it( 'computes paths and cascading drafts, cycle-safe', () =>
    {
        const pages = [
            { id: 'a', slug: 'about' },
            { id: 'b', slug: 'history', parent: 'a' },
            { id: 'c', slug: 'deep', parent: 'b' },
            { id: 'h', slug: 'home' },
            { id: 'd', slug: 'secret', draft: true },
            { id: 'e', slug: 'inside', parent: 'd' },
            { id: 'x', slug: 'loop-one', parent: 'y' },
            { id: 'y', slug: 'loop-two', parent: 'x' },
        ];
        const index = pagesById( pages );

        assert.deepEqual( pagePathSegments( pages[ 0 ]!, index ), [ 'about' ] );
        assert.deepEqual( pagePathSegments( pages[ 2 ]!, index ), [ 'about', 'history', 'deep' ] );
        assert.deepEqual( pagePathSegments( pages[ 3 ]!, index ), [] );
        assert.equal( pageIsDraft( pages[ 4 ]!, index ), true );
        assert.equal( pageIsDraft( pages[ 5 ]!, index ), true );
        assert.equal( pageIsDraft( pages[ 1 ]!, index ), false );

        // A loop terminates instead of hanging; validation reports it.
        assert.ok( pagePathSegments( pages[ 6 ]!, index ).length > 0 );

        assert.deepEqual( collectionPathSegments( 'b', index ), [ 'about', 'history' ] );
        assert.deepEqual( collectionPathSegments( undefined, index ), [] );
        assert.equal( collectionIsDraft( 'e', index ), true );
        assert.equal( collectionIsDraft( 'a', index ), false );
    } );

    it( 'validates parents in the loader: existence, home rules, loops, mounts', async () =>
    {
        const { directory, aboutId } = await treeFixture();
        const pagesFile = join( directory, 'pages.json' );
        const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };

        const about = document.pages.find( ( page ) => page.slug === 'about' )!;
        const home = document.pages.find( ( page ) => page.slug === 'home' )!;
        const history = document.pages.find( ( page ) => page.slug === 'history' )!;

        about.parent = historyId;
        home.parent = aboutId;
        history.parent = homeId;
        document.pages.push( { id: '00000000-0000-4000-8000-000000000000', title: 'Lost', slug: 'lost', parent: 'ffffffff-0000-4000-8000-000000000000', blocks: [] } );
        await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

        const eventsFile = join( directory, 'events.json' );
        const events = JSON.parse( await readFile( eventsFile, 'utf8' ) ) as Record<string, unknown>;

        events.parent = homeId;
        await writeFile( eventsFile, serializeCanonicalJson( events as JsonValue ), 'utf8' );

        const result = await loadSiteDirectory( directory, [] );
        const messages = result.issues.map( ( issue ) => issue.message ).join( '\n' );

        assert.match( messages, /Home is the root of the URL tree/ );
        assert.match( messages, /Home is the root, not a node/ );
        assert.match( messages, /form a loop/ );
        assert.match( messages, /"parent" names no page/ );
        assert.match( messages, /an unmounted collection already lives there/i );
    } );

    it( 'emits nested pages and mounted collections, drafts cascading', async () =>
    {
        const { directory } = await treeFixture();
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-tree-out-' ) );

        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const written = [ ...result.pagesWritten ].sort();

        assert.ok( written.includes( 'about/history/index.html' ), 'nested page emits under its parent' );
        assert.ok( written.includes( 'about/events/index.html' ), 'mounted index emits under the page' );
        assert.ok( written.some( ( file ) => /^about\/events\/.+\/index\.html$/.test( file ) ), 'mounted entries emit under the page' );
        assert.ok( !written.some( ( file ) => file.startsWith( 'events/' ) ), 'nothing remains at the old root address' );
        assert.ok( !written.some( ( file ) => file.startsWith( 'secret' ) ), 'a draft page emits nothing' );
        assert.ok( !written.some( ( file ) => file.includes( 'inside' ) ), 'draft cascades to the child page' );
    } );

    it( 'emits term pages through the term template, nested terms nesting their URLs', async () =>
    {
        const { directory } = await treeFixture();
        const alphaId = '12121212-3434-4545-8676-989898989898';
        const betaId = '21212121-4343-4554-8767-898989898989';

        await writeFile( join( directory, 'topics.json' ), serializeCanonicalJson( {
            casomerSchema: 1,
            kind: 'taxonomy',
            label: 'Topics',
            hierarchical: true,
            template: { blocks: [ {
                section: {},
                blocks: [ { component: 'core/markdown', props: { content: { $bind: 'term.name' }, width: 'prose' } } ],
            } ] },
            terms: [
                { id: alphaId, name: 'Alpha Topic', description: 'The first topic.' },
                { id: betaId, name: 'Beta Topic', parent: alphaId },
            ],
        } as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-terms-out-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );
        assert.ok( result.pagesWritten.includes( 'topics/index.html' ), 'the term listing emits at the stem' );
        assert.ok( result.pagesWritten.includes( 'topics/alpha-topic/index.html' ), 'a term page emits through the template' );
        assert.ok( result.pagesWritten.includes( 'topics/alpha-topic/beta-topic/index.html' ), 'a nested term nests its URL' );

        const page = await readFile( join( outputDirectory, 'topics', 'alpha-topic', 'index.html' ), 'utf8' );

        assert.match( page, /Alpha Topic/, 'term.name binds through the template' );
    } );

    it( 'scopes a term repeat to the current term and its descendants', async () =>
    {
        const { directory } = await treeFixture();
        const alphaId = '12121212-3434-4545-8676-989898989898';
        const betaId = '21212121-4343-4554-8767-898989898989';

        await writeFile( join( directory, 'topics.json' ), serializeCanonicalJson( {
            casomerSchema: 1,
            kind: 'taxonomy',
            label: 'Topics',
            hierarchical: true,
            template: { blocks: [ {
                section: {},
                blocks: [ {
                    repeat: {
                        source: { collection: 'stories', term: 'current' },
                        component: 'core/markdown',
                        props: { content: { $bind: 'entry.title' }, width: 'prose' },
                    },
                } ],
            } ] },
            terms: [
                { id: alphaId, name: 'Alpha' },
                { id: betaId, name: 'Beta', parent: alphaId },
            ],
        } as unknown as JsonValue ), 'utf8' );

        await writeFile( join( directory, 'stories.json' ), serializeCanonicalJson( {
            casomerSchema: 1,
            kind: 'stories'.replace( 'stories', 'collection' ),
            label: 'Stories',
            fields: { title: 'text!', topic: 'reference | taxonomy:topics' },
            entries: [
                { id: 'aaaaaaaa-1111-4222-8333-444444444444', title: 'Under Alpha', topic: alphaId },
                { id: 'bbbbbbbb-1111-4222-8333-444444444444', title: 'Under Beta', topic: betaId },
                { id: 'cccccccc-1111-4222-8333-444444444444', title: 'Unclassified', topic: '' },
            ],
        } as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-term-repeat-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const alphaPage = await readFile( join( outputDirectory, 'topics', 'alpha', 'index.html' ), 'utf8' );
        const betaPage = await readFile( join( outputDirectory, 'topics', 'alpha', 'beta', 'index.html' ), 'utf8' );

        assert.match( alphaPage, /Under Alpha/ );
        assert.match( alphaPage, /Under Beta/, 'a parent term includes its descendants’ entries' );
        assert.ok( !alphaPage.includes( 'Unclassified' ) );
        assert.match( betaPage, /Under Beta/ );
        assert.ok( !betaPage.includes( 'Under Alpha' ), 'a child term shows only its own entries' );
    } );

    it( 'renders regions on every page and resolves menus through the tree', async () =>
    {
        const { directory, aboutId } = await treeFixture();
        const siteFile = join( directory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        site.regions = {
            header: [ {
                section: {},
                blocks: [ {
                    repeat: {
                        source: { menu: 'primary' },
                        component: 'core/markdown',
                        props: { content: { $bind: 'entry.label' }, width: 'prose' },
                    },
                } ],
            } ],
            footer: [ { component: 'core/markdown', props: { content: 'The footer speaks.', width: 'prose' } } ],
        };
        site.menus = {
            primary: [
                { page: aboutId },
                { page: secretId },
                { label: 'Elsewhere', url: 'https://example.com/' },
            ],
        };
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-regions-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const home = await readFile( join( outputDirectory, 'index.html' ), 'utf8' );
        const history = await readFile( join( outputDirectory, 'about', 'history', 'index.html' ), 'utf8' );

        for ( const page of [ home, history ] )
        {
            assert.match( page, /<header[^>]*>[\s\S]*About[\s\S]*<\/header>/, 'the menu repeat renders the page item in the header' );
            assert.match( page, /<footer[^>]*>[\s\S]*The footer speaks\.[\s\S]*<\/footer>/, 'the footer region renders' );
            assert.ok( !page.includes( 'Secret' ), 'a draft page never surfaces in a menu' );
        }

        // Menus resolve URLs through the tree: nested pages get their
        // full addresses.
        const menus = ( await import( './urlTree.ts' ) ).resolveMenus(
            { primary: [ { page: historyId }, { label: 'X', url: 'https://x.example/' } ] },
            [
                { id: aboutId, slug: 'about', title: 'About' },
                { id: historyId, slug: 'history', title: 'History', parent: aboutId },
            ],
        );

        assert.deepEqual( menus.primary, [
            { label: 'History', url: '/about/history/' },
            { label: 'X', url: 'https://x.example/' },
        ] );
    } );

    it( 'nests menus - kinds, groups, families, topLevelPages - and repeats over taxonomies', async () =>
    {
        const { directory, aboutId } = await treeFixture();
        const alphaId = '77777777-1111-4222-8333-444444444444';
        const betaId = '88888888-1111-4222-8333-444444444444';

        // A taxonomy with public term pages: a menu target and a
        // repeat source both.
        await writeFile( join( directory, 'topics.json' ), serializeCanonicalJson( {
            casomerSchema: 1,
            kind: 'taxonomy',
            label: 'Topics',
            hierarchical: true,
            template: { blocks: [ { component: 'core/markdown', props: { content: { $bind: 'term.name' }, width: 'prose' } } ] },
            terms: [
                { id: alphaId, name: 'Alpha' },
                { id: betaId, name: 'Beta', parent: alphaId },
            ],
        } as unknown as JsonValue ), 'utf8' );

        const siteFile = join( directory, 'site.json' );
        const site = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        site.regions = {
            header: [ {
                section: {},
                blocks: [ {
                    repeat: {
                        source: { menu: 'primary' },
                        component: 'core/link',
                        props: { label: { $bind: 'entry.label' }, url: { $bind: 'entry.url' } },
                    },
                } ],
            } ],
        };
        // The user-authored 404 page (site.notFound) emits as
        // /404.html - only because it has content.
        site.notFound = [ { component: 'core/markdown', props: { content: '# Lost?\n\nNothing lives at this address.', width: 'prose' } } ];
        site.menus = {
            primary: {
                topLevelPages: true,
                items: [
                    { page: aboutId, items: [ { page: historyId } ] },
                    { collection: 'events' },
                    { taxonomy: 'topics' },
                    { label: 'More', items: [ { label: 'Out', url: 'https://example.com/' } ] },
                    { label: 'Hollow', items: [ { page: secretId } ] },

                    // A materialized auto row whose page is gone:
                    // machine bookkeeping, silently dropped - never a
                    // loader issue (a manual dangling page would be).
                    { page: '00000000-1111-4222-8333-999999999999', auto: 'topLevelPages' },
                ],
            },
        };
        await writeFile( siteFile, serializeCanonicalJson( site as JsonValue ), 'utf8' );

        // A taxonomy-sourced repeat on the home page: one link per
        // term, term-page URLs bound in.
        const pagesFile = join( directory, 'pages.json' );
        const pagesDocument = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };
        const home = pagesDocument.pages.find( ( page ) => page.slug === 'home' )!;

        ( home.blocks as unknown[] ).push( {
            repeat: {
                source: { taxonomy: 'topics' },
                component: 'core/link',
                props: { label: { $bind: 'entry.name' }, url: { $bind: 'entry.url' } },
            },
        }, {
            // The inherent entry.url: each event links to its own
            // emitted page under the mount.
            repeat: {
                source: { collection: 'events' },
                component: 'core/link',
                props: { label: { $bind: 'entry.title' }, url: { $bind: 'entry.url' } },
            },
        } );
        await writeFile( pagesFile, serializeCanonicalJson( pagesDocument as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-menu-tree-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const homePage = await readFile( join( outputDirectory, 'index.html' ), 'utf8' );

        // The menu repeat emits a real list: nested families as
        // nested lists, group labels as text, every kind's URL from
        // its own machinery.
        assert.match( homePage, /<ul class="cs-menu">/ );
        assert.match( homePage, /<li class="cs-menu-item cs-menu-parent">[\s\S]*?About[\s\S]*?<ul class="cs-menu-sub">[\s\S]*?History/, 'a page family nests' );
        assert.match( homePage, /href="\/about\/history\/"/, 'the nested page keeps its tree address' );
        assert.match( homePage, /href="\/about\/events\/"/, 'a collection item points at the mounted index' );
        assert.match( homePage, /href="\/topics\/"/, 'a taxonomy item points at its index' );
        assert.match( homePage, /<span class="cs-menu-label">More<\/span>/, 'a group renders its label as text, not a link' );
        assert.match( homePage, /More<\/span><ul class="cs-menu-sub">[\s\S]*?Out/, 'the group heads its family' );
        assert.ok( !homePage.includes( 'Hollow' ), 'a group whose children all resolve away is omitted' );
        assert.ok( !homePage.includes( 'Secret' ), 'drafts never surface' );
        assert.match( homePage, /href="\/">Home</, 'topLevelPages appends pages not already referenced' );
        const headerHtml = /<header[^>]*>([\s\S]*?)<\/header>/.exec( homePage )?.[ 1 ] ?? '';

        assert.equal( headerHtml.match( /href="\/about\/"/g )?.length, 1, 'an explicitly referenced page is not appended again' );

        // The taxonomy repeat: one item per term, nested term URLs.
        assert.match( homePage, /href="\/topics\/alpha\/">Alpha</ );
        assert.match( homePage, /href="\/topics\/alpha\/beta\/">Beta</ );

        // The inherent entry.url matches the page the build emitted.
        assert.match( homePage, /href="\/about\/events\/harvest-loaf-tasting\/">Harvest loaf tasting</ );
        assert.ok( ( await readFile( join( outputDirectory, 'about', 'events', 'harvest-loaf-tasting', 'index.html' ), 'utf8' ) ).length > 0 );

        // The authored 404 page, at the hosting convention's path.
        const notFoundPage = await readFile( join( outputDirectory, '404.html' ), 'utf8' );

        assert.match( notFoundPage, /Nothing lives at this address\./ );
        assert.match( notFoundPage, /<title>Not found/ );

        // Auto rows resolve wherever the user ordered them, keep
        // label overrides, and drop silently once their target stops
        // qualifying for the rule; the append rule only adds what no
        // row references yet.
        const autoMenus = ( await import( './urlTree.ts' ) ).resolveMenus(
            { primary: { topLevelPages: true, items: [
                { page: 'b', auto: 'topLevelPages' },
                { page: 'gone', auto: 'topLevelPages' },
                { page: 'a', auto: 'topLevelPages', label: 'Kept first' },
                { label: 'Out', url: 'https://x.example/' },
            ] } },
            [
                { id: 'a', slug: 'about', title: 'About' },
                { id: 'b', slug: 'history', title: 'History', parent: 'a' },
                { id: 'h', slug: 'home', title: 'Home' },
            ],
        );

        assert.deepEqual( autoMenus.primary, [
            { label: 'Kept first', url: '/about/' },
            { label: 'Out', url: 'https://x.example/' },
            { label: 'Home', url: '/' },
        ] );
    } );

    it( 'materializes the whole auto-include roster: child pages, collection and taxonomy indexes', async () =>
    {
        const { resolveMenus } = await import( './urlTree.ts' );
        const pages = [
            { id: 'a', slug: 'about', title: 'About' },
            { id: 'b', slug: 'history', title: 'History', parent: 'a' },
            { id: 'c', slug: 'team', title: 'Team', parent: 'a' },
            { id: 'd', slug: 'shadow', title: 'Shadow', parent: 'a', draft: true },
            { id: 'h', slug: 'home', title: 'Home' },
        ];
        const collections = [
            { file: 'events.json', label: 'Events', parent: 'a' },
            { file: 'private.json', label: 'Private', indexBlocks: false as const },
        ];
        const taxonomies = [
            { file: 'topics.json', label: 'Topics' },
            { file: 'hidden.json', label: 'Hidden', indexBlocks: false as const },
        ];

        // childPages nests unreferenced children under their parent's
        // item; a child already referenced (History) stays where the
        // user put it, and drafts stay out.
        const nested = resolveMenus(
            { main: { childPages: true, items: [
                { page: 'a' },
                { page: 'b', label: 'Handled' },
            ] } },
            pages, collections, taxonomies,
        );

        assert.deepEqual( nested.main, [
            { label: 'About', url: '/about/', items: [ { label: 'Team', url: '/about/team/' } ] },
            { label: 'Handled', url: '/about/history/' },
        ] );

        // Index rules append public, unreferenced indexes; a fully
        // private document ("index": false) and an index a row
        // already references never double.
        const indexes = resolveMenus(
            { main: { collectionIndexes: true, taxonomyIndexes: true, items: [
                { taxonomy: 'topics', label: 'Browse topics' },
            ] } },
            pages, collections, taxonomies,
        );

        assert.deepEqual( indexes.main, [
            { label: 'Browse topics', url: '/topics/' },
            { label: 'Events', url: '/about/events/' },
        ] );

        // A materialized collection row under a drafted mount drops
        // with the mount, same as the emitted index page does.
        const drafted = resolveMenus(
            { main: { collectionIndexes: true, items: [] } },
            [ { id: 'a', slug: 'about', title: 'About', draft: true }, { id: 'h', slug: 'home', title: 'Home' } ],
            collections, taxonomies,
        );

        assert.deepEqual( drafted.main, [] );
    } );

    it( 'paginates an index: windows, the pager, and /page/2/ addresses', async () =>
    {
        const { directory } = await treeFixture();
        const eventsFile = join( directory, 'events.json' );
        const events = JSON.parse( await readFile( eventsFile, 'utf8' ) ) as Record<string, unknown> & { entries: Record<string, unknown>[]; index?: Record<string, unknown> };

        // Three entries, one per page: /about/events/ plus two more.
        events.entries = [
            { id: 'aaaaaaa1-1111-4222-8333-444444444444', title: 'First' },
            { id: 'aaaaaaa2-1111-4222-8333-444444444444', title: 'Second' },
            { id: 'aaaaaaa3-1111-4222-8333-444444444444', title: 'Third' },
        ];
        events.index = {
            pageSize: 1,
            blocks: [ {
                repeat: {
                    source: { collection: 'events' },
                    component: 'core/markdown',
                    props: { width: 'prose', content: { $bind: 'entry.title' } },
                },
            } ],
        };
        await writeFile( eventsFile, serializeCanonicalJson( events as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-pager-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.deepEqual( result.issues, [] );

        const first = await readFile( join( outputDirectory, 'about', 'events', 'index.html' ), 'utf8' );
        const second = await readFile( join( outputDirectory, 'about', 'events', 'page', '2', 'index.html' ), 'utf8' );
        const third = await readFile( join( outputDirectory, 'about', 'events', 'page', '3', 'index.html' ), 'utf8' );

        assert.ok( first.includes( 'First' ) && !first.includes( 'Second' ), 'page one shows only its window' );
        assert.ok( second.includes( 'Second' ) && !second.includes( 'First</p>' ) );
        assert.ok( third.includes( 'Third' ) );

        // The pager: scaffolding like the skip link - page one links
        // forward, deep pages link back to the bare index address.
        assert.match( first, /<nav class="cs-pager" aria-label="Pagination">/ );
        assert.match( first, /href="\/about\/events\/page\/2\/"/ );
        assert.match( second, /href="\/about\/events\/"/ );
        assert.match( second, /aria-current="page">2</ );
        assert.ok( !second.includes( 'href="/about/events/page/1/"' ), 'page one is the bare address, never /page/1/' );
    } );

    it( 'lets a page win a contested segment, in any scope', async () =>
    {
        const { directory, aboutId } = await treeFixture();
        const pagesFile = join( directory, 'pages.json' );
        const document = JSON.parse( await readFile( pagesFile, 'utf8' ) ) as { pages: Record<string, unknown>[] };

        document.pages.push( { id: '99999999-8888-4777-8666-555555555554', title: 'Events', slug: 'events', parent: aboutId, blocks: [] } );
        await writeFile( pagesFile, serializeCanonicalJson( document as unknown as JsonValue ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-tree-collision-' ) );
        const result = await buildSite( {
            contentDirectory: directory,
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        assert.ok( result.issues.some( ( issue ) => /already owns "\/about\/events\/"/.test( issue.message ) ) );
        assert.ok( result.pagesWritten.includes( 'about/events/index.html' ), 'the page owns the address' );
        assert.ok( !result.pagesWritten.some( ( file ) => /^about\/events\/.+\//.test( file ) ), 'the collection emits nothing under it' );
    } );
} );
