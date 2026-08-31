import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemblePage, type PageInput, type AssembleOptions } from './assemblePage.ts';
import { loadCoreComponents } from './coreComponents.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { validateSiteConfig } from '../content/siteConfig.ts';
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
    it( 'assembles the home page with scaffolding, exactly one h1, and no issues', async () =>
    {
        const [ home ] = await fixturePages();
        const { html, issues } = await assemblePage( home as PageInput, await optionsForFixture() );

        assert.deepEqual( issues, [] );
        assert.equal( ( html.match( /<h1[\s>]/g ) ?? [] ).length, 1 );
        assert.ok( html.includes( '<h1>Home</h1>' ) );
        assert.ok( html.includes( '<title>Home</title>' ) );
        assert.ok( html.includes( '<a class="skip-link" href="#main">Skip to content</a>' ) );
        assert.ok( html.includes( '<meta name="generator" content="casomer 0.0.2">' ) );
        assert.ok( html.includes( '<header style="view-transition-name: casomer-header"></header>' ) );
        assert.ok( html.includes( '<footer style="view-transition-name: casomer-footer"></footer>' ) );
    } );

    it( 'remaps component headings into their scope from h2 down', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        // The card's authored template h2 is rank zero of its own scope.
        assert.ok( html.includes( '<h2 data-anchor="title">Hello</h2>' ) );

        // In the section scope, both markdown h1s are sibling rank zero.
        assert.ok( html.includes( '<h2>Note</h2>' ) );
        assert.ok( html.includes( '<h2>Hello</h2>' ) );
        assert.ok( !html.includes( '<h1>Note</h1>' ) );
    } );

    it( 'renders sections with token layout classes and heading-aware tags', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        assert.ok( html.includes( '<section class="flex flex-row min-h-third gap-md' ) );
        assert.ok( html.includes( 'mt-sm md:mt-lg' ) );
        assert.ok( html.includes( 'basis-1/3 shrink-0' ) );
        assert.ok( html.includes( 'data-slug="hero-card"' ) );
        assert.ok( html.includes( '<main id="main" class="flex flex-col gap-lg">' ) );
    } );

    it( 'compiles markdown fields before the template sees them', async () =>
    {
        const [ home ] = await fixturePages();
        const { html } = await assemblePage( home as PageInput, await optionsForFixture() );

        assert.ok( html.includes( 'max-w-prose' ) );
        assert.ok( !html.includes( '# Hello' ) );
        assert.ok( !html.includes( '# Note' ) );
    } );

    it( 'assembles a page with no blocks as scaffolding only', async () =>
    {
        const pages = await fixturePages();
        const about = pages[ 1 ] as PageInput;
        const { html, issues } = await assemblePage( about, await optionsForFixture() );

        assert.deepEqual( issues, [] );
        assert.ok( html.includes( '<h1>About</h1>' ) );
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
        assert.ok( html.includes( '<h2>Visible</h2>' ) );
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

        assert.ok( html.includes( '<div class="flex flex-row gap-sm">' ) );
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

        assert.ok( html.includes( '<div class="flex flex-row">' ) );
        assert.ok( html.includes( '<div class="flex flex-col">' ) );
        assert.ok( html.includes( '<div class="layer">' ) );
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

        assert.ok( html.includes( '<h2>Lead</h2>' ) );
        assert.ok( html.includes( '<h3>Jumpy</h3>' ) );
    } );
} );
