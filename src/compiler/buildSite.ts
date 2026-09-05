// caso build, as a function: a content directory and packages in, a
// dist/ directory out. Parameterizable by design (BUSINESS section 4.1):
// every input and the output target are explicit arguments, so building
// any git ref to any destination is plumbing for whoever checks the ref
// out, never a change here. The build validates first and refuses to
// write anything when validation fails: a broken site produces issues,
// not a broken dist/.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type SchemaIssue } from '../schema/manifest.ts';
import { type LoadedPackage } from '../schema/loadPackage.ts';
import { loadSiteDirectory, type SiteLoadResult } from '../content/loadSiteDirectory.ts';
import { collectionIsDraft, collectionPathSegments, entrySlug, pageIsDraft, pagePathSegments, pagesById, resolveEntryUrls, resolveMenus } from '../content/urlTree.ts';
import { termAndDescendantIds, entryLayoutOf, termLayoutOf } from '../content/contentDocuments.ts';
import { entryRequiredProblems } from '../content/contentProblems.ts';
import { loadCoreComponents } from './coreComponents.ts';
import { assemblePage, entryScopeOf, termScopeOf, type PageInput } from './assemblePage.ts';
import { generateThemeInputCss } from './themeCss.ts';
import { scanFonts } from './fonts.ts';
import { minifyHtml } from './minifyHtml.ts';
import { prettifyHtml } from './prettifyHtml.ts';

export interface BuildOptions
{
    readonly contentDirectory: string;
    readonly outputDirectory: string;
    readonly packages?: readonly LoadedPackage[];
    readonly generatorVersion?: string;
    readonly css?: boolean;
    readonly minify?: boolean;
}

export interface BuildResult
{
    readonly issues: readonly SchemaIssue[];
    readonly pagesWritten: readonly string[];
}

function resolveTailwindCssEntry (): string
{
    const require = createRequire( import.meta.url );

    return join( dirname( require.resolve( 'tailwindcss/package.json' ) ), 'index.css' ).replaceAll( '\\', '/' );
}

function resolveTailwindCli (): string
{
    const require = createRequire( import.meta.url );
    const packageFile = require.resolve( '@tailwindcss/cli/package.json' );
    const binField = ( require( '@tailwindcss/cli/package.json' ) as { bin: Record<string, string> | string } ).bin;
    const binPath = typeof binField === 'string' ? binField : Object.values( binField )[ 0 ] as string;

    return join( dirname( packageFile ), binPath );
}

// Cache busting is derived, never configured (DEVELOPMENT): each asset
// ships under a name carrying the hash of its own bytes, so a changed
// asset is a new URL and an unchanged one keeps its name across builds.
function hashedAssetName ( base: string, bytes: string | Uint8Array ): string
{
    const hash = createHash( 'sha256' ).update( bytes ).digest( 'hex' ).slice( 0, 8 );
    const dot = base.lastIndexOf( '.' );

    return `${base.slice( 0, dot )}.${hash}${base.slice( dot )}`;
}

// Entry pages get their public spelling from the entry's title
// (13.2); the derivation lives with the URL tree now that the
// assembler needs it too. Re-exported here for the existing callers.
export { entrySlug };

interface CollectionPage
{
    readonly page: PageInput;
    readonly relativeFile: string;
    readonly entryScope?: Readonly<Record<string, unknown>>;
    readonly termScope?: Readonly<Record<string, unknown>>;
    readonly termContext?: { readonly taxonomyStem: string; readonly termIds: readonly string[] };

    // A paginated index (SCHEMA 13.5): the first window renders here
    // and its pagination result fans out /page/2/ and beyond.
    readonly pageWindow?: { readonly stem: string; readonly size: number; readonly number: number; readonly base: string };
}

// Every collection with a public index emits a listing page at its
// stem, and every entry emits a page under it - through the shared
// template unless the entry has diverged with its own blocks (13.4).
function collectionPages ( site: SiteLoadResult, issues: SchemaIssue[] ): CollectionPage[]
{
    const pages: CollectionPage[] = [];
    const treeIndex = pagesById( site.pages );
    const pagePaths = new Set( site.pages.map( ( page ) => pagePathSegments( page, treeIndex ).join( '/' ) ) );

    for ( const collection of site.collections )
    {
        const stem = collection.file.replace( /\.json$/, '' );

        // Draft cascades down the URL tree (SCHEMA 13.6): a collection
        // mounted under a draft page publishes nothing.
        if ( collectionIsDraft( collection.parent, treeIndex ) ) { continue; }

        const mount = collectionPathSegments( collection.parent, treeIndex );
        const address = [ ...mount, stem ].join( '/' );

        if ( pagePaths.has( address ) )
        {
            issues.push( { path: collection.file, message: `A page already owns "/${address}/"; this collection's pages are not emitted. Rename or move one of them.` } );
            continue;
        }

        // index: false means the collection is not public-facing at
        // all (Mikey, 2026-09-03): no listing AND no entry pages -
        // "content that only feeds other pages" feeds repeats, never
        // URLs.
        if ( collection.indexBlocks === false ) { continue; }

        pages.push( {
            page: { id: `collection:${stem}`, title: collection.label, slug: address, blocks: collection.indexBlocks ?? [], ...( collection.indexTemplate === undefined ? {} : { template: collection.indexTemplate } ) },
            relativeFile: `${address}/index.html`,
            ...( collection.indexPageSize === undefined
                ? {}
                : { pageWindow: { stem, size: collection.indexPageSize, number: 1, base: `/${address}/` } } ),
        } );

        const taken = new Set<string>();

        for ( const entry of collection.entries )
        {
            if ( entry.draft === true ) { continue; }

            const chosen = entryLayoutOf( collection, entry );
            const blocks = chosen.blocks;

            if ( blocks === undefined ) { continue; }

            const slug = entrySlug( entry.values.title, entry.id, taken );

            pages.push( {
                page: { id: entry.id, title: String( entry.values.title ?? collection.label ), slug: `${address}/${slug}`, blocks, ...( chosen.template === undefined ? {} : { template: chosen.template } ) },
                relativeFile: `${address}/${slug}/index.html`,
                // The inherent entry.url points at THIS page; a real
                // field named "url" wins by spreading after.
                entryScope: { url: `/${address}/${slug}/`, ...entryScopeOf( entry, collection.fields, { collections: site.collections, taxonomies: site.taxonomies } ) },
            } );
        }
    }

    return pages;
}

// Public term pages (SCHEMA 13.3): a taxonomy with an active index
// emits the term listing at its stem and one page per term through
// the shared term template. Term slugs derive from names with the
// entry-slug rules; nested terms nest their URLs under their
// parent's, the URL tree applied to terms.
function taxonomyPages ( site: SiteLoadResult, issues: SchemaIssue[] ): CollectionPage[]
{
    const pages: CollectionPage[] = [];
    const treeIndex = pagesById( site.pages );
    const pagePaths = new Set( site.pages.map( ( page ) => pagePathSegments( page, treeIndex ).join( '/' ) ) );

    for ( const taxonomy of site.taxonomies )
    {
        if ( taxonomy.indexBlocks === false ) { continue; }

        const stem = taxonomy.file.replace( /\.json$/, '' );

        if ( pagePaths.has( stem ) )
        {
            issues.push( { path: taxonomy.file, message: `A page already owns "/${stem}/"; this taxonomy's pages are not emitted. Rename or move one of them.` } );
            continue;
        }

        pages.push( {
            page: { id: `taxonomy:${stem}`, title: taxonomy.label, slug: stem, blocks: taxonomy.indexBlocks ?? [], ...( taxonomy.indexTemplate === undefined ? {} : { template: taxonomy.indexTemplate } ) },
            relativeFile: `${stem}/index.html`,
        } );

        if ( taxonomy.templateBlocks === undefined ) { continue; }

        const taken = new Set<string>();
        const slugById = new Map<string, string>();

        for ( const term of taxonomy.terms ) { slugById.set( term.id, entrySlug( term.name, term.id, taken ) ); }

        for ( const term of taxonomy.terms )
        {
            const segments: string[] = [ slugById.get( term.id ) ?? term.id.slice( 0, 8 ) ];
            const visited = new Set<string>( [ term.id ] );
            let parent = term.parent;

            while ( parent !== undefined && !visited.has( parent ) )
            {
                visited.add( parent );
                segments.unshift( slugById.get( parent ) ?? '' );
                parent = taxonomy.terms.find( ( candidate ) => candidate.id === parent )?.parent;
            }

            const address = `${stem}/${segments.join( '/' )}`;

            pages.push( {
                page: { id: term.id, title: term.name, slug: address, blocks: termLayoutOf( taxonomy, term ).blocks ?? taxonomy.templateBlocks, ...( termLayoutOf( taxonomy, term ).template === undefined ? {} : { template: termLayoutOf( taxonomy, term ).template } ) },
                relativeFile: `${address}/index.html`,
                termScope: termScopeOf( term ),
                termContext: { taxonomyStem: stem, termIds: termAndDescendantIds( taxonomy.terms, term.id ) },
            } );
        }
    }

    return pages;
}

export async function buildSite ( options: BuildOptions ): Promise<BuildResult>
{
    const packages = options.packages ?? [];
    const site = await loadSiteDirectory( options.contentDirectory, packages );

    if ( site.issues.length > 0 ) { return { issues: site.issues, pagesWritten: [] }; }

    const coreComponents = await loadCoreComponents();
    const issues: SchemaIssue[] = [];
    const pagesWritten: string[] = [];
    const require = createRequire( import.meta.url );

    const assembleOptionsBase = {
        config: site.config,
        packages,
        coreComponents,
        collections: site.collections,
        taxonomies: site.taxonomies,
        entryUrls: resolveEntryUrls( site.pages, site.collections ),
        resolvedMenus: resolveMenus( site.config.menus, site.pages, site.collections, site.taxonomies ),
        ...( options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion } ),
    };
    const treeIndex = pagesById( site.pages );
    const contentPages = [ ...collectionPages( site, issues ), ...taxonomyPages( site, issues ) ];

    // Required entry fields are enforced at build, never while
    // drafting (the working tree is the draft; the editor nags;
    // publish is the enforcement moment). The check honors
    // requiredWhen and never validates a hidden field.
    issues.push( ...entryRequiredProblems( site.collections ) );

    // The delivered-site scripts: vendored Alpine and the MIT runtime
    // (TRANSITIONS section 1; the tedxv2 vendoring precedent).
    const alpineBytes = await readFile( join( dirname( require.resolve( 'alpinejs/package.json' ) ), 'dist', 'cdn.min.js' ) );
    const runtimeBytes = await readFile( fileURLToPath( new URL( '../../runtime/casomer-runtime.js', import.meta.url ) ) );
    const alpineName = hashedAssetName( 'alpine.min.js', alpineBytes );
    const runtimeName = hashedAssetName( 'casomer-runtime.js', runtimeBytes );

    // The stylesheet's bytes depend on the pages (Tailwind derives the
    // utilities from the rendered markup), so its hash needs a scan
    // pass: assemble into a scratch directory, compile the CSS against
    // that, and only then give the final pages the hashed name. The
    // scan pages carry default asset names; the class set is identical.
    let cssName: string | undefined;
    let cssBytes: string | undefined;

    if ( options.css !== false )
    {
        const scanDirectory = await mkdtemp( join( tmpdir(), 'casomer-build-scan-' ) );

        for ( const page of site.pages )
        {
            if ( pageIsDraft( page, treeIndex ) ) { continue; }

            const assembled = await assemblePage( page, assembleOptionsBase );

            await writeFile( join( scanDirectory, `${page.slug}.html` ), assembled.html, 'utf8' );
        }

        for ( const [ index, { page, entryScope, termScope, termContext } ] of contentPages.entries() )
        {
            const assembled = await assemblePage( page, {
                ...assembleOptionsBase,
                ...( entryScope === undefined ? {} : { entryScope } ),
                ...( termScope === undefined ? {} : { termScope } ),
                ...( termContext === undefined ? {} : { termContext } ),
            } );

            await writeFile( join( scanDirectory, `content-${index}.html` ), assembled.html, 'utf8' );
        }

        // The theme input's @source glob resolves relative to the input
        // file two levels up, so the scan directory mirrors the dist
        // layout: input under assets/css/, pages at the root.
        const scanCssDirectory = join( scanDirectory, 'assets', 'css' );
        const inputFile = join( scanCssDirectory, 'theme.css' );
        const outputFile = join( scanCssDirectory, 'main.css' );

        await mkdir( scanCssDirectory, { recursive: true } );
        await writeFile( inputFile, generateThemeInputCss( site.config, resolveTailwindCssEntry(), await scanFonts( options.contentDirectory ) ), 'utf8' );
        execFileSync(
            process.execPath,
            [ resolveTailwindCli(), '-i', inputFile, '-o', outputFile ],
            { cwd: scanDirectory, stdio: 'pipe' },
        );
        cssBytes = await readFile( outputFile, 'utf8' );
        cssName = hashedAssetName( 'main.css', cssBytes );
        await rm( scanDirectory, { recursive: true, force: true } );
    }

    const assembleOptions = {
        ...assembleOptionsBase,
        assets: {
            stylesheet: `/assets/css/${cssName ?? 'main.css'}`,
            alpineScript: `/assets/js/${alpineName}`,
            runtimeScript: `/assets/js/${runtimeName}`,
        },
    };

    await rm( options.outputDirectory, { recursive: true, force: true } );
    await mkdir( options.outputDirectory, { recursive: true } );

    for ( const page of site.pages )
    {
        // Draft pages persist and edit; the delivered site omits them,
        // and a draft ancestor drafts the whole subtree (SCHEMA 13.6).
        // The 404 page has no address in the tree; it emits below.
        if ( pageIsDraft( page, treeIndex ) || page.slug === '404' ) { continue; }

        const assembled = await assemblePage( page, assembleOptions );

        issues.push( ...assembled.issues.map( ( issue ) => ( { path: `${page.slug}: ${issue.path}`, message: issue.message } ) ) );

        const segments = pagePathSegments( page, treeIndex );
        const relativeFile = segments.length === 0 ? 'index.html' : `${segments.join( '/' )}/index.html`;
        const file = join( options.outputDirectory, ...relativeFile.split( '/' ) );

        await mkdir( dirname( file ), { recursive: true } );
        await writeFile( file, options.minify === false ? prettifyHtml( assembled.html ) : minifyHtml( assembled.html ), 'utf8' );
        pagesWritten.push( relativeFile );
    }

    for ( const { page, relativeFile, entryScope, termScope, termContext, pageWindow } of contentPages )
    {
        const extras = {
            ...( entryScope === undefined ? {} : { entryScope } ),
            ...( termScope === undefined ? {} : { termScope } ),
            ...( termContext === undefined ? {} : { termContext } ),
        };
        const assembled = await assemblePage( page, {
            ...assembleOptions,
            ...extras,
            ...( pageWindow === undefined ? {} : { pageWindow } ),
        } );

        issues.push( ...assembled.issues.map( ( issue ) => ( { path: `${page.slug}: ${issue.path}`, message: issue.message } ) ) );

        const file = join( options.outputDirectory, ...relativeFile.split( '/' ) );

        await mkdir( dirname( file ), { recursive: true } );
        await writeFile( file, options.minify === false ? prettifyHtml( assembled.html ) : minifyHtml( assembled.html ), 'utf8' );
        pagesWritten.push( relativeFile );

        // Pagination fans out (SCHEMA 13.5): the first window's
        // render says how many pages the listing needs; /page/2/ and
        // beyond render with their own windows.
        const totalPages = pageWindow === undefined ? 1 : ( assembled.pagination?.totalPages ?? 1 );

        for ( let n = 2; n <= totalPages; n += 1 )
        {
            const windowed = await assemblePage( page, {
                ...assembleOptions,
                ...extras,
                pageWindow: { ...pageWindow as NonNullable<typeof pageWindow>, number: n },
            } );

            issues.push( ...windowed.issues.map( ( issue ) => ( { path: `${page.slug}/page/${n}: ${issue.path}`, message: issue.message } ) ) );

            const pageFile = join( options.outputDirectory, ...`${page.slug}/page/${n}/index.html`.split( '/' ) );

            await mkdir( dirname( pageFile ), { recursive: true } );
            await writeFile( pageFile, options.minify === false ? prettifyHtml( windowed.html ) : minifyHtml( windowed.html ), 'utf8' );
            pagesWritten.push( `${page.slug}/page/${n}/index.html` );
        }
    }

    // The 404 page (SCHEMA 13.6, a reserved page) emits as /404.html -
    // the static-hosting convention - only when blocks are authored:
    // nothing is ever scaffolded.
    const notFoundPage = site.pages.find( ( page ) => page.slug === '404' );

    if ( notFoundPage !== undefined && notFoundPage.blocks.length > 0 )
    {
        const assembled = await assemblePage( notFoundPage, assembleOptions );

        issues.push( ...assembled.issues.map( ( issue ) => ( { path: `404: ${issue.path}`, message: issue.message } ) ) );
        await writeFile( join( options.outputDirectory, '404.html' ), options.minify === false ? prettifyHtml( assembled.html ) : minifyHtml( assembled.html ), 'utf8' );
        pagesWritten.push( '404.html' );
    }

    // Media travels with the site (SCHEMA 13.4): whatever lives in
    // Only REFERENCED media ships (Mikey: "if media is not used it
    // should not publish in /dist"). Usage is the same text scan the
    // library uses - /media/<name> across every owned document -
    // deliberately over-inclusive: a file referenced only by a draft
    // page still ships; an unused library file never does.
    try
    {
        const mediaNames = await readdir( join( options.contentDirectory, 'media' ) );
        const referenced = new Set<string>();

        for ( const file of await readdir( options.contentDirectory ) )
        {
            if ( !file.endsWith( '.json' ) ) { continue; }

            const text = await readFile( join( options.contentDirectory, file ), 'utf8' );

            for ( const match of text.matchAll( /\/media\/([A-Za-z0-9._-]+)/g ) )
            {
                referenced.add( match[ 1 ] as string );
            }
        }

        for ( const name of mediaNames )
        {
            if ( !referenced.has( name ) ) { continue; }

            await mkdir( join( options.outputDirectory, 'media' ), { recursive: true } );
            await cp( join( options.contentDirectory, 'media', name ), join( options.outputDirectory, 'media', name ) );
        }
    }
    catch { /* no media directory is a fine site */ }

    // Self-hosted fonts ship with the site; their @font-face rules
    // are already in the theme CSS.
    try
    {
        await cp( join( options.contentDirectory, 'fonts' ), join( options.outputDirectory, 'fonts' ), { recursive: true } );
    }
    catch { /* no fonts directory is a fine site */ }

    const jsDirectory = join( options.outputDirectory, 'assets', 'js' );

    await mkdir( jsDirectory, { recursive: true } );
    await writeFile( join( jsDirectory, alpineName ), alpineBytes );
    await writeFile( join( jsDirectory, runtimeName ), runtimeBytes );

    if ( cssName !== undefined && cssBytes !== undefined )
    {
        const cssDirectory = join( options.outputDirectory, 'assets', 'css' );

        await mkdir( cssDirectory, { recursive: true } );
        await writeFile( join( cssDirectory, cssName ), cssBytes, 'utf8' );
    }

    return { issues, pagesWritten };
}
