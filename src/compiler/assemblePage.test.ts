import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemblePage, type PageInput, type AssembleOptions } from './assemblePage.ts';
import { loadCoreComponents } from './coreComponents.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { validateSiteConfig } from '../content/siteConfig.ts';
import { normalizeFields } from '../schema/fields.ts';
import { parseJsonDocument } from '../content/canonicalJson.ts';
import { type SchemaIssue } from '../schema/manifest.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

const optionsForFixture = async (): Promise<AssembleOptions> =>
{
    const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
    const issues: SchemaIssue[] = [];
    const config = validateSiteConfig(
        parseJsonDocument( await readFile( join( fixtureRoot, 'content', 'site.json' ), 'utf8' ) ),
        issues,
    );

    assert.deepEqual( issues, [] );
    return {
        config,
        packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        coreComponents: await loadCoreComponents(),
        generatorVersion: '0.0.2',
    };
};

const fixturePages = async (): Promise<PageInput[]> =>
    ( parseJsonDocument( await readFile( join( fixtureRoot, 'content', 'pages.json' ), 'utf8' ) ) as unknown as { pages: PageInput[] } ).pages;

describe( 'assemblePage on the golden fixture', () =>
{
    it( 'assembles the home page with nothing scaffolded and exactly one h1', async () =>
    {
        const [ home ] = await fixturePages();
        const { html, issues } = await assemblePage( home as PageInput, await optionsForFixture() );

        assert.deepEqual( issues, [] );

        // No content is hard-coded in the output (SCHEMA 8): the h1
        // is the first heading the USER put on the page - here the
        // card's title - never an emitted duplicate of page.title.
        assert.equal( ( html.match( /<h1[\s>]/g ) ?? [] ).length, 1 );
        assert.ok( !html.includes( '>Home</h1>' ) );
        assert.ok( html.includes( '<title>Home</title>' ) );
        assert.ok( html.includes( '<a class="skip-link" href="#main">Skip to content</a>' ) );
        assert.ok( html.includes( '<meta name="generator" content="casomer 0.0.2">' ) );
        assert.ok( html.includes( '<header style="view-transition-name: casomer-header"></header>' ) );
        assert.ok( html.includes( '<footer style="view-transition-name: casomer-footer"></footer>' ) );
    } );

    it( 'maps the first heading scope from h1, later scopes from h2', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        // The card leads the page: its authored h2 is rank zero of the
        // FIRST heading scope, so it becomes the page's h1 - wearing
        // its authored rank as the visual class (SCHEMA 8: semantics
        // from the page, looks from the author).
        assert.ok( html.includes( '<h1 class="h2" data-anchor="title">Hello</h1>' ) );

        // The later section's markdown h1s are sibling rank zero of a
        // SECOND scope, mapping from h2 but styled as authored.
        assert.ok( html.includes( '<h2 class="h1">Note</h2>' ) );
        assert.ok( html.includes( '<h2 class="h1">Hello</h2>' ) );
        assert.ok( !html.includes( '<h1>Note</h1>' ) );
    } );

    it( 'renders sections with token layout classes and heading-aware tags', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        // Bleed and constrain (SCHEMA 11.8): the section element spans
        // the width, the inner container constrains and carries flex.
        assert.ok( html.includes( '<section class="w-full mt-sm md:mt-lg">' ) );
        assert.ok( html.includes( '<div class="mx-auto w-full max-w-wide px-md flex flex-row min-h-third gap-md">' ) );
        assert.ok( html.includes( 'basis-1/3 shrink-0' ) );
        assert.ok( html.includes( 'data-slug="hero-card"' ) );
        assert.ok( html.includes( '<main id="main" class="flex flex-col gap-lg py-lg">' ), 'rhythm spaces the page top and bottom too' );
    } );

    it( 'compiles markdown fields before the template sees them', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        assert.ok( html.includes( 'max-w-prose' ) );
        assert.ok( !html.includes( '# Hello' ) );
        assert.ok( !html.includes( '# Note' ) );
    } );

    it( 'assembles a page with no blocks as an empty shell, no invented content', async () =>
    {
        const { html, issues } = await assemblePage(
            { id: 'empty', title: 'Empty', slug: 'empty', blocks: [] },
            await optionsForFixture(),
        );

        assert.deepEqual( issues, [] );
        assert.ok( !/<h[1-6][\s>]/.test( html ), 'nothing the user did not author' );
        assert.ok( html.includes( '<main id="main"' ) );
    } );
} );

describe( 'assemblePage behaviors', () =>
{
    const pageWith = ( blocks: unknown[] ): PageInput => ( {
        id: '3f2b8c1a-9d4e-4f6a-8b2c-1e5d7a9c3b4f',
        title: 'Test',
        slug: 'test',
        blocks,
    } );

    it( 'omits hidden blocks entirely, before heading resolution', async () =>
    {
        const options = await optionsForFixture();
        const { html } = await assemblePage( pageWith( [
            { component: 'core/markdown', hidden: true, props: { content: '# Ghost' } },
            { component: 'core/markdown', props: { content: '# Visible' } },
        ] ), options );

        assert.ok( !html.includes( 'Ghost' ) );

        // The hidden block never renders, so the visible one IS the
        // first heading scope and maps from h1.
        assert.ok( html.includes( '<h1>Visible</h1>' ) );
    } );

    it( 'renders a purely layout section as a div, not a section', async () =>
    {
        const options = await optionsForFixture();
        const { html } = await assemblePage( pageWith( [
            {
                section: { gap: 'sm' },
                blocks: [ { component: 'core/image', props: { image: { src: '/a.jpg', alt: 'A' } } } ],
            },
        ] ), options );

        assert.ok( html.includes( '<div class="mx-auto w-full max-w-wide px-md flex flex-row gap-sm">' ) );
        assert.ok( !html.includes( '<section' ) );
        assert.ok( html.includes( '<img data-anchor="image" src="/a.jpg" alt="A">' ) );
    } );

    it( 'alternates section direction by depth, honoring explicit overrides', async () =>
    {
        const options = await optionsForFixture();
        const { html } = await assemblePage( pageWith( [
            {
                section: {},
                blocks: [
                    {
                        section: {},
                        blocks: [ { component: 'core/markdown', props: { content: 'deep' } } ],
                    },
                    {
                        section: { direction: 'layer' },
                        blocks: [ { component: 'core/markdown', props: { content: 'stacked' } } ],
                    },
                ],
            },
        ] ), options );

        // Children of a row section share its width (min-w-0 flex-1)
        // and sections default their gap to the theme gutter.
        assert.ok( html.includes( '<div class="mx-auto w-full max-w-wide px-md flex flex-row gap-md">' ) );
        assert.ok( html.includes( '<div class="min-w-0 flex-1 flex flex-col gap-md">' ) );
        assert.ok( html.includes( '<div class="min-w-0 flex-1 layer gap-md">' ) );
    } );

    it( 'reports unavailable components as issues and keeps building', async () =>
    {
        const options = await optionsForFixture();
        const { html, issues } = await assemblePage( pageWith( [
            { component: 'ghost-kit/ghost', props: {} },
            { component: 'core/markdown', props: { content: 'still here' } },
        ] ), options );

        assert.equal( issues.length, 1 );
        assert.ok( issues[ 0 ]?.message.includes( 'not available' ) );
        assert.ok( html.includes( 'still here' ) );
    } );

    it( 'deep markdown subordination maps consecutively within the scope', async () =>
    {
        const options = await optionsForFixture();
        const { html } = await assemblePage( pageWith( [
            { component: 'core/markdown', props: { content: '# Lead\n\n#### Jumpy\n' } },
        ] ), options );

        assert.ok( html.includes( '<h1>Lead</h1>' ), 'the first heading scope maps from h1, unclassed when authored and real agree' );
        assert.ok( html.includes( '<h2 class="h4">Jumpy</h2>' ), 'the remapped heading keeps its authored rank as the visual class' );
    } );

    it( 'clamps the heading sequence so the outline never skips (positional)', async () =>
    {
        const { clampHeadingSequence } = await import( './assemblePage.ts' );

        // Mikey's Outline catch: an h3 positioned before the h2 in
        // document order skips a level for the rotor. The clamp walks
        // in order - each heading at most one deeper than the last -
        // and never touches the VISUAL class (rule 7).
        assert.equal(
            clampHeadingSequence( '<h1>A</h1><h3 class="h4">B</h3><h2>C</h2><h3>D</h3>' ),
            '<h1>A</h1><h2 class="h4">B</h2><h2>C</h2><h3>D</h3>',
        );

        // Going shallower is always legal; a leading h2 (a header
        // region) never blocks the page's h1.
        assert.equal(
            clampHeadingSequence( '<h2>Nav</h2><h1>Title</h1><h2>Section</h2>' ),
            '<h2>Nav</h2><h1>Title</h1><h2>Section</h2>',
        );
    } );

    it( 'stamps morph links onto anchors, unique per page', async () =>
    {
        const options = await optionsForFixture();
        const { html, issues } = await assemblePage( pageWith( [
            { component: 'core/image', morph: 'hero', props: { image: { src: '/a.jpg', alt: 'A' } } },
            { component: 'core/image', morph: 'hero', props: { image: { src: '/b.jpg', alt: 'B' } } },
        ] ), options );

        // The first block's anchored element wears the link name plus
        // the anchor id as its view-transition-name (SCHEMA 6); the
        // duplicate reports and stays unstamped - transition names
        // are unique per page.
        assert.ok( html.includes( 'src="/a.jpg" alt="A" style="view-transition-name: hero-image"' ) );
        assert.equal( html.match( /view-transition-name: hero-image/g )?.length, 1 );
        assert.equal( issues.length, 1 );
        assert.match( issues[ 0 ]!.message, /already used at blocks\[0\]/ );
    } );

    it( 'interpolates {{ $... }} tokens and presents dates and references', async () =>
    {
        const options = await optionsForFixture();
        const venueId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const eventId = '11111111-2222-4333-8444-555555555555';
        const venues = {
            file: 'venues.json',
            label: 'Venues',
            fields: normalizeFields( { title: { type: 'text', label: 'Title' }, address: { type: 'text', label: 'Address' } } ),
            entries: [ { id: venueId, values: { title: 'The Armory', address: 'Portland, Oregon' }, hasOwnBlocks: false } ],
        };
        const events = {
            file: 'events.json',
            label: 'Events',
            fields: normalizeFields( {
                title: { type: 'text', label: 'Title' },
                date: { type: 'date', label: 'Date', rules: { format: 'short' } },
                location: { type: 'reference', label: 'Location', rules: { type: 'venues' } },
                stages: { type: 'reference', label: 'Stages', rules: { type: 'venues', multiple: true } },
            } ),
            entries: [ { id: eventId, values: { title: 'Talk of the town', date: '2026-09-05', location: venueId, stages: [ venueId, venueId ] }, hasOwnBlocks: false } ],
        };

        const { html, issues: pageIssues } = await assemblePage( pageWith( [ {
            repeat: {
                source: { collection: 'events' },
                component: 'core/markdown',
                props: {
                    width: 'prose',
                    content: '# {{ $entry.title }}\n\nat {{ $entry.location }} on {{ $entry.date }} for {{ $page.title }}. A {{ vueSample }} stays. Find it at {{ $entry.location.address }}. Stages: {{ $entry.stages }}. Stage towns: {{ $entry.stages.address }}.',
                },
            },
        } ] ), { ...options, collections: [ venues, events ] as never } );

        assert.deepEqual( pageIssues, [] );
        assert.ok( html.includes( '<h1>Talk of the town</h1>' ), 'inline tokens speak the entry scope' );
        assert.ok( html.includes( 'at The Armory on Sep 5, 2026 for Test.' ), 'references present as their target, dates in their field format, page.* in scope' );
        assert.ok( html.includes( '{{ vueSample }}' ), 'braces without the $ marker pass through untouched' );
        assert.ok( html.includes( 'Find it at Portland, Oregon.' ), 'bind-through reaches through the reference to its target fields' );
        assert.ok( html.includes( 'Stages: The Armory, The Armory.' ), 'a multiple reference presents as its targets’ names, joined' );
        assert.ok( html.includes( 'Stage towns: Portland, Oregon, Portland, Oregon.' ), 'bind-through into a multiple joins the targets’ presented values' );

        // "filter" narrows on RAW values; a matching-nothing repeat
        // renders its author-owned empty state, interpolated.
        const { html: filtered, issues: filterIssues } = await assemblePage( pageWith( [ {
            repeat: {
                source: { collection: 'events', filter: 'title == "No such"' },
                component: 'core/markdown',
                props: { width: 'prose', content: { $bind: 'entry.title' } },
                empty: 'Nothing on {{ $page.title }} yet.',
            },
        } ] ), { ...options, collections: [ venues, events ] as never } );

        assert.deepEqual( filterIssues, [] );
        assert.ok( !filtered.includes( 'Talk of the town' ) );
        assert.ok( filtered.includes( 'Nothing on Test yet.' ) );

        // A $bind of the same fields presents identically: binding
        // and interpolation share one presentation scope.
        const { html: bound } = await assemblePage( pageWith( [ {
            repeat: {
                source: { collection: 'events' },
                component: 'core/markdown',
                props: { width: 'prose', content: { $bind: 'entry.location' } },
            },
        } ] ), { ...options, collections: [ venues, events ] as never } );

        assert.ok( bound.includes( 'The Armory' ) );
    } );
} );
