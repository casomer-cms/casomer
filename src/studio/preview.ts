// The canvas render path (EDITOR section 7, DEVELOPMENT section 6.1
// slice 2): Studio previews pages through the same assemblePage the
// compiler uses, in memory, per request. Preview parity is structural
// because there is exactly one implementation to agree with. Theme CSS
// still needs the Tailwind pass, so it is generated into a per-session
// cache directory and rebuilt only when the theme itself changes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemblePage, entryScopeOf, termScopeOf } from '../compiler/assemblePage.ts';
import { loadCoreComponents } from '../compiler/coreComponents.ts';
import { generateThemeInputCss } from '../compiler/themeCss.ts';
import { scanFonts } from '../compiler/fonts.ts';
import { loadSiteDirectory } from '../content/loadSiteDirectory.ts';
import { type PresentationDocs } from '../content/presentation.ts';
import { collectionIsDraft, collectionPathSegments, pageIsDraft, pagePathSegments, pagesById, resolveEntryUrls, resolveMenus } from '../content/urlTree.ts';
import { entrySlug } from '../compiler/buildSite.ts';
import { termAndDescendantIds, entryLayoutOf } from '../content/contentDocuments.ts';
import { type LoadedCollection } from '../content/contentDocuments.ts';
import { type LoadedComponent, type LoadedPackage } from '../schema/loadPackage.ts';
import { type SchemaIssue } from '../schema/manifest.ts';

export interface PreviewOptions
{
    readonly contentDirectory: string;
    readonly packages: readonly LoadedPackage[];
    readonly generatorVersion?: string;
}

export interface RenderedPreview
{
    readonly html?: string;
    readonly issues: readonly SchemaIssue[];
}

export interface PreviewPipeline
{
    renderPage ( slug: string, editing?: boolean ): Promise<RenderedPreview>;
    renderCollectionSurface ( stem: string, surface: 'index' | 'template', editing?: boolean, sampleEntryId?: string, pageNumber?: number, layoutName?: string ): Promise<RenderedPreview>;
    renderTaxonomySurface ( stem: string, surface: 'index' | 'template', editing?: boolean, sampleTermId?: string ): Promise<RenderedPreview>;
    renderRegion ( region: string ): Promise<RenderedPreview>;
    renderPageTemplate ( name: string, samplePageId?: string, editing?: boolean ): Promise<RenderedPreview>;
    renderComponentSample ( reference: string ): Promise<RenderedPreview>;
    renderNotFound ( editing?: boolean ): Promise<RenderedPreview>;
    renderEntryLayout ( stem: string, entryId: string, editing?: boolean ): Promise<RenderedPreview>;
    renderAddress ( address: string ): Promise<RenderedPreview>;
    themeCss (): Promise<string>;
    alpineFile (): string;
    runtimeFile (): string;
}

// The ghosting pass (EDITOR "Picker previews are derived and
// ghosted"): the example renders through the real path, then text
// runs become length-proportional bars and media becomes the media
// plate - real layout, spacing, and theme color survive; unreadably
// small text never ships. Deterministic (a pure function of the
// rendered DOM), and local to the sample document.
const ghostSnippet = `<style>
.cs-ghost-bar { display: inline-block; max-width: 100%; height: 0.62em; min-height: 3px; border-radius: 999px; background: currentColor; opacity: 0.38; vertical-align: baseline; }
.cs-ghost-plate { display: grid; place-content: center; width: 100%; min-height: 3em; aspect-ratio: 16 / 9; border-radius: 6px; background: color-mix(in srgb, currentColor 16%, transparent); }
.cs-ghost-plate svg { width: 22%; max-width: 64px; min-width: 24px; height: auto; opacity: 0.55; }
</style>
<script>
( () =>
{
    const imageGlyph = '<svg viewBox="0 0 40 32" fill="none"><rect x="1" y="1" width="38" height="30" rx="3" stroke="currentColor" stroke-width="2"></rect><circle cx="12" cy="11" r="3" stroke="currentColor" stroke-width="2"></circle><path d="M6 26l9-9 6 6 5-5 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    const playGlyph = '<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2"></circle><path d="M16 13l12 7-12 7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>';

    for ( const media of [ ...document.body.querySelectorAll( 'img, video, iframe' ) ] )
    {
        const plate = document.createElement( 'div' );

        plate.className = media.className === '' ? 'cs-ghost-plate' : media.className + ' cs-ghost-plate';
        plate.innerHTML = media.tagName === 'IMG' ? imageGlyph : playGlyph;
        media.replaceWith( plate );
    }

    const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
    const runs = [];
    let node;

    while ( ( node = walker.nextNode() ) !== null )
    {
        if ( node.textContent.trim() !== '' && node.parentElement?.closest( 'script, style' ) === null ) { runs.push( node ); }
    }

    for ( const run of runs )
    {
        const bar = document.createElement( 'span' );

        bar.className = 'cs-ghost-bar';
        bar.style.width = 'min(' + ( run.textContent.trim().length * 0.55 ).toFixed( 1 ) + 'ch, 100%)';
        run.replaceWith( bar );
    }
} )();
</script>`;

// The template canvas previews through a real entry when one exists -
// the caller can pick which - and an empty collection gets a ghost
// entry synthesized from the fields, so the template is editable
// before any content arrives.
function sampleEntryScope (
    collection: LoadedCollection,
    sampleEntryId?: string,
    docs?: PresentationDocs,
    entryUrls?: Readonly<Record<string, string>>,
): Record<string, unknown>
{
    const chosen = sampleEntryId === undefined
        ? undefined
        : collection.entries.find( ( entry ) => entry.id === sampleEntryId );
    const first = chosen ?? collection.entries[ 0 ];

    if ( first !== undefined )
    {
        // The inherent entry.url; a real field named "url" wins.
        return { url: entryUrls?.[ first.id ] ?? '', ...entryScopeOf( first, collection.fields, docs ) };
    }

    const values = Object.fromEntries(
        Object.entries( collection.fields ).map( ( [ key, field ] ) =>
        {
            if ( field.type === 'toggle' ) { return [ key, false ]; }
            if ( field.type === 'number' ) { return [ key, 0 ]; }
            if ( field.type === 'list' ) { return [ key, [] ]; }

            return [ key, key === 'title' ? `Sample ${collection.label.toLowerCase()}` : field.label ];
        } ),
    );

    return { id: 'sample', ...values };
}

function resolveTailwind (): { entry: string; cli: string }
{
    const require = createRequire( import.meta.url );
    const entry = join( dirname( require.resolve( 'tailwindcss/package.json' ) ), 'index.css' ).replaceAll( '\\', '/' );
    const packageFile = require.resolve( '@tailwindcss/cli/package.json' );
    const binField = ( require( '@tailwindcss/cli/package.json' ) as { bin: Record<string, string> | string } ).bin;
    const binPath = typeof binField === 'string' ? binField : Object.values( binField )[ 0 ] as string;

    return { entry, cli: join( dirname( packageFile ), binPath ) };
}

export function createPreviewPipeline ( options: PreviewOptions ): PreviewPipeline
{
    let coreComponents: ReadonlyMap<string, LoadedComponent> | undefined;
    let cssDirectory: string | undefined;
    let cachedCssInput: string | undefined;
    let cachedCss: string | undefined;
    let cssInFlight: Promise<string> | undefined;
    const runTailwind = promisify( execFile );

    async function core (): Promise<ReadonlyMap<string, LoadedComponent>>
    {
        coreComponents = coreComponents ?? await loadCoreComponents();
        return coreComponents;
    }

    return {
        async renderPage ( slug, editing = true )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const page = site.pages.find( ( candidate ) => candidate.slug === slug );

            if ( page === undefined )
            {
                return { issues: [ { path: slug, message: `No page has the slug "${slug}".` } ] };
            }

            // The pure preview is the real output: a draft page is
            // omitted from it, exactly as the build omits it - and a
            // draft ancestor drafts the whole subtree (SCHEMA 13.6).
            // The editing canvas still renders drafts - that is where
            // they get finished.
            if ( !editing && pageIsDraft( page, pagesById( site.pages ) ) )
            {
                return { issues: [ { path: slug, message: 'This page is a draft (or sits under one): it is left out of the published site until the Draft switch clears.' } ] };
            }

            const assembled = await assemblePage( page, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        async renderCollectionSurface ( stem, surface, editing = true, sampleEntryId = undefined, pageNumber = 1, layoutName = undefined )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const collection = site.collections.find( ( candidate ) => candidate.file === `${stem}.json` );

            if ( collection === undefined )
            {
                return { issues: [ { path: stem, message: `No collection lives in "${stem}.json".` } ] };
            }

            // The entry layout (SCHEMA 13.4, named 2026-09-02): by name
            // when the canvas asks for one; else the sample entry's
            // own choice - its named layout, or its own blocks when
            // rogue - which is also the visitor's view; else default.
            const isIndex = surface === 'index';
            const sampleEntry = collection.entries.find( ( candidate ) => candidate.id === sampleEntryId );
            const chosen = layoutName !== undefined
                ? { blocks: collection.layouts[ layoutName ]?.blocks, template: collection.layouts[ layoutName ]?.template }
                : ( sampleEntry === undefined
                        ? { blocks: collection.layouts.default?.blocks, template: collection.layouts.default?.template }
                        : entryLayoutOf( collection, sampleEntry ) );
            const blocks = isIndex
                ? ( collection.indexBlocks === false ? [] : ( collection.indexBlocks ?? [] ) )
                : ( chosen.blocks ?? [] );
            const layoutTemplate = isIndex ? collection.indexTemplate : chosen.template;
            const page = {
                id: `collection:${stem}:${surface}`,
                title: collection.label,
                slug: stem,
                blocks,
                ...( layoutTemplate === undefined ? {} : { template: layoutTemplate } ),
            };

            // A paginated index previews through the same window
            // machinery the build uses; the canvas shows page one.
            const mount = [ ...collectionPathSegments( collection.parent, pagesById( site.pages ) ), stem ].join( '/' );
            const entryUrls = resolveEntryUrls( site.pages, site.collections );
            const assembled = await assemblePage( page, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls,
                blockMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...( isIndex && collection.indexPageSize !== undefined
                    ? { pageWindow: { stem, size: collection.indexPageSize, number: pageNumber, base: `/${mount}/` } }
                    : {} ),
                ...( isIndex ? {} : { entryScope: sampleEntryScope( collection, sampleEntryId, { collections: site.collections, taxonomies: site.taxonomies }, entryUrls ) } ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // The taxonomy twin (SCHEMA 13.3): the term listing and the
        // shared term template, previewed through a sample term.
        async renderTaxonomySurface ( stem, surface, editing = true, sampleTermId = undefined )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const taxonomy = site.taxonomies.find( ( candidate ) => candidate.file === `${stem}.json` );

            if ( taxonomy === undefined )
            {
                return { issues: [ { path: stem, message: `No taxonomy lives in "${stem}.json".` } ] };
            }

            const isIndex = surface === 'index';
            const blocks = isIndex
                ? ( taxonomy.indexBlocks === false ? [] : ( taxonomy.indexBlocks ?? [] ) )
                : ( taxonomy.templateBlocks ?? [] );
            const term = taxonomy.terms.find( ( candidate ) => candidate.id === sampleTermId ) ?? taxonomy.terms[ 0 ];
            const layoutTemplate = isIndex ? taxonomy.indexTemplate : taxonomy.termTemplate;
            const page = {
                id: `taxonomy:${stem}:${surface}`,
                title: taxonomy.label,
                slug: stem,
                blocks,
                ...( layoutTemplate === undefined ? {} : { template: layoutTemplate } ),
            };

            const assembled = await assemblePage( page, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...( isIndex || term === undefined
                    ? {}
                    : {
                            termScope: termScopeOf( term ),
                            termContext: { taxonomyStem: stem, termIds: termAndDescendantIds( taxonomy.terms, term.id ) },
                        } ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // The visitor-facing preview (Mikey: /preview/ is the human
        // route): resolve a full site ADDRESS - nested pages, mounted
        // collection indexes and entries, taxonomy indexes and term
        // pages - exactly as the build would emit it, drafts omitted.
        async renderAddress ( address )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const clean = address.replace( /^\/+|\/+$/g, '' );
            const treeIndex = pagesById( site.pages );

            for ( const page of site.pages )
            {
                if ( page.slug === '404' || pagePathSegments( page, treeIndex ).join( '/' ) !== clean ) { continue; }

                if ( pageIsDraft( page, treeIndex ) )
                {
                    return { issues: [ { path: clean, message: 'This page is a draft: it is left out of the published site until the Draft switch clears.' } ] };
                }

                return this.renderPage( page.slug, false );
            }

            for ( const collection of site.collections )
            {
                if ( collectionIsDraft( collection.parent, treeIndex ) ) { continue; }

                if ( collection.indexBlocks === false ) { continue; }

                const stem = collection.file.replace( /\.json$/, '' );
                const base = [ ...collectionPathSegments( collection.parent, treeIndex ), stem ].join( '/' );

                if ( clean === base )
                {
                    return this.renderCollectionSurface( stem, 'index', false );
                }

                // A paginated index answers at /page/2/ and beyond.
                const pageMatch = /^page\/([2-9]\d*)$/.exec( clean.startsWith( `${base}/` ) ? clean.slice( base.length + 1 ) : '' );

                if ( pageMatch !== null && collection.indexPageSize !== undefined )
                {
                    return this.renderCollectionSurface( stem, 'index', false, undefined, Number( pageMatch[ 1 ] ) );
                }

                if ( clean.startsWith( `${base}/` ) )
                {
                    const taken = new Set<string>();

                    for ( const entry of collection.entries )
                    {
                        const slug = entrySlug( entry.values.title, entry.id, taken );

                        if ( clean === `${base}/${slug}` && entry.draft !== true )
                        {
                            return this.renderCollectionSurface( stem, 'template', false, entry.id );
                        }
                    }
                }
            }

            for ( const taxonomy of site.taxonomies )
            {
                if ( taxonomy.indexBlocks === false ) { continue; }

                const stem = taxonomy.file.replace( /\.json$/, '' );

                if ( clean === stem ) { return this.renderTaxonomySurface( stem, 'index', false ); }

                if ( clean.startsWith( `${stem}/` ) && taxonomy.templateBlocks !== undefined )
                {
                    const taken = new Set<string>();
                    const slugById = new Map( taxonomy.terms.map( ( term ) => [ term.id, entrySlug( term.name, term.id, taken ) ] ) );

                    for ( const term of taxonomy.terms )
                    {
                        const segments = [ slugById.get( term.id ) ?? '' ];
                        const visited = new Set( [ term.id ] );
                        let parent = term.parent;

                        while ( parent !== undefined && !visited.has( parent ) )
                        {
                            visited.add( parent );
                            segments.unshift( slugById.get( parent ) ?? '' );
                            parent = taxonomy.terms.find( ( candidate ) => candidate.id === parent )?.parent;
                        }

                        if ( clean === `${stem}/${segments.join( '/' )}` )
                        {
                            return this.renderTaxonomySurface( stem, 'template', false, term.id );
                        }
                    }
                }
            }

            return { issues: [ { path: clean === '' ? '/' : clean, message: `Nothing is published at "/${clean}".` } ] };
        },

        // The page template canvas (SCHEMA 12.6): the template's chrome
        // and layout with markers, lit by a sample page's content in
        // the slot (marker-less: the page edits on its own canvas).
        async renderPageTemplate ( name, samplePageId = undefined, editing = true )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            if ( site.config.templates[ name ] === undefined )
            {
                return { issues: [ { path: name, message: `There is no page template "${name}".` } ] };
            }

            // The slot lights only with a chosen sample (Mikey: default
            // None); otherwise it is an empty, stamped space.
            const sample = site.pages.find( ( candidate ) => candidate.id === samplePageId )
                ?? { id: `template:${name}`, title: name, slug: name, blocks: [] };
            const assembled = await assemblePage( { ...sample, template: name }, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: false,
                templateMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // The region canvas (SCHEMA 12.5): the region's blocks as
        // their own editable surface - markers on, and the config's
        // own regions stripped so the shell doesn't render the
        // region around itself.
        async renderRegion ( region )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            // Every name is a partial (SCHEMA 12.5) on the partial-fit
            // canvas; header and footer are the two every site has.
            const blocks = site.config.partials?.[ region ];

            if ( blocks === undefined )
            {
                return { issues: [ { path: region, message: `There is no partial "${region}".` } ] };
            }

            const assembled = await assemblePage( {
                id: `region:${region}`,
                title: region === 'header' ? 'Header' : ( region === 'footer' ? 'Footer' : region ),
                slug: region,
                blocks,
            }, {
                config: site.config,
                bare: true,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: true,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // A component's ghost preview (the picker's card): the first
        // declared example rendered through the same pipeline as any
        // page, one block, chrome-free. A component with no example
        // renders through empty props - the picker shows its glyph
        // instead, so this path mostly serves declared examples.
        async renderComponentSample ( reference )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const split = /^(.*)\/([^/]+)$/.exec( reference );
            const packageName = split?.[ 1 ] ?? '';
            const id = split?.[ 2 ] ?? '';
            const component = packageName === 'core'
                ? ( await core() ).get( id )
                : options.packages.find( ( candidate ) => candidate.manifest.name === packageName )?.components.get( id );

            if ( component === undefined )
            {
                return { issues: [ { path: reference, message: `No component answers to "${reference}".` } ] };
            }

            const assembled = await assemblePage( {
                id: `sample:${reference}`,
                title: component.manifest.title,
                slug: 'component-sample',
                blocks: [ { component: reference, props: component.manifest.examples[ 0 ]?.props ?? {} } ],
            }, {
                config: site.config,
                bare: true,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: false,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html.replace( '</body>', `${ghostSnippet}</body>` ), issues: assembled.issues };
        },

        // A diverged entry's own layout (SCHEMA 13.4): the entry's
        // blocks as a full-page canvas, with the entry itself in
        // scope - "break out of the mold" editing.
        async renderEntryLayout ( stem, entryId, editing = true )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            const collection = site.collections.find( ( candidate ) => candidate.file === `${stem}.json` );
            const entry = collection?.entries.find( ( candidate ) => candidate.id === entryId );

            if ( collection === undefined || entry === undefined )
            {
                return { issues: [ { path: stem, message: 'No such entry to lay out.' } ] };
            }

            const entryUrls = resolveEntryUrls( site.pages, site.collections );
            const assembled = await assemblePage( {
                id: entry.id,
                title: String( entry.values.title ?? collection.label ),
                slug: stem,
                blocks: entry.blocks ?? [],
                ...( entryLayoutOf( collection, entry ).template === undefined ? {} : { template: entryLayoutOf( collection, entry ).template } ),
            }, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls,
                blockMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                entryScope: { url: entryUrls[ entry.id ] ?? '', ...entryScopeOf( entry, collection.fields, { collections: site.collections, taxonomies: site.taxonomies } ) },
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // The user-authored 404 page (Mikey): a full-page canvas -
        // regions and all, since visitors see it as a real page.
        async renderNotFound ( editing = true )
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return { issues: site.issues }; }

            // The reserved 404 page (SCHEMA 13.6). Unauthored means
            // unpublished: the pure view declines and the caller falls
            // back to its plain message; only the editing canvas
            // renders the empty state.
            const notFoundPage = site.pages.find( ( page ) => page.slug === '404' ) ?? { id: 'not-found', title: 'Not found', slug: '404', blocks: [] };

            if ( !editing && notFoundPage.blocks.length === 0 )
            {
                return { issues: [ { path: '404', message: 'No 404 page is authored.' } ] };
            }

            const assembled = await assemblePage( notFoundPage, {
                config: site.config,
                packages: options.packages,
                coreComponents: await core(),
                collections: site.collections,
                taxonomies: site.taxonomies,
                entryUrls: resolveEntryUrls( site.pages, site.collections ),
                blockMarkers: editing,
                resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
                ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
            } );

            return { html: assembled.html, issues: assembled.issues };
        },

        // The Tailwind pass runs ASYNC and deduped: a synchronous
        // compile here once blocked the whole event loop for seconds
        // on a cold start, and every request behind it - previews,
        // the API, all of it - read as a hung studio.
        async themeCss ()
        {
            const site = await loadSiteDirectory( options.contentDirectory, options.packages );

            if ( site.issues.length > 0 ) { return ''; }

            const tailwind = resolveTailwind();
            const input = generateThemeInputCss( site.config, tailwind.entry, await scanFonts( options.contentDirectory ) );

            if ( cachedCss !== undefined && cachedCssInput === input ) { return cachedCss; }

            if ( cssInFlight !== undefined ) { return cssInFlight; }

            cssInFlight = ( async () =>
            {
                cssDirectory = cssDirectory ?? await mkdtemp( join( tmpdir(), 'casomer-studio-css-' ) );

                // The scratch dir mirrors the build's scan pass
                // exactly: rendered pages at the root for Tailwind to
                // derive utilities from, the input at assets/css depth
                // so its @source glob resolves to the scratch root and
                // nowhere else (at the temp root it resolves to all of
                // AppData, and the compile reads as a hung studio).
                // Drafts and collection surfaces render too - their
                // canvases need their classes.
                const assembleBase = {
                    config: site.config,
                    packages: options.packages,
                    coreComponents: await core(),
                    collections: site.collections,
                };

                for ( const [ position, page ] of site.pages.entries() )
                {
                    const assembled = await assemblePage( page, assembleBase );

                    await writeFile( join( cssDirectory, `page-${position}.html` ), assembled.html, 'utf8' );
                }

                for ( const collection of site.collections )
                {
                    const stem = collection.file.replace( /\.json$/, '' );
                    const surfaces = {
                        index: Array.isArray( collection.indexBlocks ) ? collection.indexBlocks : [],
                        ...Object.fromEntries( Object.entries( collection.layouts ).map( ( [ name, layout ] ) => [ `layout-${name}`, layout.blocks ] ) ),
                    };

                    for ( const [ kind, blocks ] of Object.entries( surfaces ) )
                    {
                        const scanTemplate = kind === 'index' ? collection.indexTemplate : collection.layouts[ kind.replace( /^layout-/, '' ) ]?.template;
                        const assembled = await assemblePage(
                            { id: `scan:${stem}:${kind}`, title: collection.label, slug: stem, blocks, ...( scanTemplate === undefined ? {} : { template: scanTemplate } ) },
                            assembleBase,
                        );

                        await writeFile( join( cssDirectory, `surface-${stem}-${kind}.html` ), assembled.html, 'utf8' );
                    }
                }

                const cssHome = join( cssDirectory, 'assets', 'css' );

                await mkdir( cssHome, { recursive: true } );

                const inputFile = join( cssHome, 'theme.css' );
                const outputFile = join( cssHome, 'main.css' );

                await writeFile( inputFile, input, 'utf8' );
                await runTailwind(
                    process.execPath,
                    [ tailwind.cli, '-i', inputFile, '-o', outputFile ],
                    { cwd: cssDirectory },
                );

                cachedCssInput = input;
                cachedCss = await readFile( outputFile, 'utf8' );
                return cachedCss;
            } )();

            try
            {
                return await cssInFlight;
            }
            finally
            {
                cssInFlight = undefined;
            }
        },

        alpineFile ()
        {
            const require = createRequire( import.meta.url );

            return join( dirname( require.resolve( 'alpinejs/package.json' ) ), 'dist', 'cdn.min.js' );
        },

        runtimeFile ()
        {
            return fileURLToPath( new URL( '../../runtime/casomer-runtime.js', import.meta.url ) );
        },
    };
}
