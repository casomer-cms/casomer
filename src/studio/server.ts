// caso studio (SCHEMA section 15): serves the Studio chrome, the API it
// talks to, and the canvas preview rendered through the shared
// assemblePage path. This server edits files and drives git, so it is
// never a deployed service: it binds 127.0.0.1 by default, and every
// request is gated by a per-session token (the Jupyter/Vite pattern)
// carried first in the printed link's query and from then on in a
// cookie. The session watches the content documents so hand edits
// reflect in the chrome (section 15's watching rule).

import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';

import { defaultMediaSettings, optimizeUpload } from './optimize.ts';
import { loadSiteDirectory } from '../content/loadSiteDirectory.ts';
import { parseJsonDocument, serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';
import { buildSite } from '../compiler/buildSite.ts';
import { appendIgnoreLines, commit, hasRemote, hasStagedChanges, pushCurrentBranch, removeIgnoreLines, runGit, stagePaths } from '../git/repository.ts';
import { journalRedo, journalSnapshot, journalUndo, ownedContentFiles } from '../git/journal.ts';
import { entryRequiredProblems } from '../content/contentProblems.ts';

// Journal operations serialize: a spammed undo key fires overlapping
// requests, and interleaved git ref updates would lose steps. One at
// a time, in arrival order.
let journalChain: Promise<unknown> = Promise.resolve();

function withJournalLock<T> ( operation: () => Promise<T> ): Promise<T>
{
    const result = journalChain.then( operation );

    journalChain = result.catch( () => undefined );
    return result;
}
import { loadCoreComponents } from '../compiler/coreComponents.ts';
import { normalizeFields, FieldSchemaError } from '../schema/fields.ts';
import { type LoadedComponent, type LoadedPackage } from '../schema/loadPackage.ts';
import { createPreviewPipeline, type PreviewPipeline } from './preview.ts';

const contentTypes: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

const tokenCookieName = 'casomer_studio_token';

// Every content document counts: the reserved names plus the
// self-describing collection and taxonomy files (SCHEMA section 13.1).
function isWatchedDocument ( filename: string ): boolean
{
    return filename.endsWith( '.json' );
}

// The chrome's vendored runtimes, served from node_modules: Alpine is
// the chrome's framework (DEVELOPMENT section 2, Alpine inside and
// out) and the Tailwind browser build compiles the chrome's styles at
// runtime - vendored, never a CDN, so Studio works offline and never
// phones out.
const vendorFiles: Readonly<Record<string, () => string>> = {
    '/vendor/alpine.js': () =>
    {
        const require = createRequire( import.meta.url );

        return join( dirname( require.resolve( 'alpinejs/package.json' ) ), 'dist', 'cdn.min.js' );
    },
    '/vendor/alpine-sort.js': () =>
    {
        const require = createRequire( import.meta.url );

        return join( dirname( require.resolve( '@alpinejs/sort/package.json' ) ), 'dist', 'cdn.min.js' );
    },
    '/vendor/tailwind.js': () =>
    {
        const require = createRequire( import.meta.url );

        return join( dirname( require.resolve( '@tailwindcss/browser/package.json' ) ), 'dist', 'index.global.js' );
    },
};

export interface StudioServerOptions
{
    readonly contentDirectory: string;
    readonly assetsDirectory: string;
    readonly packages?: readonly LoadedPackage[];
    readonly generatorVersion?: string;
    readonly host?: string;
    readonly token?: string;
}

export interface StudioServer
{
    readonly url: string;
    readonly port: number;
    readonly token: string;
    close (): Promise<void>;
}

function resolveWithin ( root: string, urlPath: string ): string | undefined
{
    const cleanRoot = normalize( root ).replace( /[\\/]+$/, '' );
    const resolved = normalize( join( cleanRoot, ...urlPath.split( '/' ).filter( ( part ) => part !== '' ) ) );

    return resolved === cleanRoot || resolved.startsWith( cleanRoot + sep ) ? resolved : undefined;
}

function requestToken ( request: IncomingMessage ): string | undefined
{
    const query = new URL( request.url ?? '/', 'http://localhost' ).searchParams.get( 't' );

    if ( query !== null ) { return query; }

    for ( const pair of ( request.headers.cookie ?? '' ).split( ';' ) )
    {
        const [ name, value ] = pair.trim().split( '=' );

        if ( name === tokenCookieName && value !== undefined ) { return value; }
    }

    return undefined;
}

// The project is the directory that holds the content; the fixture
// convention of a content/ subdirectory should not name every project
// "content".
function projectNameFor ( contentDirectory: string ): string
{
    const name = basename( normalize( contentDirectory ).replace( /[\\/]+$/, '' ) );

    return name === 'content' ? basename( dirname( normalize( contentDirectory ) ) ) : name;
}

// The chrome may not be built yet in a development checkout; the server
// still answers so the link always lands somewhere honest.
const unbuiltChromePage = `<!doctype html>
<meta charset="utf-8">
<title>casomer studio</title>
<p style="font-family: system-ui; margin: 3rem;">The Studio chrome is not built in this checkout. Run <code>npm run studio:build</code>, then reload.</p>
`;

function escapeHtmlText ( text: string ): string
{
    return text
        .replace( /&/g, '&amp;' )
        .replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' )
        .replace( /"/g, '&quot;' );
}

function issuesPreviewPage ( issues: readonly { path: string; message: string }[] ): string
{
    const rows = issues
        .map( ( issue ) => `<li><strong>${issue.path}</strong> ${issue.message}</li>` )
        .join( '' );

    return `<!doctype html>
<meta charset="utf-8">
<title>casomer studio preview</title>
<div style="font-family: system-ui; margin: 3rem; max-width: 40rem;">
    <p>This page cannot render until the site's problems are fixed:</p>
    <ul>${rows}</ul>
</div>
`;
}

async function serveAsset ( assetsDirectory: string, urlPath: string, response: ServerResponse ): Promise<void>
{
    const candidates = urlPath === '/' || extname( urlPath ) === '' ? [ '/index.html' ] : [ urlPath ];

    for ( const candidate of candidates )
    {
        const file = resolveWithin( assetsDirectory, candidate );

        if ( file === undefined ) { continue; }

        try
        {
            const body = await readFile( file );

            // no-cache, like serveFile: heuristic caching here is how
            // a reload ran weeks-stale chrome ("outdated casomer").
            response.writeHead( 200, {
                'content-type': contentTypes[ extname( file ) ] ?? 'application/octet-stream',
                'cache-control': 'no-cache',
            } );
            response.end( body );
            return;
        }
        catch { /* fall through */ }
    }

    if ( urlPath === '/' || extname( urlPath ) === '' )
    {
        response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
        response.end( unbuiltChromePage );
        return;
    }

    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
    response.end( 'Not found.' );
}

// Display names come from manifests (EDITOR section 4): the API sends
// each block's kind, and a component's manifest title for the chip
// and inspector. The chrome supplies the words for structural kinds.
let coreComponentsCache: Promise<ReadonlyMap<string, LoadedComponent>> | undefined;

function componentTitle ( reference: string, packages: readonly LoadedPackage[], core: ReadonlyMap<string, LoadedComponent> ): string
{
    const [ packageName, id ] = reference.includes( '/' ) ? reference.split( '/', 2 ) : [ 'core', reference ];

    if ( packageName === 'core' ) { return core.get( id ?? '' )?.manifest.title ?? reference; }

    const owner = packages.find( ( candidate ) => candidate.manifest.name === packageName );

    return owner?.components.get( id ?? '' )?.manifest.title ?? reference;
}

interface BlockSummaryBody
{
    readonly kind: string;
    readonly title?: string;
    readonly children?: readonly BlockSummaryBody[];
}

function blockSummary ( block: unknown, packages: readonly LoadedPackage[], core: ReadonlyMap<string, LoadedComponent> ): BlockSummaryBody
{
    const record = block as Record<string, unknown>;

    if ( typeof record.component === 'string' )
    {
        return { kind: 'component', title: componentTitle( record.component, packages, core ) };
    }

    if ( record.repeat !== undefined ) { return { kind: 'repeat' }; }

    if ( typeof record.partial === 'string' ) { return { kind: 'partial', title: record.partial }; }

    const children = ( ( record.blocks ?? [] ) as unknown[] )
        .map( ( child ) => blockSummary( child, packages, core ) );

    return { kind: 'section', children };
}

// The status chip tells the truth about which recovery layer applies
// (EDITOR section 9): unsaved (working tree dirty), saved (commits
// since the last publish), published, or unversioned (no repo).
async function siteStatus ( directory: string, changed: { versioned: boolean; files: string[] } ): Promise<string>
{
    if ( !changed.versioned ) { return 'unversioned'; }
    if ( changed.files.length > 0 ) { return 'unsaved'; }

    const lastPublish = await runGit( directory, [ 'log', '-1', '--grep', '^casomer: publish', '--pretty=%H' ] );
    const publishSha = lastPublish.stdout.trim();

    if ( publishSha === '' ) { return 'saved'; }

    const since = await runGit( directory, [ 'rev-list', '--count', `${publishSha}..HEAD` ] );

    return since.stdout.trim() === '0' ? 'published' : 'saved';
}

// Per-document dirty (the nav dots): which owned files differ from
// the last saved version, straight from git. Pages share one file,
// so pages.json resolves further to the ids whose objects changed.
// The pathspec is *.json rather than the owned list so a DELETED
// owned file still shows - it is no longer on disk to be listed, but
// its unsaved deletion is a change all the same; ownership of a
// deleted file is settled by the copy HEAD still holds.
async function headIsOwned ( directory: string, name: string ): Promise<boolean>
{
    if ( name === 'site.json' || name === 'pages.json' ) { return true; }

    const shown = await runGit( directory, [ 'show', `HEAD:${name}` ] );

    if ( shown.code !== 0 ) { return false; }

    try
    {
        const value = JSON.parse( shown.stdout ) as Record<string, unknown> | null;

        return value !== null && typeof value === 'object' && !Array.isArray( value ) && value.casomerSchema === 1;
    }
    catch
    {
        return false;
    }
}

async function changedContent ( directory: string ): Promise<{ versioned: boolean; files: string[]; pageIds: string[] }>
{
    const owned = await ownedContentFiles( directory );
    const dirty = await runGit( directory, [ 'status', '--porcelain', '--', '*.json' ] );

    if ( dirty.code !== 0 ) { return { versioned: false, files: [], pageIds: [] }; }

    const files: string[] = [];

    for ( const line of dirty.stdout.split( '\n' ) )
    {
        const name = line.slice( 3 ).trim();

        if ( name === '' || name.includes( '/' ) ) { continue; }

        if ( owned.includes( name ) ) { files.push( name ); }
        else if ( line.slice( 0, 2 ).includes( 'D' ) && await headIsOwned( directory, name ) ) { files.push( name ); }
    }

    if ( !files.includes( 'pages.json' ) ) { return { versioned: true, files, pageIds: [] }; }

    const pageIds: string[] = [];

    try
    {
        const working = JSON.parse( await readFile( join( directory, 'pages.json' ), 'utf8' ) ) as { pages?: { id?: string }[] };
        const shown = await runGit( directory, [ 'show', 'HEAD:pages.json' ] );
        const head = shown.code === 0 ? JSON.parse( shown.stdout ) as { pages?: { id?: string }[] } : { pages: [] };
        const headById = new Map( ( head.pages ?? [] ).map( ( page ) => [ page.id, JSON.stringify( page ) ] ) );

        for ( const page of working.pages ?? [] )
        {
            if ( typeof page.id === 'string' && headById.get( page.id ) !== JSON.stringify( page ) ) { pageIds.push( page.id ); }
        }
    }
    catch
    {
        // Unparsable on either side: the file-level flag already tells
        // the truth; no per-page detail.
    }

    return { versioned: true, files, pageIds };
}

// The account chip's identity lives outside any site, in
// ~/.config/casomer (Mikey's direction): config.json's "avatar" key
// names an image stored in that same directory. Until account
// editing lands the file is placed by hand; the chip shows it
// whenever it resolves, and falls back to the person mark.
function userConfigDirectory (): string
{
    return join( homedir(), '.config', 'casomer' );
}

async function avatarFile (): Promise<string | undefined>
{
    try
    {
        const config = JSON.parse( await readFile( join( userConfigDirectory(), 'config.json' ), 'utf8' ) ) as { avatar?: unknown };

        if ( typeof config.avatar !== 'string' || config.avatar === '' ) { return undefined; }

        const file = join( userConfigDirectory(), basename( config.avatar ) );

        await stat( file );
        return file;
    }
    catch
    {
        return undefined;
    }
}

async function serveSite ( options: StudioServerOptions, response: ServerResponse ): Promise<void>
{
    const result = await loadSiteDirectory( options.contentDirectory, options.packages ?? [] );

    coreComponentsCache = coreComponentsCache ?? loadCoreComponents();

    const core = await coreComponentsCache;
    const packages = options.packages ?? [];

    // Site-level meta for the settings workspace: the creation-time
    // choices (declared use, the backup remote) stay revisitable, and
    // the about panel gets its facts.
    const remote = await runGit( options.contentDirectory, [ 'remote', 'get-url', 'origin' ] );
    const lastPublish = await runGit( options.contentDirectory, [ 'log', '-1', '--grep', '^casomer: publish', '--pretty=%cI' ] );
    const changed = await changedContent( options.contentDirectory );

    const body = {
        projectName: result.config.name ?? projectNameFor( options.contentDirectory ),
        folderName: projectNameFor( options.contentDirectory ),
        siteIcon: result.config.icon ?? '',
        status: await siteStatus( options.contentDirectory, changed ),
        changedFiles: changed.files,
        changedPageIds: changed.pageIds,
        hasAvatar: await avatarFile() !== undefined,
        declaredUse: result.config.declaredUse ?? 'personal',
        remoteUrl: remote.code === 0 ? remote.stdout.trim() : '',
        lastPublishedAt: lastPublish.code === 0 ? lastPublish.stdout.trim() : '',
        config: result.issues.length === 0 ? result.config : undefined,
        pages: result.pages.map( ( page ) => ( {
            id: page.id,
            title: page.title,
            slug: page.slug,
            draft: page.draft === true,
            ...( page.parent === undefined ? {} : { parent: page.parent } ),
            blocks: page.blocks.map( ( block ) => blockSummary( block, packages, core ) ),
        } ) ),
        regionBlocks: {
            header: ( result.config.regions?.header ?? [] ).map( ( block ) => blockSummary( block, packages, core ) ),
            footer: ( result.config.regions?.footer ?? [] ).map( ( block ) => blockSummary( block, packages, core ) ),
            notFound: ( result.config.notFound ?? [] ).map( ( block ) => blockSummary( block, packages, core ) ),
            ...Object.fromEntries( Object.entries( result.config.partials ?? {} )
                .map( ( [ name, blocks ] ) => [ name, blocks.map( ( block ) => blockSummary( block, packages, core ) ) ] ) ),
        },
        partials: Object.keys( result.config.partials ?? {} ),
        collections: result.collections.map( ( collection ) => ( {
            file: collection.file,
            label: collection.label,
            entryCount: collection.entries.length,
            ...( collection.parent === undefined ? {} : { parent: collection.parent } ),
            ...( collection.indexBlocks === false ? { index: false } : {} ),
        } ) ),
        taxonomies: result.taxonomies.map( ( taxonomy ) => ( {
            file: taxonomy.file,
            label: taxonomy.label,
            termCount: taxonomy.terms.length,
            ...( taxonomy.indexBlocks === false ? { index: false } : {} ),
        } ) ),
        issues: result.issues,
    };

    response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );
    response.end( JSON.stringify( body ) );
}

function pathIndexes ( path: string ): number[]
{
    return [ ...path.matchAll( /blocks\[(\d+)\]/g ) ].map( ( match ) => Number( match[ 1 ] ) );
}

function blockAtPath ( blocks: readonly unknown[], path: string ): Record<string, unknown> | undefined
{
    let level: readonly unknown[] | undefined = blocks;
    let block: Record<string, unknown> | undefined;

    for ( const index of pathIndexes( path ) )
    {
        block = level?.[ index ] as Record<string, unknown> | undefined;
        level = block?.blocks as readonly unknown[] | undefined;
    }

    return block;
}

function resolveComponent ( reference: string, packages: readonly LoadedPackage[], core: ReadonlyMap<string, LoadedComponent> ): LoadedComponent | undefined
{
    const [ packageName, id ] = reference.includes( '/' ) ? reference.split( '/', 2 ) : [ 'core', reference ];

    if ( packageName === 'core' ) { return core.get( id ?? '' ); }

    return packages.find( ( candidate ) => candidate.manifest.name === packageName )?.components.get( id ?? '' );
}

// A block edit can live in pages.json or in a collection document's
// template or index surface; the doc/surface pair addresses the
// latter (EDITOR: one inspector, many canvases).
function collectionSurfaceBlocks (
    result: Awaited<ReturnType<typeof loadSiteDirectory>>,
    doc: string,
    surface: string,
): readonly unknown[] | undefined
{
    const document = result.collections.find( ( candidate ) => candidate.file === `${doc}.json` )
        ?? result.taxonomies.find( ( candidate ) => candidate.file === `${doc}.json` );

    if ( document === undefined ) { return undefined; }

    if ( surface === 'template' ) { return document.templateBlocks ?? []; }

    return document.indexBlocks === false ? [] : ( document.indexBlocks ?? [] );
}

// The inspector's food (slice 3): a component block's normalized
// fields straight from its manifest, its current props, and the token
// families the fromTokens option source draws from.
async function serveBlock ( options: StudioServerOptions, url: URL, response: ServerResponse ): Promise<void>
{
    const result = await loadSiteDirectory( options.contentDirectory, options.packages ?? [] );

    coreComponentsCache = coreComponentsCache ?? loadCoreComponents();

    const core = await coreComponentsCache;
    const doc = url.searchParams.get( 'doc' );
    const surface = url.searchParams.get( 'surface' );
    const region = url.searchParams.get( 'region' );
    const page = result.pages.find( ( candidate ) => candidate.id === url.searchParams.get( 'page' ) );
    const entryId = url.searchParams.get( 'entry' );
    const blocks = region !== null
        ? ( region === 'notFound'
                ? ( result.config.notFound ?? [] )
                : ( region === 'header' || region === 'footer'
                        ? ( result.config.regions?.[ region ] ?? [] )
                        : ( result.config.partials?.[ region ] ?? [] ) ) )
        : ( doc !== null && surface === 'entry' && entryId !== null
                ? ( result.collections.find( ( candidate ) => candidate.file === `${doc}.json` )
                        ?.entries.find( ( candidate ) => candidate.id === entryId )?.blocks ?? [] )
                : ( doc !== null && surface !== null
                        ? collectionSurfaceBlocks( result, doc, surface )
                        : page?.blocks ) );
    const block = blocks === undefined ? undefined : blockAtPath( blocks, url.searchParams.get( 'path' ) ?? '' );

    // A repeat block's food (SCHEMA 13.5, the Repeat inspector):
    // its config, the repeated component's shape for the wiring
    // rows, and every collection's fields for the source options.
    if ( block?.repeat !== undefined )
    {
        const repeat = block.repeat as { source?: { collection?: string; limit?: number; entries?: string[]; menu?: string; taxonomy?: string }; component?: string };
        const repeatComponent = typeof repeat.component === 'string'
            ? resolveComponent( repeat.component, options.packages ?? [], core )
            : undefined;
        const sourceCollection = result.collections.find(
            ( candidate ) => candidate.file === `${repeat.source?.collection ?? ''}.json`,
        );
        const sourceTaxonomy = result.taxonomies.find(
            ( candidate ) => candidate.file === `${repeat.source?.taxonomy ?? ''}.json`,
        );
        const menuItems = repeat.source?.menu !== undefined
            ? result.config.menus?.[ repeat.source.menu ]?.items ?? []
            : undefined;
        const curatedOrCollectionCount = repeat.source?.entries !== undefined
            ? repeat.source.entries.length
            : sourceCollection?.entries.length ?? 0;
        const entryCount = menuItems !== undefined
            ? menuItems.length
            : ( repeat.source?.taxonomy !== undefined
                    ? sourceTaxonomy?.terms.length ?? 0
                    : curatedOrCollectionCount );

        jsonResponse( response, 200, {
            kind: 'repeat',
            repeat: block.repeat,
            componentTitle: repeatComponent?.manifest.title ?? repeat.component ?? '',
            componentFields: repeatComponent?.manifest.fields ?? {},
            entryCount,
            shownCount: Math.min( entryCount, repeat.source?.limit ?? entryCount ),

            // Token families feed the wiring's select editors exactly
            // as they feed a component block's (the fromTokens option
            // source) - without them, style/width dropdowns sit empty.
            tokens: Object.fromEntries(
                Object.entries( result.config.theme.families ).map( ( [ family, values ] ) => [ family, Object.keys( values ) ] ),
            ),

            // A menu-sourced repeat's wiring draws from the fixed item
            // shape (SCHEMA 12.5): label and url. A taxonomy-sourced
            // one from the fixed term shape (13.3).
            menuFields: { label: { label: 'Label', type: 'text' }, url: { label: 'URL', type: 'text' } },
            taxonomyFields: {
                name: { label: 'Name', type: 'text' },
                description: { label: 'Description', type: 'text' },
                url: { label: 'URL', type: 'text' },
            },
            menus: Object.keys( result.config.menus ?? {} ),
            collections: result.collections.map( ( collection ) => ( {
                stem: collection.file.replace( /\.json$/, '' ),
                label: collection.label,

                // The inherent entry.url joins the wiring options
                // when entries actually emit pages; a real field
                // named "url" spreads over it.
                fields: {
                    ...( collection.indexBlocks !== false && collection.templateBlocks !== undefined
                        ? { url: { label: 'URL', type: 'url' } }
                        : {} ),
                    ...Object.fromEntries(
                        Object.entries( collection.fields ).map( ( [ key, field ] ) => [ key, { label: field.label, type: field.type } ] ),
                    ),
                },
            } ) ),

            // Taxonomies offer themselves as a source only when their
            // term pages are public (13.5): index on, template present.
            taxonomies: result.taxonomies
                .filter( ( taxonomy ) => taxonomy.indexBlocks !== false && taxonomy.templateBlocks !== undefined )
                .map( ( taxonomy ) => ( { stem: taxonomy.file.replace( /\.json$/, '' ), label: taxonomy.label } ) ),
        } );
        return;
    }

    // A partial block on a page (SCHEMA 12.5): the inspector shows
    // its name and offers its own canvas.
    if ( typeof block?.partial === 'string' )
    {
        jsonResponse( response, 200, { kind: 'partial', name: block.partial } );
        return;
    }

    const reference = block?.component;

    if ( typeof reference !== 'string' )
    {
        response.writeHead( 404, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: 'No component block lives at that address.' } ) );
        return;
    }

    const component = resolveComponent( reference, options.packages ?? [], core );

    if ( component === undefined )
    {
        response.writeHead( 404, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: `The component "${reference}" is not available.` } ) );
        return;
    }

    const tokens = Object.fromEntries(
        Object.entries( result.config.theme.families ).map( ( [ family, values ] ) => [ family, Object.keys( values ) ] ),
    );

    response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );
    response.end( JSON.stringify( {
        reference,
        title: component.manifest.title,
        fields: component.manifest.fields,
        props: block?.props ?? {},
        tokens,

        // Morph links (SCHEMA 6): the block's link name and the
        // component's declared anchors, for the Settings tab.
        morph: typeof block?.morph === 'string' ? block.morph : '',
        anchors: component.manifest.anchors ?? [],

        // The template text feeds the canvas engine: the chrome
        // renders edits through the product path and morphs them in.
        template: await readFile( component.templateFile, 'utf8' ),
    } ) );
}

// The picker's roster (EDITOR section 4, the Picker board): every
// available component, display-names-first, with its first example's
// props so a freshly added block lands with content, never empty
// scaffolding.
async function serveComponents ( options: StudioServerOptions, response: ServerResponse ): Promise<void>
{
    coreComponentsCache = coreComponentsCache ?? loadCoreComponents();

    const core = await coreComponentsCache;
    const components: { reference: string; title: string; packageName: string; exampleProps: unknown; fieldTypes: Record<string, string> }[] = [];
    const describe = ( reference: string, packageName: string, component: LoadedComponent ): void =>
    {
        components.push( {
            reference,
            title: component.manifest.title,
            packageName,
            exampleProps: component.manifest.examples[ 0 ]?.props ?? {},
            fieldTypes: Object.fromEntries(
                Object.entries( component.manifest.fields ).map( ( [ key, field ] ) => [ key, field.type ] ),
            ),
        } );
    };

    for ( const [ id, component ] of core ) { describe( `core/${id}`, 'core', component ); }

    for ( const loaded of options.packages ?? [] )
    {
        for ( const [ id, component ] of loaded.components )
        {
            describe( `${loaded.manifest.name}/${id}`, loaded.manifest.name, component );
        }
    }

    jsonResponse( response, 200, { components } );
}

function readBody ( request: IncomingMessage ): Promise<string>
{
    return new Promise( ( resolve, reject ) =>
    {
        const chunks: Buffer[] = [];

        request.on( 'data', ( chunk: Buffer ) => chunks.push( chunk ) );
        request.on( 'end', () => resolve( Buffer.concat( chunks ).toString( 'utf8' ) ) );
        request.on( 'error', reject );
    } );
}

interface BlockWriteTarget
{
    readonly file: string;
    readonly document: Record<string, unknown>;
    readonly blocks: unknown[] | undefined;
}

// A block write can land in pages.json or in a collection document's
// template or index surface; this resolves the raw document and the
// blocks array the edit addresses. A missing surface materializes as
// an empty one, so the first insert can create it.
async function resolveBlockTarget (
    options: StudioServerOptions,
    body: { pageId?: string; doc?: string; surface?: string; region?: string; entry?: string },
): Promise<BlockWriteTarget | undefined>
{
    // A region write (SCHEMA 12.5) edits site.json's regions record;
    // the region array is created on first touch. The 404 page rides
    // the same plumbing under its own top-level key.
    if ( body.region !== undefined )
    {
        if ( !/^[a-zA-Z][a-zA-Z0-9-]*$/.test( body.region ) ) { return undefined; }

        const file = join( options.contentDirectory, 'site.json' );
        const document = parseJsonDocument( await readFile( file, 'utf8' ) ) as Record<string, unknown>;

        if ( body.region === 'notFound' )
        {
            if ( !Array.isArray( document.notFound ) ) { document.notFound = []; }

            return { file, document, blocks: document.notFound as unknown[] };
        }

        if ( body.region === 'header' || body.region === 'footer' )
        {
            const regions = ( document.regions ?? {} ) as Record<string, unknown>;

            if ( !Array.isArray( regions[ body.region ] ) ) { regions[ body.region ] = []; }

            document.regions = regions;
            return { file, document, blocks: regions[ body.region ] as unknown[] };
        }

        // A user-defined partial (SCHEMA 12.5): the same plumbing,
        // its own record. Only EXISTING partials are writable - a
        // partial is created explicitly, never as an edit side
        // effect.
        const partials = document.partials as Record<string, unknown> | undefined;

        if ( partials === undefined || !Array.isArray( partials[ body.region ] ) ) { return undefined; }

        return { file, document, blocks: partials[ body.region ] as unknown[] };
    }

    // A diverged entry's own layout (SCHEMA 13.4, Mikey's "break out
    // of the mold"): the entry must already carry blocks - divergence
    // itself is the explicit /api/entry-layout step, never a side
    // effect of an edit.
    if ( body.doc !== undefined && body.surface === 'entry' && body.entry !== undefined )
    {
        if ( !/^[a-z0-9-]+$/.test( body.doc ) ) { return undefined; }

        const file = join( options.contentDirectory, `${body.doc}.json` );
        const document = parseJsonDocument( await readFile( file, 'utf8' ) ) as Record<string, unknown>;
        const entry = ( document.entries as Record<string, unknown>[] | undefined )
            ?.find( ( candidate ) => candidate.id === body.entry );

        if ( entry === undefined || !Array.isArray( entry.blocks ) ) { return undefined; }

        return { file, document, blocks: entry.blocks as unknown[] };
    }

    if ( body.doc !== undefined && body.surface !== undefined )
    {
        if ( !/^[a-z0-9-]+$/.test( body.doc ) || ![ 'template', 'index' ].includes( body.surface ) ) { return undefined; }

        const file = join( options.contentDirectory, `${body.doc}.json` );
        const document = parseJsonDocument( await readFile( file, 'utf8' ) ) as Record<string, unknown>;
        const surface = document[ body.surface ];

        if ( surface === undefined || surface === false || surface === null || typeof surface !== 'object' )
        {
            document[ body.surface ] = { blocks: [] };
        }

        const surfaceRecord = document[ body.surface ] as Record<string, unknown>;

        if ( !Array.isArray( surfaceRecord.blocks ) ) { surfaceRecord.blocks = []; }

        return { file, document, blocks: surfaceRecord.blocks as unknown[] };
    }

    const file = join( options.contentDirectory, 'pages.json' );
    const document = parseJsonDocument( await readFile( file, 'utf8' ) ) as Record<string, unknown>;
    const page = ( document.pages as { id?: string; blocks?: unknown[] }[] | undefined )
        ?.find( ( candidate ) => candidate.id === body.pageId );

    return { file, document, blocks: page?.blocks };
}

async function writeTargetDocument ( options: StudioServerOptions, target: BlockWriteTarget ): Promise<void>
{
    // The first write journals the pre-edit state, every write journals
    // its result: undo has a step to reach even after the browser
    // closes (EDITOR section 9, the edit journal).
    await withJournalLock( async () =>
    {
        await journalSnapshot( options.contentDirectory );
        await writeFile( target.file, serializeCanonicalJson( target.document as JsonValue ), 'utf8' );
        await journalSnapshot( options.contentDirectory );
    } );
}

// The inspector's writes: replace one block's props (or a repeat
// block's config) and re-serialize the whole document canonically
// (SCHEMA appendix B - a save that changes nothing produces an empty
// diff). The watcher then tells every listening chrome.
async function writeBlock ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const body = JSON.parse( await readBody( request ) ) as {
        pageId?: string;
        doc?: string;
        surface?: string;
        entry?: string;
        path?: string;
        props?: JsonValue;
        repeat?: JsonValue;
        morph?: string | null;
    };

    const target = await resolveBlockTarget( options, body );
    const block = target?.blocks === undefined || body.path === undefined
        ? undefined
        : blockAtPath( target.blocks, body.path );

    if ( target === undefined || block === undefined )
    {
        jsonResponse( response, 400, { error: 'The write names no block.' } );
        return;
    }

    let wrote = false;

    // Morph links (SCHEMA 6): the block-level link name; null or
    // empty clears it, a token-shaped name (leading letter - it
    // becomes a view-transition-name) sets it.
    if ( body.morph !== undefined && block.component !== undefined )
    {
        if ( body.morph === null || body.morph === '' ) { delete block.morph; }
        else if ( typeof body.morph === 'string' && /^[a-z][a-z0-9-]*$/.test( body.morph ) ) { block.morph = body.morph; }

        wrote = true;
    }

    if ( block.repeat !== undefined && body.repeat !== undefined && body.repeat !== null && typeof body.repeat === 'object' )
    {
        block.repeat = body.repeat;
        wrote = true;
    }
    else if ( block.component !== undefined && body.props !== undefined )
    {
        block.props = body.props;
        wrote = true;
    }

    if ( !wrote )
    {
        jsonResponse( response, 400, { error: 'The write names no component block.' } );
        return;
    }

    await writeTargetDocument( options, target );
    jsonResponse( response, 200, { saved: true } );
}

// Structural edits: insert a new block at a position, or remove one.
// Both address the same targets writeBlock does; the container path
// names a section ("blocks[1]") or the root ("").
async function insertBlock ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const body = JSON.parse( await readBody( request ) ) as {
        pageId?: string;
        doc?: string;
        surface?: string;
        entry?: string;
        container?: string;
        index?: number;
        block?: JsonValue;
    };

    const target = await resolveBlockTarget( options, body );

    if ( target?.blocks === undefined || body.block === undefined || body.block === null || typeof body.block !== 'object' )
    {
        jsonResponse( response, 400, { error: 'The insert names no destination or block.' } );
        return;
    }

    let container: unknown[] | undefined = target.blocks;

    if ( body.container !== undefined && body.container !== '' )
    {
        const parent = blockAtPath( target.blocks, body.container );

        if ( parent === undefined || !Array.isArray( parent.blocks ) )
        {
            jsonResponse( response, 400, { error: 'The container is not a section.' } );
            return;
        }

        container = parent.blocks as unknown[];
    }

    const index = Math.max( 0, Math.min( container.length, body.index ?? container.length ) );

    container.splice( index, 0, body.block );
    await writeTargetDocument( options, target );
    jsonResponse( response, 200, { inserted: true, index } );
}

async function removeBlock ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const body = JSON.parse( await readBody( request ) ) as {
        pageId?: string;
        doc?: string;
        surface?: string;
        entry?: string;
        path?: string;
    };

    const target = await resolveBlockTarget( options, body );
    const indexes = body.path === undefined ? [] : pathIndexes( body.path );

    if ( target?.blocks === undefined || indexes.length === 0 )
    {
        jsonResponse( response, 400, { error: 'The removal names no block.' } );
        return;
    }

    const last = indexes[ indexes.length - 1 ] as number;
    const parentPath = body.path?.replace( /\.?blocks\[\d+\]$/, '' ) ?? '';
    let container: unknown[] | undefined = target.blocks;

    if ( parentPath !== '' )
    {
        const parent = blockAtPath( target.blocks, parentPath );

        if ( parent === undefined || !Array.isArray( parent.blocks ) )
        {
            jsonResponse( response, 400, { error: 'The removal names no block.' } );
            return;
        }

        container = parent.blocks as unknown[];
    }

    if ( last >= container.length )
    {
        jsonResponse( response, 400, { error: 'The removal names no block.' } );
        return;
    }

    container.splice( last, 1 );
    await writeTargetDocument( options, target );
    jsonResponse( response, 200, { removed: true } );
}

// Publish releases saved work (EDITOR section 9): build, commit the
// content and the compiled site as one reviewable unit, push when a
// remote exists - the same act caso publish performs.
async function publishVersion ( options: StudioServerOptions, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;
    const top = await runGit( directory, [ 'rev-parse', '--show-toplevel' ] );
    const sameRoot = top.code === 0
        && normalize( top.stdout.trim() ).toLowerCase() === normalize( directory ).replace( /[\\/]+$/, '' ).toLowerCase();

    if ( !sameRoot )
    {
        response.writeHead( 409, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: 'This site\'s folder is not its own repository, so it cannot publish from here.' } ) );
        return;
    }

    const result = await buildSite( {
        contentDirectory: directory,
        outputDirectory: join( directory, 'dist' ),
        packages: options.packages ?? [],
        ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
    } );

    if ( result.issues.length > 0 )
    {
        response.writeHead( 409, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: 'The site did not build.', issues: result.issues } ) );
        return;
    }

    // git refuses the whole add when a pathspec matches nothing, so
    // only paths that exist are staged - EXCEPT owned deletions: a
    // tracked-but-deleted file stages its removal and must, or the
    // delete-half of a rename never commits and a later discard
    // resurrects the old file (the venue.json incident, 2026-09-01).
    const candidates = [ ...await ownedContentFiles( directory ), '.gitattributes', 'dist', 'media' ];
    const present: string[] = [];

    for ( const candidate of candidates )
    {
        try
        {
            await stat( join( directory, candidate ) );
            present.push( candidate );
        }
        catch { /* absent paths stay unstaged */ }
    }

    const publishChanged = await changedContent( directory );
    const staged = await stagePaths( directory, [ ...new Set( [ ...present, ...publishChanged.files ] ) ] );

    if ( staged.code !== 0 )
    {
        response.writeHead( 500, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: 'The publish could not stage its files.' } ) );
        return;
    }

    const count = result.pagesWritten.length;

    if ( await hasStagedChanges( directory ) )
    {
        const committed = await commit( directory, `casomer: publish ${count} page${count === 1 ? '' : 's'}` );

        if ( committed.code !== 0 )
        {
            response.writeHead( 500, { 'content-type': 'application/json; charset=utf-8' } );
            response.end( JSON.stringify( { error: 'The publish did not complete.' } ) );
            return;
        }
    }

    if ( await hasRemote( directory ) ) { await pushCurrentBranch( directory ); }

    response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );
    response.end( JSON.stringify( { published: true, pages: count } ) );
}

// The content-document CRUD (SCHEMA section 13.1): every write goes
// through the canonical serializer and the journal, so collection and
// taxonomy operations - creation and deletion included - are exactly
// as undoable as any edit.
function jsonResponse ( response: ServerResponse, status: number, body: unknown ): void
{
    response.writeHead( status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
    } );
    response.end( JSON.stringify( body ) );
}

function safeDocumentName ( file: unknown ): string | undefined
{
    return typeof file === 'string' && /^[a-z0-9-]+\.json$/.test( file ) && file !== 'site.json' && file !== 'pages.json'
        ? file
        : undefined;
}

async function readOwnedDocument ( directory: string, file: string ): Promise<Record<string, unknown> | undefined>
{
    try
    {
        const value = JSON.parse( await readFile( join( directory, file ), 'utf8' ) ) as Record<string, unknown> | null;

        return value !== null && typeof value === 'object' && !Array.isArray( value ) && value.casomerSchema === 1
            ? value
            : undefined;
    }
    catch
    {
        return undefined;
    }
}

// The site.json media record (SCHEMA 13.4): { track?, maxEdge?,
// quality?, labels? }. These helpers read and write the labels half
// without disturbing the policy half.
function mediaRecordOf ( site: Record<string, unknown> | undefined ): Record<string, unknown>
{
    const record = site?.media;

    return record !== null && typeof record === 'object' && !Array.isArray( record )
        ? { ...record as Record<string, unknown> }
        : {};
}

function mediaLabelsOf ( site: Record<string, unknown> | undefined ): Record<string, string>
{
    const labels = mediaRecordOf( site ).labels;

    return labels !== null && typeof labels === 'object' && !Array.isArray( labels )
        ? labels as Record<string, string>
        : {};
}

function setMediaLabels ( site: Record<string, unknown>, labels: Record<string, string> ): void
{
    const record = mediaRecordOf( site );

    if ( Object.keys( labels ).length === 0 ) { delete record.labels; }
    else { record.labels = labels; }

    if ( Object.keys( record ).length === 0 ) { delete site.media; }
    else { site.media = record; }
}

async function writeOwnedDocument ( directory: string, file: string, value: JsonValue ): Promise<void>
{
    await withJournalLock( async () =>
    {
        await journalSnapshot( directory );
        await writeFile( join( directory, file ), serializeCanonicalJson( value ), 'utf8' );
        await journalSnapshot( directory );
    } );
}

// Walk a blocks tree, following a stem rename through every repeat
// source that names it (SCHEMA 13.3: references follow a rename).
function rewriteRepeatSources ( blocks: unknown[], oldStem: string, newStem: string ): boolean
{
    let changed = false;

    for ( const raw of blocks )
    {
        if ( raw === null || typeof raw !== 'object' ) { continue; }

        const block = raw as Record<string, unknown>;
        const source = ( block.repeat as Record<string, unknown> | undefined )?.source as Record<string, unknown> | undefined;

        if ( source !== undefined && source.collection === oldStem )
        {
            source.collection = newStem;
            changed = true;
        }

        if ( Array.isArray( block.blocks ) && rewriteRepeatSources( block.blocks, oldStem, newStem ) ) { changed = true; }
    }

    return changed;
}

// Follow a rename through one document's reference-bearing spots:
// field rules (taxonomy:/type: targets) and, for collection renames,
// every repeat source in every blocks tree the document carries.
function rewriteDocumentReferences (
    document: Record<string, unknown>,
    kind: 'collection' | 'taxonomy',
    oldStem: string,
    newStem: string,
): boolean
{
    let changed = false;

    if ( document.fields !== null && typeof document.fields === 'object' )
    {
        for ( const field of Object.values( document.fields as Record<string, unknown> ) )
        {
            if ( field === null || typeof field !== 'object' || Array.isArray( field ) ) { continue; }

            const rules = ( field as Record<string, unknown> ).rules as Record<string, unknown> | undefined;
            const ruleKey = kind === 'taxonomy' ? 'taxonomy' : 'type';

            if ( rules !== undefined && rules[ ruleKey ] === oldStem )
            {
                rules[ ruleKey ] = newStem;
                changed = true;
            }
        }
    }

    if ( kind === 'collection' )
    {
        const trees: unknown[][] = [];

        for ( const surfaceKey of [ 'template', 'index' ] )
        {
            const surface = document[ surfaceKey ];

            if ( surface !== null && typeof surface === 'object' && Array.isArray( ( surface as Record<string, unknown> ).blocks ) )
            {
                trees.push( ( surface as Record<string, unknown> ).blocks as unknown[] );
            }
        }

        if ( Array.isArray( document.entries ) )
        {
            for ( const entry of document.entries as Record<string, unknown>[] )
            {
                if ( Array.isArray( entry?.blocks ) ) { trees.push( entry.blocks as unknown[] ); }
            }
        }

        if ( Array.isArray( document.pages ) )
        {
            for ( const page of document.pages as Record<string, unknown>[] )
            {
                if ( Array.isArray( page?.blocks ) ) { trees.push( page.blocks as unknown[] ); }
            }
        }

        for ( const tree of trees )
        {
            if ( rewriteRepeatSources( tree, oldStem, newStem ) ) { changed = true; }
        }
    }

    return changed;
}

// The offered rename (SCHEMA 13.3: offer, never silently): move the
// document to the file its label spells, and follow the old stem
// through every owned document that points at it - one journal
// snapshot pair, so a single undo reverses the whole move.
async function renameOwnedDocument (
    directory: string,
    kind: 'collection' | 'taxonomy',
    oldFile: string,
    document: Record<string, unknown>,
    newFile: string,
): Promise<void>
{
    const oldStem = oldFile.replace( /\.json$/, '' );
    const newStem = newFile.replace( /\.json$/, '' );

    await withJournalLock( async () =>
    {
        await journalSnapshot( directory );

        for ( const name of await ownedContentFiles( directory ) )
        {
            if ( name === oldFile ) { continue; }

            const sibling = parseJsonDocument( await readFile( join( directory, name ), 'utf8' ) ) as Record<string, unknown>;

            if ( rewriteDocumentReferences( sibling, kind, oldStem, newStem ) )
            {
                await writeFile( join( directory, name ), serializeCanonicalJson( sibling as JsonValue ), 'utf8' );
            }
        }

        // The document may reference its own stem (an index repeating
        // its own collection does); it follows too.
        rewriteDocumentReferences( document, kind, oldStem, newStem );
        await writeFile( join( directory, newFile ), serializeCanonicalJson( document as JsonValue ), 'utf8' );
        await unlink( join( directory, oldFile ) );
        await journalSnapshot( directory );
    } );
}

async function removeOwnedDocument ( directory: string, file: string ): Promise<void>
{
    await withJournalLock( async () =>
    {
        await journalSnapshot( directory );
        await unlink( join( directory, file ) );
        await journalSnapshot( directory );
    } );
}

function slugFor ( label: string ): string
{
    const slug = label.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

    return slug === '' ? 'untitled' : slug;
}

async function freshDocumentName ( directory: string, label: string ): Promise<string>
{
    const base = slugFor( label );

    for ( let attempt = 0; ; attempt += 1 )
    {
        const name = attempt === 0 ? `${base}.json` : `${base}-${attempt + 1}.json`;

        try
        {
            await stat( join( directory, name ) );
        }
        catch
        {
            return name;
        }
    }
}

async function handleCollection ( options: StudioServerOptions, request: IncomingMessage, url: URL, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;

    if ( request.method === 'GET' )
    {
        const file = safeDocumentName( url.searchParams.get( 'file' ) );
        const result = await loadSiteDirectory( directory, options.packages ?? [] );
        const collection = result.collections.find( ( candidate ) => candidate.file === file );

        if ( collection === undefined )
        {
            jsonResponse( response, 404, { error: 'No collection lives in that file.' } );
            return;
        }

        const raw = file === undefined ? undefined : await readOwnedDocument( directory, file );

        coreComponentsCache = coreComponentsCache ?? loadCoreComponents();

        const core = await coreComponentsCache;
        const packages = options.packages ?? [];

        jsonResponse( response, 200, {
            file: collection.file,
            label: collection.label,
            fields: collection.fields,
            locked: collection.locked,
            parent: collection.parent ?? null,
            index: raw?.index !== false,
            pageSize: collection.indexPageSize ?? null,
            table: raw?.table,
            entries: collection.entries,
            hasTemplate: collection.templateBlocks !== undefined,

            // Diverged entries' own layouts, summarized for the
            // entry-layout canvas (SCHEMA 13.4).
            entryLayouts: Object.fromEntries(
                collection.entries
                    .filter( ( entry ) => Array.isArray( entry.blocks ) )
                    .map( ( entry ) => [ entry.id, ( entry.blocks as unknown[] ).map( ( block ) => blockSummary( block, packages, core ) ) ] ),
            ),
            templateBlocks: ( collection.templateBlocks ?? [] ).map( ( block ) => blockSummary( block, packages, core ) ),
            indexBlocks: ( Array.isArray( collection.indexBlocks ) ? collection.indexBlocks : [] )
                .map( ( block ) => blockSummary( block, packages, core ) ),

            // Reference fields resolve to labels in the editor (SCHEMA
            // 13.3): the pickers and the table cells need every
            // taxonomy's terms - and every collection's entry titles,
            // for entry references - at hand.
            taxonomies: result.taxonomies.map( ( taxonomy ) => ( {
                stem: taxonomy.file.replace( /\.json$/, '' ),
                label: taxonomy.label,
                terms: taxonomy.terms,
            } ) ),
            collectionRefs: result.collections.map( ( candidate ) => ( {
                stem: candidate.file.replace( /\.json$/, '' ),
                label: candidate.label,
                entries: candidate.entries.map( ( entry ) => ( {
                    id: entry.id,
                    title: String( entry.values.title ?? '' ),
                } ) ),
            } ) ),
        } );
        return;
    }

    const body = JSON.parse( await readBody( request ) ) as { file?: unknown; label?: unknown; index?: unknown; patch?: Record<string, unknown> };

    if ( request.method === 'POST' )
    {
        if ( typeof body.label !== 'string' || body.label.trim() === '' )
        {
            jsonResponse( response, 400, { error: 'A collection needs a label.' } );
            return;
        }

        const file = await freshDocumentName( directory, body.label );

        await writeOwnedDocument( directory, file, {
            casomerSchema: 1,
            kind: 'collection',
            label: body.label.trim(),
            fields: { title: 'text!' },
            ...( body.index === false ? { index: false } : {} ),
            entries: [],
        } );
        jsonResponse( response, 200, { created: true, file } );
        return;
    }

    const file = safeDocumentName( body.file );
    const document = file === undefined ? undefined : await readOwnedDocument( directory, file );

    if ( file === undefined || document === undefined || document.kind !== 'collection' )
    {
        jsonResponse( response, 404, { error: 'No collection lives in that file.' } );
        return;
    }

    if ( request.method === 'DELETE' )
    {
        await removeOwnedDocument( directory, file );
        jsonResponse( response, 200, { deleted: true } );
        return;
    }

    if ( request.method === 'PUT' )
    {
        const patch = body.patch ?? {};

        if ( typeof patch.label === 'string' && patch.label.trim() !== '' ) { document.label = patch.label.trim(); }

        // Re-enabling a public index only clears the opt-out flag; an
        // authored index page ({ "blocks" }) is never deleted by it.
        if ( patch.index === false ) { document.index = false; }
        else if ( patch.index === true && document.index === false ) { delete document.index; }

        // Pagination (SCHEMA 13.5): entries per index page. Setting
        // it materializes the index record when only the default
        // listing existed; clearing removes the key.
        if ( patch.pageSize !== undefined && document.index !== false )
        {
            const size = Number( patch.pageSize );

            if ( Number.isInteger( size ) && size >= 1 )
            {
                if ( document.index === undefined || document.index === null || typeof document.index !== 'object' )
                {
                    document.index = { blocks: [] };
                }

                ( document.index as Record<string, unknown> ).pageSize = size;
            }
            else if ( document.index !== undefined && document.index !== null && typeof document.index === 'object' )
            {
                delete ( document.index as Record<string, unknown> ).pageSize;
            }
        }

        if ( patch.locked === true ) { document.locked = true; }
        else if ( patch.locked === false ) { delete document.locked; }

        // Drag-and-drop sort order (Mikey): the entries array IS the
        // sort order; a reorder patch rewrites it by id. Unknown ids
        // are ignored, unlisted entries keep their place at the end.
        if ( Array.isArray( patch.entryOrder ) )
        {
            const entries = ( document.entries ?? [] ) as { id?: string }[];
            const byId = new Map( entries.map( ( entry ) => [ entry.id, entry ] ) );
            const ordered = ( patch.entryOrder as unknown[] )
                .filter( ( id ): id is string => typeof id === 'string' && byId.has( id ) )
                .map( ( id ) => byId.get( id ) as { id?: string } );
            const rest = entries.filter( ( entry ) => !ordered.includes( entry ) );

            document.entries = [ ...ordered, ...rest ];
        }

        // The mount point (SCHEMA 13.6): "parent" nests the
        // collection's public pages under a page's URL, null returns
        // them to the root. Home is the root already and refuses.
        if ( patch.parent === null ) { delete document.parent; }
        else if ( typeof patch.parent === 'string' )
        {
            const pagesDocument = JSON.parse( await readFile( join( directory, 'pages.json' ), 'utf8' ) ) as { pages?: { id?: string; slug?: string }[] };
            const mountPage = pagesDocument.pages?.find( ( candidate ) => candidate.id === patch.parent );

            if ( mountPage === undefined || mountPage.slug === 'home' )
            {
                jsonResponse( response, 400, { error: 'A mount point is an existing page; home is the root, where an unmounted collection already lives.' } );
                return;
            }

            document.parent = patch.parent;
        }

        // A fields patch carries the simple facts (type, label,
        // required, help) per key; a field's richer shape - select
        // options, a list's nested fields - is merged in from the
        // authored document, never flattened away by the chrome.
        if ( patch.fields !== undefined && patch.fields !== null && typeof patch.fields === 'object' )
        {
            const existing = ( document.fields ?? {} ) as Record<string, unknown>;
            const merged: Record<string, unknown> = {};

            for ( const [ key, incoming ] of Object.entries( patch.fields as Record<string, Record<string, unknown>> ) )
            {
                const base = existing[ key ];
                const carried = base !== null && typeof base === 'object' && !Array.isArray( base )
                    ? { ...base as Record<string, unknown> }
                    : {};

                merged[ key ] = {
                    ...carried,
                    type: incoming.type,
                    label: incoming.label,
                    ...( incoming.required === true ? { required: true } : {} ),
                    ...( typeof incoming.help === 'string' && incoming.help !== '' ? { help: incoming.help } : {} ),
                };

                const mergedField = merged[ key ] as Record<string, unknown>;

                if ( incoming.required !== true ) { delete mergedField.required; }
                if ( typeof incoming.help !== 'string' || incoming.help === '' ) { delete mergedField.help; }

                // A reference field's target rides a rule (SCHEMA
                // 13.3): "taxonomy" for term assignment, "type" for
                // another collection's entries. One target at a time;
                // leaving the reference type clears both.
                const rules = ( mergedField.rules ?? {} ) as Record<string, unknown>;

                if ( incoming.type === 'reference' && typeof incoming.taxonomy === 'string' && incoming.taxonomy !== '' )
                {
                    rules.taxonomy = incoming.taxonomy;
                    delete rules.type;
                }
                else if ( incoming.type === 'reference' && typeof incoming.collection === 'string' && incoming.collection !== '' )
                {
                    rules.type = incoming.collection;
                    delete rules.taxonomy;
                }
                else if ( incoming.type !== 'reference' )
                {
                    delete rules.taxonomy;
                    delete rules.type;
                }

                // A date field's spoken form (SCHEMA 13.5): long is
                // the default and stays implicit; short and iso ride
                // the "format" rule.
                if ( incoming.type === 'date' && ( incoming.format === 'short' || incoming.format === 'iso' ) )
                {
                    rules.format = incoming.format;
                }
                else { delete rules.format; }

                // A multiple reference (SCHEMA 13.3): the value is an
                // array of ids.
                if ( incoming.type === 'reference' && incoming.multiple === true ) { rules.multiple = true; }
                else { delete rules.multiple; }

                if ( Object.keys( rules ).length > 0 ) { mergedField.rules = rules; }
                else { delete mergedField.rules; }
            }

            try
            {
                const normalized = normalizeFields( merged );

                if ( normalized.title === undefined )
                {
                    jsonResponse( response, 400, { error: 'Every collection has a "title" field (SCHEMA section 13.3).' } );
                    return;
                }
            }
            catch ( error )
            {
                if ( !( error instanceof FieldSchemaError ) ) { throw error; }

                jsonResponse( response, 400, { error: 'The fields do not validate.', issues: error.issues } );
                return;
            }

            document.fields = merged;
        }

        if ( Array.isArray( patch.table ) ) { document.table = patch.table; }
        else if ( patch.table === null ) { delete document.table; }

        // The canvas grows its first blocks through here: append one
        // block to the template or index surface.
        const append = patch.appendBlock as { surface?: string; block?: unknown } | undefined;

        if ( append !== undefined )
        {
            if ( ![ 'template', 'index' ].includes( append.surface ?? '' ) || append.block === null || typeof append.block !== 'object' )
            {
                jsonResponse( response, 400, { error: 'appendBlock names a surface and a block object.' } );
                return;
            }

            const surfaceKey = append.surface as string;
            const surface = ( document[ surfaceKey ] !== null && typeof document[ surfaceKey ] === 'object'
                ? document[ surfaceKey ]
                : { blocks: [] } ) as Record<string, unknown>;

            if ( !Array.isArray( surface.blocks ) ) { surface.blocks = []; }

            ( surface.blocks as unknown[] ).push( append.block );
            document[ surfaceKey ] = surface;
        }

        // The offered file rename: the label's slug becomes the stem,
        // and every reference to the old stem follows.
        if ( patch.renameFile === true && `${slugFor( String( document.label ?? '' ) )}.json` !== file )
        {
            const desired = await freshDocumentName( directory, String( document.label ?? '' ) );

            await renameOwnedDocument( directory, 'collection', file, document, desired );
            jsonResponse( response, 200, { saved: true, file: desired } );
            return;
        }

        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { saved: true, file } );
        return;
    }

    jsonResponse( response, 405, { error: 'Unsupported method.' } );
}

async function handleEntry ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;
    const body = JSON.parse( await readBody( request ) ) as { file?: unknown; id?: unknown; values?: Record<string, unknown>; draft?: unknown };
    const file = safeDocumentName( body.file );
    const document = file === undefined ? undefined : await readOwnedDocument( directory, file );

    if ( file === undefined || document === undefined || document.kind !== 'collection' || !Array.isArray( document.entries ) )
    {
        jsonResponse( response, 404, { error: 'No collection lives in that file.' } );
        return;
    }

    const entries = document.entries as Record<string, unknown>[];

    if ( request.method === 'POST' )
    {
        // The create modal sends the whole form; empty values stay out
        // of the document (absent, not null), title always present.
        const given = Object.entries( body.values ?? {} )
            .filter( ( [ , value ] ) => value !== null && value !== undefined && value !== '' );
        const entry = {
            id: randomUUID(),
            title: typeof ( body.values?.title ) === 'string' ? body.values.title : '',
            ...Object.fromEntries( given ),
        };

        entries.push( entry );
        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { created: true, id: entry.id } );
        return;
    }

    const index = entries.findIndex( ( entry ) => entry.id === body.id );

    if ( index < 0 )
    {
        jsonResponse( response, 404, { error: 'No entry has that id.' } );
        return;
    }

    if ( request.method === 'DELETE' )
    {
        entries.splice( index, 1 );
        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { deleted: true } );
        return;
    }

    if ( request.method === 'PUT' )
    {
        const current = entries[ index ] as Record<string, unknown>;

        // A values write replaces the fields and preserves the rest;
        // the draft switch flips independently (and a body without
        // either leaves both alone).
        const draft = typeof body.draft === 'boolean' ? body.draft : current.draft === true;

        entries[ index ] = {
            id: current.id,
            ...current.blocks === undefined ? {} : { blocks: current.blocks },
            ...( draft ? { draft: true } : {} ),
            ...body.values ?? Object.fromEntries( Object.entries( current ).filter( ( [ key ] ) => ![ 'id', 'blocks', 'draft' ].includes( key ) ) ),
        };
        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { saved: true } );
        return;
    }

    jsonResponse( response, 405, { error: 'Unsupported method.' } );
}

async function handleTaxonomy ( options: StudioServerOptions, request: IncomingMessage, url: URL, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;

    if ( request.method === 'GET' )
    {
        const requested = safeDocumentName( url.searchParams.get( 'file' ) );
        const result = await loadSiteDirectory( directory, options.packages ?? [] );
        const taxonomy = result.taxonomies.find( ( candidate ) => candidate.file === requested );

        if ( taxonomy === undefined )
        {
            jsonResponse( response, 404, { error: 'No taxonomy lives in that file.' } );
            return;
        }

        const rawTaxonomy = requested === undefined ? undefined : await readOwnedDocument( directory, requested );

        coreComponentsCache = coreComponentsCache ?? loadCoreComponents();

        const core = await coreComponentsCache;
        const packages = options.packages ?? [];

        jsonResponse( response, 200, {
            file: taxonomy.file,
            label: taxonomy.label,
            terms: taxonomy.terms,
            index: rawTaxonomy?.index !== false,
            hierarchical: taxonomy.hierarchical,
            templateBlocks: ( taxonomy.templateBlocks ?? [] ).map( ( block ) => blockSummary( block, packages, core ) ),
            indexBlocks: ( Array.isArray( taxonomy.indexBlocks ) ? taxonomy.indexBlocks : [] )
                .map( ( block ) => blockSummary( block, packages, core ) ),
        } );
        return;
    }

    const body = JSON.parse( await readBody( request ) ) as { file?: unknown; label?: unknown; index?: unknown; hierarchical?: unknown; patch?: Record<string, unknown> };

    if ( request.method === 'POST' )
    {
        if ( typeof body.label !== 'string' || body.label.trim() === '' )
        {
            jsonResponse( response, 400, { error: 'A taxonomy needs a label.' } );
            return;
        }

        const file = await freshDocumentName( directory, body.label );

        await writeOwnedDocument( directory, file, {
            casomerSchema: 1,
            kind: 'taxonomy',
            label: body.label.trim(),
            ...( body.index === false ? { index: false } : {} ),
            ...( body.hierarchical === true ? { hierarchical: true } : {} ),
            terms: [],
        } );
        jsonResponse( response, 200, { created: true, file } );
        return;
    }

    const file = safeDocumentName( body.file );
    const document = file === undefined ? undefined : await readOwnedDocument( directory, file );

    if ( file === undefined || document === undefined || document.kind !== 'taxonomy' )
    {
        jsonResponse( response, 404, { error: 'No taxonomy lives in that file.' } );
        return;
    }

    if ( request.method === 'DELETE' )
    {
        await removeOwnedDocument( directory, file );
        jsonResponse( response, 200, { deleted: true } );
        return;
    }

    if ( request.method === 'PUT' )
    {
        const patch = body.patch ?? {};

        if ( typeof patch.label === 'string' && patch.label.trim() !== '' ) { document.label = patch.label.trim(); }

        if ( patch.index === false ) { document.index = false; }
        else if ( patch.index === true && document.index === false ) { delete document.index; }

        // Drag-and-drop sort order (Mikey): the terms array IS the
        // sort order; a reorder patch rewrites it by id.
        if ( Array.isArray( patch.termOrder ) )
        {
            const terms = ( document.terms ?? [] ) as { id?: string }[];
            const byId = new Map( terms.map( ( term ) => [ term.id, term ] ) );
            const ordered = ( patch.termOrder as unknown[] )
                .filter( ( id ): id is string => typeof id === 'string' && byId.has( id ) )
                .map( ( id ) => byId.get( id ) as { id?: string } );
            const rest = terms.filter( ( term ) => !ordered.includes( term ) );

            document.terms = [ ...ordered, ...rest ] as JsonValue;
        }

        // Turning hierarchy ON is free; turning it OFF would sever
        // existing nesting, so it is refused while any term has a
        // parent - un-nest first, never lose structure silently.
        if ( patch.hierarchical === true ) { document.hierarchical = true; }
        else if ( patch.hierarchical === false )
        {
            const nested = Array.isArray( document.terms )
                && ( document.terms as Record<string, unknown>[] ).some( ( term ) => term?.parent !== undefined );

            if ( nested )
            {
                jsonResponse( response, 409, { error: 'Terms are still nested; move them to the top level first.' } );
                return;
            }

            delete document.hierarchical;
        }

        if ( patch.renameFile === true && `${slugFor( String( document.label ?? '' ) )}.json` !== file )
        {
            const desired = await freshDocumentName( directory, String( document.label ?? '' ) );

            await renameOwnedDocument( directory, 'taxonomy', file, document, desired );
            jsonResponse( response, 200, { saved: true, file: desired } );
            return;
        }

        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { saved: true, file } );
        return;
    }

    jsonResponse( response, 405, { error: 'Unsupported method.' } );
}

async function handleTerm ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;
    const body = JSON.parse( await readBody( request ) ) as { file?: unknown; id?: unknown; name?: unknown; parent?: unknown; description?: unknown; image?: unknown };
    const file = safeDocumentName( body.file );
    const document = file === undefined ? undefined : await readOwnedDocument( directory, file );

    if ( file === undefined || document === undefined || document.kind !== 'taxonomy' )
    {
        jsonResponse( response, 404, { error: 'No taxonomy lives in that file.' } );
        return;
    }

    const terms = ( Array.isArray( document.terms ) ? document.terms : [] ) as Record<string, unknown>[];

    document.terms = terms;

    if ( request.method === 'POST' )
    {
        const term = { id: randomUUID(), name: typeof body.name === 'string' ? body.name : '' };

        terms.push( term );
        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { created: true, id: term.id } );
        return;
    }

    const index = terms.findIndex( ( term ) => term.id === body.id );

    if ( index < 0 )
    {
        jsonResponse( response, 404, { error: 'No term has that id.' } );
        return;
    }

    if ( request.method === 'DELETE' )
    {
        terms.splice( index, 1 );
        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { deleted: true } );
        return;
    }

    if ( request.method === 'PUT' )
    {
        const current = terms[ index ] as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name : current.name;

        // The parent flips independently of the name: a string id
        // nests the term, null un-nests it, absent leaves it alone.
        // Description and image follow the same absent-leaves-alone
        // grammar; empties clear (absence over empty strings).
        let parent = current.parent;

        if ( body.parent === null ) { parent = undefined; }
        else if ( typeof body.parent === 'string' && body.parent !== current.id ) { parent = body.parent; }

        let description = current.description;

        if ( body.description !== undefined ) { description = typeof body.description === 'string' && body.description.trim() !== '' ? body.description : undefined; }

        let image = current.image;

        if ( body.image === null ) { image = undefined; }
        else if ( body.image !== undefined && body.image !== null && typeof body.image === 'object' && typeof ( body.image as Record<string, unknown> ).src === 'string' )
        {
            image = ( body.image as Record<string, unknown> ).src === '' ? undefined : body.image;
        }

        terms[ index ] = {
            id: current.id,
            name,
            ...( parent === undefined ? {} : { parent } ),
            ...( description === undefined ? {} : { description } ),
            ...( image === undefined ? {} : { image } ),
        };

        await writeOwnedDocument( directory, file, document as JsonValue );
        jsonResponse( response, 200, { saved: true } );
        return;
    }

    jsonResponse( response, 405, { error: 'Unsupported method.' } );
}

// Site settings, first surface: theme color values. The write is a
// merge of values into theme.colors, canonical like every write.
async function handleTheme ( options: StudioServerOptions, request: IncomingMessage, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;
    const body = JSON.parse( await readBody( request ) ) as {
        colors?: Record<string, unknown>;
        removeColors?: unknown[];
        layout?: Record<string, unknown>;
        families?: Record<string, Record<string, unknown>>;
        text?: Record<string, Record<string, unknown>>;
        resources?: unknown[];
    };
    const raw = JSON.parse( await readFile( join( directory, 'site.json' ), 'utf8' ) ) as Record<string, unknown>;
    const theme = ( raw.theme ?? {} ) as Record<string, unknown>;
    const colors = ( theme.colors ?? {} ) as Record<string, unknown>;

    // The accent rename (SCHEMA 12.1): a theme save is the migration
    // moment - a document still spelling the role "tertiary" gets the
    // canonical key, once, on its next color write.
    if ( colors.accent === undefined && colors.tertiary !== undefined )
    {
        colors.accent = colors.tertiary;
        delete colors.tertiary;
    }

    // Custom colors are unbounded (SCHEMA 12.1); names are token
    // shaped. The guaranteed three can be edited, never deleted.
    for ( const [ name, value ] of Object.entries( body.colors ?? {} ) )
    {
        if ( typeof value === 'string' && value !== '' && /^[a-z][a-z0-9-]*$/.test( name ) ) { colors[ name ] = value; }
    }

    for ( const name of body.removeColors ?? [] )
    {
        if ( typeof name === 'string' && ![ 'primary', 'secondary', 'accent' ].includes( name ) ) { delete colors[ name ]; }
    }

    theme.colors = colors;

    // The layout defaults (SCHEMA section 11.8): the site-wide gutter
    // and content width, each a token from its family.
    if ( body.layout !== undefined )
    {
        const layout = ( theme.layout ?? {} ) as Record<string, unknown>;

        for ( const key of [ 'gutter', 'width' ] )
        {
            const value = body.layout[ key ];

            if ( typeof value === 'string' && value !== '' ) { layout[ key ] = value; }
        }

        if ( Object.keys( layout ).length > 0 ) { theme.layout = layout; }
    }

    // Element typography (SCHEMA 12.1): merged per element; empty
    // strings clear a setting, an emptied element clears its entry.
    if ( body.text !== undefined )
    {
        const text = ( theme.text ?? {} ) as Record<string, Record<string, unknown>>;

        for ( const element of [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ] )
        {
            const incoming = body.text[ element ];

            if ( incoming === undefined || incoming === null || typeof incoming !== 'object' ) { continue; }

            const entry = ( text[ element ] ?? {} ) as Record<string, unknown>;

            for ( const key of [ 'size', 'font' ] )
            {
                const value = incoming[ key ];

                if ( typeof value !== 'string' ) { continue; }

                if ( value.trim() === '' ) { delete entry[ key ]; }
                else { entry[ key ] = value.trim(); }
            }

            if ( Object.keys( entry ).length === 0 ) { delete text[ element ]; }
            else { text[ element ] = entry; }
        }

        if ( Object.keys( text ).length === 0 ) { delete theme.text; }
        else { theme.text = text; }
    }

    // Third-party resources: the repeater sends the whole list.
    if ( Array.isArray( body.resources ) )
    {
        const resources = body.resources.filter( ( value ): value is string => typeof value === 'string' && value.startsWith( 'https://' ) );

        if ( resources.length === 0 ) { delete theme.resources; }
        else { theme.resources = resources; }
    }

    // Token family edits: spacing, widths, and friends, values in.
    for ( const [ familyName, tokens ] of Object.entries( body.families ?? {} ) )
    {
        if ( ![ 'colors', 'widths', 'spacing', 'radius', 'shadows' ].includes( familyName ) ) { continue; }
        if ( tokens === null || typeof tokens !== 'object' ) { continue; }

        const family = ( theme[ familyName ] ?? {} ) as Record<string, unknown>;

        for ( const [ token, value ] of Object.entries( tokens ) )
        {
            if ( typeof value === 'string' && value !== '' && /^[a-z][a-z0-9-]*$/.test( token ) ) { family[ token ] = value; }
        }

        theme[ familyName ] = family;
    }

    raw.theme = theme;
    await withJournalLock( async () =>
    {
        await journalSnapshot( directory );
        await writeFile( join( directory, 'site.json' ), serializeCanonicalJson( raw as JsonValue ), 'utf8' );
        await journalSnapshot( directory );
    } );
    jsonResponse( response, 200, { saved: true } );
}

async function servePreview ( pipeline: PreviewPipeline, slug: string, response: ServerResponse, editing: boolean ): Promise<void>
{
    const rendered = await pipeline.renderPage( slug, editing );

    // The editing bridge rides every CANVAS document: clicks select,
    // links never navigate, geometry reaches the chrome's overlay.
    // The pure preview carries neither markers nor bridge - it is the
    // real output, links and all.
    const html = editing
        ? rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' )
        : rendered.html;

    response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
    response.end( html ?? issuesPreviewPage( rendered.issues ) );
}

// The index and template canvases: a collection's two page surfaces
// rendered through the same pipeline, always with the editing bridge.
async function serveCollectionPreview (
    pipeline: PreviewPipeline,
    stem: string,
    surface: 'index' | 'template',
    response: ServerResponse,
    sampleEntryId?: string,
): Promise<void>
{
    const rendered = await pipeline.renderCollectionSurface( stem, surface, true, sampleEntryId );
    const html = rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' );

    response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
    response.end( html ?? issuesPreviewPage( rendered.issues ) );
}

// Save records a version (EDITOR section 9): commit the content
// documents, never dist. The guard keeps a save from ever landing in
// an enclosing repository: the site's folder must be its own root.
async function saveVersion ( options: StudioServerOptions, response: ServerResponse ): Promise<void>
{
    const directory = options.contentDirectory;
    const top = await runGit( directory, [ 'rev-parse', '--show-toplevel' ] );
    const sameRoot = top.code === 0
        && normalize( top.stdout.trim() ).toLowerCase() === normalize( directory ).replace( /[\\/]+$/, '' ).toLowerCase();

    if ( !sameRoot )
    {
        response.writeHead( 409, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { error: 'This site\'s folder is not its own repository, so versions cannot be saved here.' } ) );
        return;
    }

    // A save covers every owned content file - pages, site config,
    // and the self-describing collection and taxonomy documents -
    // INCLUDING deletions: a deleted file is no longer on disk to be
    // listed, so the changed set (which resolves deletions through
    // HEAD's copy) joins the pathspec. Without it, a rename's
    // delete-half never committed and a later discard resurrected
    // the old file (the venue.json incident, 2026-09-01).
    const changed = await changedContent( directory );
    const stageable = [ ...new Set( [ ...await ownedContentFiles( directory ), ...changed.files ] ) ];

    // Media travels with the content (SCHEMA 13.4): stage the whole
    // directory when it exists so icons and uploads join the version.
    try
    {
        await stat( join( directory, 'media' ) );
        stageable.push( 'media' );
    }
    catch { /* no media directory */ }

    await stagePaths( directory, stageable );

    if ( !await hasStagedChanges( directory ) )
    {
        response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( JSON.stringify( { saved: false, clean: true } ) );
        return;
    }

    const result = await commit( directory, 'casomer: save' );

    response.writeHead( result.code === 0 ? 200 : 500, { 'content-type': 'application/json; charset=utf-8' } );
    response.end( JSON.stringify( result.code === 0 ? { saved: true } : { error: 'The save did not complete.' } ) );
}

async function serveFile ( file: string, response: ServerResponse ): Promise<void>
{
    const body = await readFile( file );

    // no-cache on everything the studio serves: without it, browsers
    // heuristically cache the chrome and a reload after a casomer
    // update can run WEEKS-stale app code - the recurring "am I
    // seeing an outdated casomer?" incident. Revalidation on a local
    // server is free; staleness is not.
    response.writeHead( 200, {
        'content-type': contentTypes[ extname( file ) ] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
    } );
    response.end( body );
}

export function startStudioServer ( options: StudioServerOptions, port: number ): Promise<StudioServer>
{
    const token = options.token ?? randomBytes( 24 ).toString( 'base64url' );
    const host = options.host ?? '127.0.0.1';
    const pipeline = createPreviewPipeline( {
        contentDirectory: options.contentDirectory,
        packages: options.packages ?? [],
        ...options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion },
    } );

    const eventStreams = new Set<ServerResponse>();
    let changeTimer: NodeJS.Timeout | undefined;
    let watcher: FSWatcher | undefined;

    function broadcastChange (): void
    {
        clearTimeout( changeTimer );
        changeTimer = setTimeout( () =>
        {
            for ( const stream of eventStreams ) { stream.write( 'data: change\n\n' ); }
        }, 120 );
    }

    try
    {
        watcher = watch( options.contentDirectory, ( _event, filename ) =>
        {
            if ( filename !== null && isWatchedDocument( filename ) ) { broadcastChange(); }
        } );
    }
    catch { /* a missing watcher degrades to manual reloads, never a crash */ }

    const server: Server = createServer( ( request, response ) =>
    {
        void ( async () =>
        {
            const url = new URL( request.url ?? '/', 'http://localhost' );

            if ( requestToken( request ) !== token )
            {
                response.writeHead( 401, { 'content-type': 'text/plain; charset=utf-8' } );
                response.end( 'This Studio link needs its session token. Copy the full link from the terminal that started caso studio.' );
                return;
            }

            if ( url.searchParams.get( 't' ) === token )
            {
                response.setHeader( 'set-cookie', `${tokenCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` );
            }

            if ( url.pathname === '/api/avatar' )
            {
                const avatar = await avatarFile();

                if ( avatar === undefined )
                {
                    jsonResponse( response, 404, { error: 'No avatar is configured.' } );
                    return;
                }

                await serveFile( avatar, response );
                return;
            }

            if ( url.pathname === '/api/site' )
            {
                await serveSite( options, response );
                return;
            }

            if ( url.pathname === '/api/block' )
            {
                if ( request.method === 'PUT' ) { await writeBlock( options, request, response ); }
                else if ( request.method === 'POST' ) { await insertBlock( options, request, response ); }
                else if ( request.method === 'DELETE' ) { await removeBlock( options, request, response ); }
                else { await serveBlock( options, url, response ); }
                return;
            }

            // The save speed bump's food: required-field problems,
            // computed cheaply (no rendering). Save never blocks - it
            // asks; publish enforces the full set.
            if ( url.pathname === '/api/problems' )
            {
                const result = await loadSiteDirectory( options.contentDirectory, options.packages ?? [] );

                jsonResponse( response, 200, { problems: entryRequiredProblems( result.collections ) } );
                return;
            }

            if ( url.pathname === '/api/components' )
            {
                await serveComponents( options, response );
                return;
            }

            if ( url.pathname === '/api/collection' )
            {
                await handleCollection( options, request, url, response );
                return;
            }

            if ( url.pathname === '/api/entry' )
            {
                await handleEntry( options, request, response );
                return;
            }

            // Divergence is explicit (SCHEMA 13.4, Mikey's "break out
            // of the mold"): "diverge" copies the CURRENT template
            // into the entry as its own layout; "adopt" discards the
            // entry's layout and returns it to the template. Both
            // journaled - undo has a step either way.
            if ( url.pathname === '/api/entry-layout' && request.method === 'POST' )
            {
                const body = JSON.parse( await readBody( request ) ) as { file?: unknown; id?: unknown; action?: unknown };
                const file = safeDocumentName( body.file );
                const document = file === undefined ? undefined : await readOwnedDocument( options.contentDirectory, file );

                if ( file === undefined || document === undefined || document.kind !== 'collection' || !Array.isArray( document.entries ) )
                {
                    jsonResponse( response, 404, { error: 'No collection lives in that file.' } );
                    return;
                }

                const entry = ( document.entries as Record<string, unknown>[] ).find( ( candidate ) => candidate.id === body.id );

                if ( entry === undefined )
                {
                    jsonResponse( response, 404, { error: 'No entry has that id.' } );
                    return;
                }

                if ( body.action === 'diverge' )
                {
                    const template = ( document.template as { blocks?: unknown[] } | undefined )?.blocks ?? [];

                    entry.blocks = structuredClone( template );
                }
                else if ( body.action === 'adopt' )
                {
                    delete entry.blocks;
                }
                else
                {
                    jsonResponse( response, 400, { error: 'The action is "diverge" or "adopt".' } );
                    return;
                }

                await writeOwnedDocument( options.contentDirectory, file, document as JsonValue );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // A new page: title in, slugified public spelling derived
            // with collision suffixes, empty blocks, journaled write.
            if ( url.pathname === '/api/page' && request.method === 'POST' )
            {
                const body = JSON.parse( await readBody( request ) ) as { title?: unknown };

                if ( typeof body.title !== 'string' || body.title.trim() === '' )
                {
                    jsonResponse( response, 400, { error: 'A page needs a title: it is the designated h1.' } );
                    return;
                }

                const pagesFile = join( options.contentDirectory, 'pages.json' );
                const document = parseJsonDocument( await readFile( pagesFile, 'utf8' ) ) as { pages?: Record<string, unknown>[] };
                const pages = document.pages ?? [];
                const taken = new Set( pages.map( ( page ) => String( page.slug ?? '' ) ) );
                const base = slugFor( body.title );
                let slug = base;

                for ( let attempt = 2; taken.has( slug ); attempt += 1 ) { slug = `${base}-${attempt}`; }

                // A new page arrives with its title as a real, editable
                // heading block (SCHEMA 8: nothing is scaffolded into
                // the output; the default page PREFILLS instead).
                const page = {
                    id: randomUUID(),
                    title: body.title.trim(),
                    slug,
                    blocks: [ {
                        section: {},
                        blocks: [ { component: 'core/heading', props: { text: { $bind: 'page.title' } } } ],
                    } ],
                };

                pages.push( page );
                document.pages = pages;
                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( pagesFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { created: true, id: page.id, slug } );
                return;
            }

            // A page's own settings: the title (its h1 and its listed
            // name), the offered address change (SCHEMA 13.6: renames
            // move subtrees, offered, never silent), the draft switch,
            // and its place in the URL tree - "parent" nests the page
            // under another, null returns it to the top level.
            if ( url.pathname === '/api/page' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { id?: string; patch?: { title?: unknown; slug?: unknown; draft?: unknown; parent?: unknown } };
                const pagesFile = join( options.contentDirectory, 'pages.json' );
                const document = parseJsonDocument( await readFile( pagesFile, 'utf8' ) ) as { pages?: Record<string, unknown>[] };
                const page = document.pages?.find( ( candidate ) => candidate.id === body.id );

                if ( page === undefined )
                {
                    jsonResponse( response, 404, { error: 'No page has that id.' } );
                    return;
                }

                if ( body.patch?.title !== undefined )
                {
                    if ( typeof body.patch.title !== 'string' || body.patch.title.trim() === '' )
                    {
                        jsonResponse( response, 400, { error: 'A page needs a title: it is the designated h1.' } );
                        return;
                    }

                    page.title = body.patch.title.trim();
                }

                if ( body.patch?.slug !== undefined )
                {
                    const slug = body.patch.slug;

                    if ( page.slug === 'home' )
                    {
                        jsonResponse( response, 400, { error: 'Home is the root; its address never changes.' } );
                        return;
                    }

                    if ( typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test( slug ) )
                    {
                        jsonResponse( response, 400, { error: 'A page slug is lowercase words joined by hyphens.' } );
                        return;
                    }

                    if ( document.pages?.some( ( candidate ) => candidate.id !== page.id && candidate.slug === slug ) )
                    {
                        jsonResponse( response, 409, { error: `Another page already owns the slug "${slug}".` } );
                        return;
                    }

                    page.slug = slug;
                }

                if ( body.patch?.draft === true ) { page.draft = true; }
                else if ( body.patch?.draft === false ) { delete page.draft; }

                if ( body.patch?.parent === null ) { delete page.parent; }
                else if ( typeof body.patch?.parent === 'string' )
                {
                    const target = document.pages?.find( ( candidate ) => candidate.id === body.patch?.parent );

                    if ( target === undefined || page.slug === 'home' || target.slug === 'home' )
                    {
                        jsonResponse( response, 400, { error: 'A parent is an existing page; home neither takes nor grants one.' } );
                        return;
                    }

                    // Never nest a page under its own descendant: walk
                    // up from the target; meeting the page is a loop.
                    let ancestor: Record<string, unknown> | undefined = target;

                    while ( ancestor !== undefined )
                    {
                        if ( ancestor.id === page.id )
                        {
                            jsonResponse( response, 409, { error: 'That page sits under this one; nesting there would loop the tree.' } );
                            return;
                        }

                        const next: unknown = ancestor.parent;

                        ancestor = typeof next === 'string' ? document.pages?.find( ( candidate ) => candidate.id === next ) : undefined;
                    }

                    page.parent = body.patch.parent;
                }

                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( pagesFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // Deleting a page: journaled and undoable, but never home
            // (the site's root) and never silently out from under its
            // subtree - nested pages and mounted collections must be
            // moved first (the taxonomy un-nest refusal, applied
            // again: refuse silent flattening).
            if ( url.pathname === '/api/page' && request.method === 'DELETE' )
            {
                const body = JSON.parse( await readBody( request ) ) as { id?: string };
                const pagesFile = join( options.contentDirectory, 'pages.json' );
                const document = parseJsonDocument( await readFile( pagesFile, 'utf8' ) ) as { pages?: Record<string, unknown>[] };
                const page = document.pages?.find( ( candidate ) => candidate.id === body.id );

                if ( page === undefined )
                {
                    jsonResponse( response, 404, { error: 'No page has that id.' } );
                    return;
                }

                if ( page.slug === 'home' )
                {
                    jsonResponse( response, 400, { error: 'Home is the site\'s root; it cannot be deleted.' } );
                    return;
                }

                if ( document.pages?.some( ( candidate ) => candidate.parent === page.id ) )
                {
                    jsonResponse( response, 409, { error: 'Pages are nested under this one; move them first.' } );
                    return;
                }

                const loaded = await loadSiteDirectory( options.contentDirectory, options.packages ?? [] );

                if ( loaded.collections.some( ( collection ) => collection.parent === page.id ) )
                {
                    jsonResponse( response, 409, { error: 'A collection is mounted under this page; move it first.' } );
                    return;
                }

                document.pages = ( document.pages ?? [] ).filter( ( candidate ) => candidate.id !== page.id );
                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( pagesFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { deleted: true } );
                return;
            }

            if ( url.pathname === '/api/taxonomy' )
            {
                await handleTaxonomy( options, request, url, response );
                return;
            }

            if ( url.pathname === '/api/term' )
            {
                await handleTerm( options, request, response );
                return;
            }

            if ( url.pathname === '/api/theme' && request.method === 'PUT' )
            {
                await handleTheme( options, request, response );
                return;
            }

            // The declaration is revisitable (BUSINESS 5.3): the
            // chrome collects the commercial micro-assent before this
            // write ever happens.
            // Media upload (SCHEMA 13.4): raw bytes in, UUID-renamed
            // file under media/, the site-relative path and the
            // retained original name back. The picker stores both on
            // the field value; alt derivation leans on the name.
            if ( url.pathname === '/api/media' && request.method === 'POST' )
            {
                const extensions: Readonly<Record<string, string>> = {
                    'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg',
                    'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif',
                    'application/pdf': '.pdf', 'text/plain': '.txt',
                    'application/octet-stream': '.bin',
                };
                const contentType = ( request.headers[ 'content-type' ] ?? '' ).split( ';' )[ 0 ] as string;
                const original = decodeURIComponent( String( request.headers[ 'x-casomer-name' ] ?? '' ) ).replace( /[\\/]/g, '' ).slice( 0, 200 );
                const fromName = /\.[A-Za-z0-9]{1,8}$/.exec( original )?.[ 0 ]?.toLowerCase();
                const extension = extensions[ contentType ] ?? fromName ?? '.bin';

                // The human name drops the extension (Mikey:
                // "image.png just reads image") - the format is
                // plumbing, visible on the file row when it matters.
                const label = original.replace( /\.[A-Za-z0-9]{1,8}$/, '' ) || original;

                const chunks: Buffer[] = [];

                for await ( const chunk of request ) { chunks.push( chunk as Buffer ); }

                const bytes = Buffer.concat( chunks );

                if ( bytes.length === 0 || bytes.length > 20 * 1024 * 1024 )
                {
                    jsonResponse( response, 400, { error: 'An upload is between 1 byte and 20 MB.' } );
                    return;
                }

                // Upload-time optimization (SCHEMA 13.4, Mikey: "we
                // must optimize"): images downsize to the site's
                // maxEdge and re-encode as webp BEFORE anything
                // touches disk - the repo only ever sees the
                // optimized bytes. Non-images pass through.
                const site = await readOwnedDocument( options.contentDirectory, 'site.json' );
                const policy = mediaRecordOf( site );
                const optimized = await optimizeUpload( bytes, extension, {
                    maxEdge: typeof policy.maxEdge === 'number' ? policy.maxEdge : defaultMediaSettings.maxEdge,
                    quality: typeof policy.quality === 'number' ? policy.quality : defaultMediaSettings.quality,
                } );

                const fileName = `${randomUUID()}${optimized.extension}`;
                const mediaDirectory = join( options.contentDirectory, 'media' );

                await mkdir( mediaDirectory, { recursive: true } );
                await writeFile( join( mediaDirectory, fileName ), optimized.bytes );

                // The original filename becomes the file's LABEL,
                // stored in site.json's media record (SCHEMA 13.4:
                // "retained as the file's label") - the library shows
                // it everywhere humans look; the UUID stays plumbing.
                if ( label !== '' && site !== undefined )
                {
                    setMediaLabels( site, { ...mediaLabelsOf( site ), [ fileName ]: label } );
                    await writeOwnedDocument( options.contentDirectory, 'site.json', site as JsonValue );
                }

                jsonResponse( response, 200, {
                    src: `/media/${fileName}`,
                    name: label === '' ? fileName : label,
                    size: optimized.bytes.length,
                    converted: optimized.converted,
                } );
                return;
            }

            // The media-tracking choice, revisitable from Studio
            // (SCHEMA 13.4): off adds the managed .gitignore lines
            // and untracks already-committed binaries going forward
            // (history keeps them; the next publish commits the
            // untracking); on removes exactly those lines. Labels
            // and metadata version regardless.
            if ( url.pathname === '/api/media-tracking' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { track?: unknown };

                if ( typeof body.track !== 'boolean' )
                {
                    jsonResponse( response, 400, { error: '"track" is true or false.' } );
                    return;
                }

                const site = await readOwnedDocument( options.contentDirectory, 'site.json' );

                if ( site === undefined )
                {
                    jsonResponse( response, 404, { error: 'No site.json to hold the choice.' } );
                    return;
                }

                const record = mediaRecordOf( site );

                if ( body.track ) { delete record.track; }
                else { record.track = false; }

                if ( Object.keys( record ).length === 0 ) { delete site.media; }
                else { site.media = record; }

                await writeOwnedDocument( options.contentDirectory, 'site.json', site as JsonValue );

                if ( body.track )
                {
                    await removeIgnoreLines( options.contentDirectory, [ 'media/', 'dist/media/' ] );
                }
                else
                {
                    await appendIgnoreLines( options.contentDirectory, [ 'media/', 'dist/media/' ] );
                    await runGit( options.contentDirectory, [ 'rm', '-r', '--cached', '--ignore-unmatch', '--', 'media', 'dist/media' ] );
                }

                jsonResponse( response, 200, { track: body.track } );
                return;
            }

            // A media file's label: editable bookkeeping, never
            // load-bearing (SCHEMA 13.4).
            if ( url.pathname === '/api/media' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { file?: unknown; label?: unknown };
                const name = typeof body.file === 'string' && /^[A-Za-z0-9._-]+$/.test( body.file ) ? body.file : undefined;
                const label = typeof body.label === 'string' ? body.label.trim() : undefined;

                if ( name === undefined || label === undefined )
                {
                    jsonResponse( response, 400, { error: 'A label edit names one file and its label.' } );
                    return;
                }

                const site = await readOwnedDocument( options.contentDirectory, 'site.json' );

                if ( site === undefined )
                {
                    jsonResponse( response, 404, { error: 'No site.json to hold the label.' } );
                    return;
                }

                const labels = mediaLabelsOf( site );

                if ( label === '' ) { delete labels[ name ]; }
                else { labels[ name ] = label; }

                setMediaLabels( site, labels );
                await writeOwnedDocument( options.contentDirectory, 'site.json', site as JsonValue );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // The site icon: one square image, uploaded as raw bytes,
            // stored under media/ with a UUID name (SCHEMA 13.4) and
            // referenced from site.json's "icon". DELETE clears the
            // reference; the file stays for history.
            if ( url.pathname === '/api/site-icon' && request.method === 'POST' )
            {
                const extensions: Readonly<Record<string, string>> = {
                    'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg',
                    'image/webp': '.webp', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
                };
                const extension = extensions[ request.headers[ 'content-type' ] ?? '' ];

                if ( extension === undefined )
                {
                    jsonResponse( response, 400, { error: 'The icon is a png, jpeg, svg, webp, or ico image.' } );
                    return;
                }

                const chunks: Buffer[] = [];

                for await ( const chunk of request ) { chunks.push( chunk as Buffer ); }

                const bytes = Buffer.concat( chunks );

                if ( bytes.length === 0 || bytes.length > 1024 * 1024 )
                {
                    jsonResponse( response, 400, { error: 'An icon is between 1 byte and 1 MB.' } );
                    return;
                }

                const name = `${randomUUID()}${extension}`;
                const mediaDirectory = join( options.contentDirectory, 'media' );

                await mkdir( mediaDirectory, { recursive: true } );
                await writeFile( join( mediaDirectory, name ), bytes );

                const siteFile = join( options.contentDirectory, 'site.json' );
                const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

                raw.icon = `/media/${name}`;
                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { saved: true, icon: raw.icon } );
                return;
            }

            if ( url.pathname === '/api/site-icon' && request.method === 'DELETE' )
            {
                const siteFile = join( options.contentDirectory, 'site.json' );
                const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

                delete raw.icon;
                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // Menus (SCHEMA 12.5): the editor sends the whole record -
            // { name: { topLevelPages, items } } - and saves migrate
            // any pre-nesting bare-array spelling. Items nest freely;
            // each targets exactly one of page, collection, taxonomy,
            // url, or is a label-only group. Shapes are enforced;
            // malformed items are dropped, never written.
            // User-defined partials (SCHEMA 12.5): created and deleted
            // explicitly here; edited through the region plumbing.
            if ( url.pathname === '/api/partial' && ( request.method === 'POST' || request.method === 'DELETE' ) )
            {
                const body = JSON.parse( await readBody( request ) ) as { name?: unknown };
                const raw = typeof body.name === 'string' ? body.name : '';
                const siteFile = join( options.contentDirectory, 'site.json' );
                const document = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;
                const partials = ( document.partials ?? {} ) as Record<string, unknown>;

                if ( request.method === 'POST' )
                {
                    const stem = raw.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).replace( /^[^a-z]+/, '' );

                    if ( stem === '' || [ 'header', 'footer', 'notfound' ].includes( stem ) )
                    {
                        jsonResponse( response, 400, { error: 'A partial needs a token-shaped name; header, footer, and notFound are reserved.' } );
                        return;
                    }

                    let unique = stem;
                    let suffix = 2;

                    while ( partials[ unique ] !== undefined )
                    {
                        unique = `${stem}-${suffix}`;
                        suffix += 1;
                    }

                    partials[ unique ] = [];
                    document.partials = partials;
                    await withJournalLock( async () =>
                    {
                        await journalSnapshot( options.contentDirectory );
                        await writeFile( siteFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );
                        await journalSnapshot( options.contentDirectory );
                    } );
                    jsonResponse( response, 200, { created: true, name: unique } );
                    return;
                }

                if ( partials[ raw ] === undefined )
                {
                    jsonResponse( response, 404, { error: `There is no partial "${raw}".` } );
                    return;
                }

                delete partials[ raw ];

                if ( Object.keys( partials ).length === 0 ) { delete document.partials; }
                else { document.partials = partials; }

                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( siteFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { deleted: true } );
                return;
            }

            if ( url.pathname === '/api/menus' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { menus?: Record<string, unknown> };

                if ( body.menus === undefined || body.menus === null || typeof body.menus !== 'object' || Array.isArray( body.menus ) )
                {
                    jsonResponse( response, 400, { error: '"menus" is an object of named menus.' } );
                    return;
                }

                const cleanItems = ( raw: unknown ): Record<string, unknown>[] =>
                {
                    if ( !Array.isArray( raw ) ) { return []; }

                    return ( raw as Record<string, unknown>[] ).flatMap( ( item ) =>
                    {
                        if ( item === null || typeof item !== 'object' ) { return []; }

                        const targets = [ 'page', 'collection', 'taxonomy', 'url' ]
                            .filter( ( key ) => typeof item[ key ] === 'string' && item[ key ] !== '' );
                        const label = typeof item.label === 'string' && item.label !== '' ? item.label : undefined;
                        const children = cleanItems( item.items );

                        if ( targets.length > 1 ) { return []; }
                        if ( targets.length === 0 && label === undefined ) { return []; }
                        if ( targets[ 0 ] === 'url' && label === undefined ) { return []; }

                        return [ {
                            ...( targets[ 0 ] === undefined ? {} : { [ targets[ 0 ] ]: item[ targets[ 0 ] ] } ),
                            ...( label === undefined ? {} : { label } ),
                            ...( children.length === 0 ? {} : { items: children } ),
                            ...( typeof item.auto === 'string' && item.auto !== '' ? { auto: item.auto } : {} ),
                        } ];
                    } );
                };

                const menus: Record<string, unknown> = {};

                for ( const [ name, rawMenu ] of Object.entries( body.menus ) )
                {
                    if ( !/^[a-z][a-z0-9-]*$/.test( name ) ) { continue; }

                    const record = Array.isArray( rawMenu )
                        ? { items: rawMenu }
                        : ( rawMenu !== null && typeof rawMenu === 'object' ? rawMenu as Record<string, unknown> : null );

                    if ( record === null ) { continue; }

                    menus[ name ] = {
                        ...Object.fromEntries( [ 'topLevelPages', 'childPages', 'collectionIndexes', 'taxonomyIndexes' ]
                            .filter( ( rule ) => record[ rule ] === true )
                            .map( ( rule ) => [ rule, true ] ) ),
                        items: cleanItems( record.items ),
                    };
                }

                const siteFile = join( options.contentDirectory, 'site.json' );
                const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

                if ( Object.keys( menus ).length === 0 ) { delete raw.menus; }
                else { raw.menus = menus; }

                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // Renaming a menu (SCHEMA 12.5): the name is the token
            // repeats and binds reference, so the rename sweeps every
            // content file and rewrites { "repeat": { "source": {
            // "menu": <old> } } } along with the site.json key - a
            // rename never strands a reference.
            if ( url.pathname === '/api/menu-rename' && request.method === 'POST' )
            {
                const body = JSON.parse( await readBody( request ) ) as { from?: unknown; to?: unknown };
                const from = typeof body.from === 'string' ? body.from : '';
                const to = typeof body.to === 'string' ? body.to : '';

                if ( !/^[a-z][a-z0-9-]*$/.test( from ) || !/^[a-z][a-z0-9-]*$/.test( to ) )
                {
                    jsonResponse( response, 400, { error: 'A menu name is token shaped: lowercase, digits, hyphens.' } );
                    return;
                }

                const siteFile = join( options.contentDirectory, 'site.json' );
                const siteRaw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;
                const menusRecord = siteRaw.menus as Record<string, unknown> | undefined;

                if ( menusRecord?.[ from ] === undefined )
                {
                    jsonResponse( response, 404, { error: `There is no menu "${from}".` } );
                    return;
                }

                if ( from !== to && menusRecord[ to ] !== undefined )
                {
                    jsonResponse( response, 409, { error: `A menu named "${to}" already exists.` } );
                    return;
                }

                if ( from === to )
                {
                    jsonResponse( response, 200, { renamed: to } );
                    return;
                }

                const rewriteSources = ( value: unknown ): boolean =>
                {
                    let changed = false;

                    if ( Array.isArray( value ) )
                    {
                        for ( const entry of value ) { changed = rewriteSources( entry ) || changed; }
                        return changed;
                    }

                    if ( value === null || typeof value !== 'object' ) { return false; }

                    const record = value as Record<string, unknown>;
                    const source = ( record.repeat as Record<string, unknown> | undefined )?.source as Record<string, unknown> | undefined;

                    if ( source !== undefined && source.menu === from )
                    {
                        source.menu = to;
                        changed = true;
                    }

                    for ( const entry of Object.values( record ) ) { changed = rewriteSources( entry ) || changed; }
                    return changed;
                };

                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );

                    // The key renames in place, order preserved, so the
                    // nav keeps its row position.
                    siteRaw.menus = Object.fromEntries(
                        Object.entries( menusRecord ).map( ( [ name, value ] ) => [ name === from ? to : name, value ] ),
                    );
                    rewriteSources( siteRaw.regions );
                    await writeFile( siteFile, serializeCanonicalJson( siteRaw as JsonValue ), 'utf8' );

                    for ( const file of await readdir( options.contentDirectory ) )
                    {
                        if ( !file.endsWith( '.json' ) || file === 'site.json' ) { continue; }

                        const path = join( options.contentDirectory, file );
                        const raw = JSON.parse( await readFile( path, 'utf8' ) ) as JsonValue;

                        if ( rewriteSources( raw ) ) { await writeFile( path, serializeCanonicalJson( raw ), 'utf8' ); }
                    }

                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { renamed: to } );
                return;
            }

            // Renaming a field key (Mikey: the key IS a slug of the
            // label). The sweep renames the field record, the table
            // column, every entry's value key, sibling conditions and
            // byField options - and every entry.* reference in scope:
            // the collection's own surfaces blanket, and elsewhere
            // only inside repeats whose source targets this
            // collection. $bind strings, order strings, and inline
            // {{ $entry.x }} tokens all follow. Known limit, recorded:
            // bind-through spellings from OTHER collections
            // ($entry.someRef.<thisKey>) are not swept yet.
            if ( url.pathname === '/api/field-rename' && request.method === 'POST' )
            {
                const body = JSON.parse( await readBody( request ) ) as { file?: unknown; from?: unknown; to?: unknown };
                const file = safeDocumentName( body.file );
                const from = typeof body.from === 'string' ? body.from : '';
                const to = typeof body.to === 'string' ? body.to : '';
                const keyShape = /^[A-Za-z_][A-Za-z0-9_]*$/;

                if ( file === undefined || !keyShape.test( from ) || !keyShape.test( to ) || from === 'title' || to === 'title' )
                {
                    jsonResponse( response, 400, { error: 'A field rename takes a collection file and two identifier keys; "title" is the contract key and never renames.' } );
                    return;
                }

                const collectionFile = join( options.contentDirectory, file );
                const document = JSON.parse( await readFile( collectionFile, 'utf8' ) ) as Record<string, unknown>;
                const fieldsRecord = document.fields as Record<string, unknown> | undefined;

                if ( document.kind !== 'collection' || fieldsRecord?.[ from ] === undefined )
                {
                    jsonResponse( response, 404, { error: `No field "${from}" lives in ${file}.` } );
                    return;
                }

                if ( from !== to && fieldsRecord[ to ] !== undefined )
                {
                    jsonResponse( response, 409, { error: `A field named "${to}" already exists.` } );
                    return;
                }

                if ( from === to )
                {
                    jsonResponse( response, 200, { renamed: to } );
                    return;
                }

                const stem = file.replace( /\.json$/, '' );
                const escaped = from.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
                const tokenShape = new RegExp( `(\\{\\{\\s*\\$entry\\.)${escaped}(?=[\\s.}])`, 'g' );
                const renameString = ( text: string ): string =>
                {
                    let next = text.replace( tokenShape, `$1${to}` );

                    if ( next === `entry.${from}` || next.startsWith( `entry.${from}.` ) ) { next = `entry.${to}${next.slice( `entry.${from}`.length )}`; }
                    if ( next === `-entry.${from}` || next.startsWith( `-entry.${from}.` ) ) { next = `-entry.${to}${next.slice( `-entry.${from}`.length )}`; }

                    return next;
                };
                const walk = ( value: unknown, inScope: boolean ): unknown =>
                {
                    if ( typeof value === 'string' ) { return inScope ? renameString( value ) : value; }
                    if ( Array.isArray( value ) ) { return value.map( ( item ) => walk( item, inScope ) ); }
                    if ( value === null || typeof value !== 'object' ) { return value; }

                    const record = value as Record<string, unknown>;
                    const source = ( record.repeat as Record<string, unknown> | undefined )?.source as Record<string, unknown> | undefined;
                    const scoped = inScope || source?.collection === stem;

                    return Object.fromEntries( Object.entries( record ).map( ( [ key, item ] ) => [ key, walk( item, scoped ) ] ) );
                };

                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );

                    // The collection's own document: the field record
                    // (order preserved), the table, entry values,
                    // sibling conditions and byField options, and its
                    // surfaces blanket-swept.
                    document.fields = Object.fromEntries(
                        Object.entries( fieldsRecord ).map( ( [ key, field ] ) => [ key === from ? to : key, field ] ),
                    );

                    for ( const field of Object.values( document.fields as Record<string, unknown> ) )
                    {
                        if ( field === null || typeof field !== 'object' ) { continue; }

                        const fieldRecord = field as Record<string, unknown>;
                        const options_ = fieldRecord.options as Record<string, unknown> | undefined;

                        if ( options_?.byField === from ) { options_.byField = to; }

                        for ( const conditionKey of [ 'showWhen', 'requiredWhen' ] )
                        {
                            const condition = fieldRecord[ conditionKey ];

                            if ( typeof condition === 'string' )
                            {
                                fieldRecord[ conditionKey ] = condition.replace( new RegExp( `\\b${escaped}\\b`, 'g' ), to );
                            }
                            else if ( condition !== null && typeof condition === 'object' && typeof ( condition as Record<string, unknown> ).source === 'string' )
                            {
                                ( condition as Record<string, unknown> ).source
                                    = ( ( condition as Record<string, unknown> ).source as string ).replace( new RegExp( `\\b${escaped}\\b`, 'g' ), to );
                            }
                        }
                    }

                    if ( Array.isArray( document.table ) )
                    {
                        document.table = document.table.map( ( column ) => ( column === from ? to : column ) );
                    }

                    if ( Array.isArray( document.entries ) )
                    {
                        document.entries = ( document.entries as Record<string, unknown>[] ).map( ( entry ) =>
                            Object.fromEntries( Object.entries( entry ).map( ( [ key, item ] ) => [ key === from ? to : key, item ] ) ) );
                    }

                    if ( document.template !== undefined ) { document.template = walk( document.template, true ); }
                    if ( document.index !== undefined && document.index !== false ) { document.index = walk( document.index, true ); }
                    document.entries = walk( document.entries, true );
                    await writeFile( collectionFile, serializeCanonicalJson( document as JsonValue ), 'utf8' );

                    // Everywhere else, only repeats targeting this
                    // collection are in scope.
                    for ( const other of await readdir( options.contentDirectory ) )
                    {
                        if ( !other.endsWith( '.json' ) || other === file ) { continue; }

                        const path = join( options.contentDirectory, other );
                        const raw = JSON.parse( await readFile( path, 'utf8' ) );
                        const rewritten = walk( raw, false );

                        if ( JSON.stringify( rewritten ) !== JSON.stringify( raw ) )
                        {
                            await writeFile( path, serializeCanonicalJson( rewritten as JsonValue ), 'utf8' );
                        }
                    }

                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { renamed: to } );
                return;
            }

            // The media library (SCHEMA 13.4): every file in media/
            // with its LABEL (site.json media record - the uploaded
            // filename; the UUID stays plumbing), size, and how many
            // places reference it - usage is a text scan for
            // /media/<name> across every content document. Plus the
            // TRASH (Mikey's model): deleted files move to trash/,
            // browsable, restorable, and only permanently gone when
            // someone empties the trash. The binaries are never
            // journaled and trash/ is never staged - metadata is the
            // tracked truth.
            if ( url.pathname === '/api/media-library' && request.method === 'GET' )
            {
                const mediaDirectory = join( options.contentDirectory, 'media' );
                const trashDirectory = join( options.contentDirectory, 'trash' );
                let names: string[] = [];
                let trashNames: string[] = [];

                try { names = await readdir( mediaDirectory ); }
                catch { /* no media directory is a fine site */ }

                try { trashNames = ( await readdir( trashDirectory ) ).filter( ( name ) => name !== '.gitignore' ); }
                catch { /* no trash yet */ }

                const used = new Map<string, number>();

                for ( const file of await readdir( options.contentDirectory ) )
                {
                    if ( !file.endsWith( '.json' ) ) { continue; }

                    const text = await readFile( join( options.contentDirectory, file ), 'utf8' );

                    for ( const match of text.matchAll( /\/media\/([A-Za-z0-9._-]+)/g ) )
                    {
                        used.set( match[ 1 ] as string, ( used.get( match[ 1 ] as string ) ?? 0 ) + 1 );
                    }
                }

                const site = await readOwnedDocument( options.contentDirectory, 'site.json' );
                const labels = mediaLabelsOf( site );

                const files = await Promise.all( names.map( async ( name ) =>
                {
                    const info = await stat( join( mediaDirectory, name ) );

                    return {
                        file: name,
                        size: info.size,
                        url: `/media/${name}`,
                        references: used.get( name ) ?? 0,
                        ...( typeof labels[ name ] === 'string' ? { label: labels[ name ] } : {} ),
                    };
                } ) );
                const trash = await Promise.all( trashNames.map( async ( name ) =>
                {
                    const info = await stat( join( trashDirectory, name ) );

                    return {
                        file: name,
                        size: info.size,
                        url: `/trash/${name}`,
                        ...( typeof labels[ name ] === 'string' ? { label: labels[ name ] } : {} ),
                    };
                } ) );

                jsonResponse( response, 200, { files, trash } );
                return;
            }

            // The relational "used by" list (Mikey): everything that
            // references a target string - a /media/ path, a term id,
            // an entry id - located structurally: which page, which
            // entry, which term, which site area. The chrome renders
            // these as jump links wherever something is in use.
            if ( url.pathname === '/api/usage' && request.method === 'GET' )
            {
                const target = url.searchParams.get( 'target' ) ?? '';

                if ( target.length < 4 )
                {
                    jsonResponse( response, 400, { error: 'A usage query names its target.' } );
                    return;
                }

                const contains = ( value: unknown ): boolean => value !== undefined && JSON.stringify( value ).includes( target );
                const rows: Record<string, unknown>[] = [];

                for ( const file of await ownedContentFiles( options.contentDirectory ) )
                {
                    let document: Record<string, unknown>;

                    try
                    {
                        document = JSON.parse( await readFile( join( options.contentDirectory, file ), 'utf8' ) ) as Record<string, unknown>;
                    }
                    catch
                    {
                        continue;
                    }

                    if ( file === 'pages.json' )
                    {
                        for ( const page of ( Array.isArray( document.pages ) ? document.pages : [] ) as Record<string, unknown>[] )
                        {
                            if ( contains( page ) ) { rows.push( { kind: 'page', id: page.id, title: page.title ?? page.slug ?? '' } ); }
                        }

                        continue;
                    }

                    if ( file === 'site.json' )
                    {
                        // The labels record is bookkeeping about the
                        // target, not a use of it - only real site
                        // areas count.
                        const regions = document.regions as Record<string, unknown> | undefined;
                        const areas: [ string, unknown ][] = [
                            [ 'header', regions?.header ],
                            [ 'footer', regions?.footer ],
                            [ 'notFound', document.notFound ],
                            ...Object.entries( document.partials as Record<string, unknown> ?? {} )
                                .map( ( [ name, blocks ] ): [ string, unknown ] => [ `partial:${name}`, blocks ] ),
                            [ 'menus', document.menus ],
                            [ 'theme', document.theme ],
                            [ 'icon', document.icon ],
                        ];

                        for ( const [ area, value ] of areas )
                        {
                            if ( contains( value ) ) { rows.push( { kind: 'site', area } ); }
                        }

                        continue;
                    }

                    if ( document.kind === 'collection' )
                    {
                        const entries = ( Array.isArray( document.entries ) ? document.entries : [] ) as Record<string, unknown>[];
                        const label = typeof document.label === 'string' ? document.label : file.replace( /\.json$/, '' );

                        if ( contains( { ...document, entries: undefined } ) ) { rows.push( { kind: 'collection', file, title: label } ); }

                        for ( const entry of entries )
                        {
                            if ( contains( entry ) )
                            {
                                // Entries store fields flat; older
                                // shapes nested them under values.
                                rows.push( {
                                    kind: 'entry',
                                    file,
                                    id: entry.id,
                                    title: entry.title ?? ( entry.values as Record<string, unknown> | undefined )?.title ?? '',
                                } );
                            }
                        }

                        continue;
                    }

                    if ( document.kind === 'taxonomy' )
                    {
                        const terms = ( Array.isArray( document.terms ) ? document.terms : [] ) as Record<string, unknown>[];
                        const label = typeof document.label === 'string' ? document.label : file.replace( /\.json$/, '' );

                        if ( contains( { ...document, terms: undefined } ) ) { rows.push( { kind: 'taxonomy', file, title: label } ); }

                        for ( const term of terms )
                        {
                            if ( contains( term ) ) { rows.push( { kind: 'term', file, id: term.id, title: term.name ?? '' } ); }
                        }
                    }
                }

                jsonResponse( response, 200, { rows } );
                return;
            }

            // Deleting from the library MOVES to trash/ - reversible
            // until the trash is emptied. Refuses while referenced.
            if ( url.pathname === '/api/media' && request.method === 'DELETE' )
            {
                const body = JSON.parse( await readBody( request ) ) as { file?: unknown };
                const name = typeof body.file === 'string' && /^[A-Za-z0-9._-]+$/.test( body.file ) ? body.file : undefined;

                if ( name === undefined )
                {
                    jsonResponse( response, 400, { error: 'A media delete names one file.' } );
                    return;
                }

                // Usage is re-checked at delete time: never remove a
                // file something still points at.
                for ( const file of await readdir( options.contentDirectory ) )
                {
                    if ( !file.endsWith( '.json' ) ) { continue; }

                    const text = await readFile( join( options.contentDirectory, file ), 'utf8' );

                    if ( text.includes( `/media/${name}` ) )
                    {
                        jsonResponse( response, 409, { error: `${file} still references this file.` } );
                        return;
                    }
                }

                const trashDirectory = join( options.contentDirectory, 'trash' );

                await mkdir( trashDirectory, { recursive: true } );

                // The trash ignores itself: git never sees deleted
                // binaries, and git status stays quiet.
                try
                {
                    await writeFile( join( trashDirectory, '.gitignore' ), '*\n', { flag: 'wx' } );
                }
                catch { /* already there */ }

                try
                {
                    await unlink( join( trashDirectory, name ) );
                }
                catch { /* nothing to displace */ }

                await rename( join( options.contentDirectory, 'media', name ), join( trashDirectory, name ) );
                jsonResponse( response, 200, { trashed: true } );
                return;
            }

            // The trash's own verbs: restore a file to media/, delete
            // one forever, or empty the whole thing. Permanent deletes
            // also drop the file's label - the metadata goes with it.
            if ( url.pathname === '/api/media-trash' && request.method === 'POST' )
            {
                const body = JSON.parse( await readBody( request ) ) as { file?: unknown; action?: unknown };
                const trashDirectory = join( options.contentDirectory, 'trash' );
                const name = typeof body.file === 'string' && /^[A-Za-z0-9._-]+$/.test( body.file ) ? body.file : undefined;

                const dropLabels = async ( dropped: string[] ): Promise<void> =>
                {
                    if ( dropped.length === 0 ) { return; }

                    const site = await readOwnedDocument( options.contentDirectory, 'site.json' );

                    if ( site === undefined ) { return; }

                    const labels = mediaLabelsOf( site );

                    if ( dropped.every( ( droppedName ) => labels[ droppedName ] === undefined ) ) { return; }

                    for ( const droppedName of dropped ) { delete labels[ droppedName ]; }

                    setMediaLabels( site, labels );
                    await writeOwnedDocument( options.contentDirectory, 'site.json', site as JsonValue );
                };

                if ( body.action === 'restore' && name !== undefined )
                {
                    await mkdir( join( options.contentDirectory, 'media' ), { recursive: true } );
                    await rename( join( trashDirectory, name ), join( options.contentDirectory, 'media', name ) );
                    jsonResponse( response, 200, { restored: true } );
                    return;
                }

                if ( body.action === 'delete' && name !== undefined )
                {
                    await unlink( join( trashDirectory, name ) );
                    await dropLabels( [ name ] );
                    jsonResponse( response, 200, { deleted: true } );
                    return;
                }

                if ( body.action === 'empty' )
                {
                    let trashNames: string[] = [];

                    try { trashNames = ( await readdir( trashDirectory ) ).filter( ( candidate ) => candidate !== '.gitignore' ); }
                    catch { /* nothing to empty */ }

                    for ( const trashName of trashNames )
                    {
                        await unlink( join( trashDirectory, trashName ) );
                    }

                    await dropLabels( trashNames );
                    jsonResponse( response, 200, { emptied: trashNames.length } );
                    return;
                }

                jsonResponse( response, 400, { error: 'A trash action is restore, delete, or empty.' } );
                return;
            }

            if ( url.pathname === '/api/site-meta' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { use?: unknown; name?: unknown };

                if ( body.use === undefined && body.name === undefined )
                {
                    jsonResponse( response, 400, { error: 'A site-meta patch carries "use" or "name".' } );
                    return;
                }

                if ( body.use !== undefined && body.use !== 'personal' && body.use !== 'commercial' )
                {
                    jsonResponse( response, 400, { error: '"use" is "personal" or "commercial".' } );
                    return;
                }

                const siteFile = join( options.contentDirectory, 'site.json' );
                const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

                if ( body.use !== undefined ) { raw.use = body.use; }

                // The display name: a real string sets it, an empty
                // one returns the site to its folder-derived name.
                if ( typeof body.name === 'string' )
                {
                    if ( body.name.trim() === '' ) { delete raw.name; }
                    else { raw.name = body.name.trim(); }
                }
                await withJournalLock( async () =>
                {
                    await journalSnapshot( options.contentDirectory );
                    await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
                    await journalSnapshot( options.contentDirectory );
                } );
                jsonResponse( response, 200, { saved: true } );
                return;
            }

            // The backup remote, revisitable like at init. Push never
            // blocks publish, so a wrong URL surfaces as "local only",
            // never as an error wall.
            if ( url.pathname === '/api/remote' && request.method === 'PUT' )
            {
                const body = JSON.parse( await readBody( request ) ) as { url?: unknown };
                const directory = options.contentDirectory;

                if ( typeof body.url !== 'string' )
                {
                    jsonResponse( response, 400, { error: '"url" is the remote address, or empty to disconnect.' } );
                    return;
                }

                const existing = await runGit( directory, [ 'remote', 'get-url', 'origin' ] );

                if ( body.url.trim() === '' )
                {
                    if ( existing.code === 0 ) { await runGit( directory, [ 'remote', 'remove', 'origin' ] ); }
                }
                else if ( existing.code === 0 )
                {
                    await runGit( directory, [ 'remote', 'set-url', 'origin', body.url.trim() ] );
                }
                else
                {
                    await runGit( directory, [ 'remote', 'add', 'origin', body.url.trim() ] );
                }

                jsonResponse( response, 200, { saved: true } );
                return;
            }

            if ( url.pathname === '/api/events' )
            {
                response.writeHead( 200, {
                    'content-type': 'text/event-stream',
                    'cache-control': 'no-cache',
                    'connection': 'keep-alive',
                } );
                response.write( ': connected\n\n' );
                eventStreams.add( response );
                request.on( 'close', () => eventStreams.delete( response ) );
                return;
            }

            // /canvas/<slug> is the EDITING surface (markers + bridge,
            // internal to the chrome's iframe).
            if ( url.pathname === '/canvas' || url.pathname.startsWith( '/canvas/' ) )
            {
                const slug = decodeURIComponent( url.pathname.slice( '/canvas/'.length ) ).replace( /\/+$/, '' );

                await servePreview( pipeline, slug === '' ? 'home' : slug, response, true );
                return;
            }

            // /preview/<address> is the HUMAN route (Mikey): the
            // visitor's view, resolving full site addresses - nested
            // pages, entries, term pages - with internal links
            // rewritten to stay inside the preview.
            if ( url.pathname === '/preview' || url.pathname.startsWith( '/preview/' ) )
            {
                const address = decodeURIComponent( url.pathname.slice( '/preview'.length ) );
                const rendered = await pipeline.renderAddress( address );
                const previewLinks = ( html: string ): string => html.replace(
                    /(<a\s[^>]*href=")\/(?!\/)/g,
                    '$1/preview/',
                );

                if ( rendered.html !== undefined )
                {
                    response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } );
                    response.end( previewLinks( rendered.html ) );
                    return;
                }

                // Nothing at that address: the visitor sees the
                // user-authored 404 page when one exists, exactly as
                // hosting will serve /404.html - with a real 404
                // status either way (Mikey: handle 404s better).
                const isMiss = rendered.issues.length === 1 && /Nothing is published/.test( rendered.issues[ 0 ]?.message ?? '' );

                if ( isMiss )
                {
                    const notFound = await pipeline.renderNotFound( false );

                    if ( notFound.html !== undefined )
                    {
                        response.writeHead( 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } );
                        response.end( previewLinks( notFound.html ) );
                        return;
                    }

                    response.writeHead( 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } );
                    response.end( `<!doctype html>\n<meta charset="utf-8">\n<title>Not found</title>\n<div style="font-family: system-ui; margin: 3rem; max-width: 40rem;">\n    <p><strong>Nothing is published at ${escapeHtmlText( address )}.</strong></p>\n    <p>This is the preview's plain 404. Author a 404 page under Site settings → Structure and visitors will see that instead.</p>\n</div>` );
                    return;
                }

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } );
                response.end( issuesPreviewPage( rendered.issues ) );
                return;
            }

            // A diverged entry's editing canvas (SCHEMA 13.4).
            if ( url.pathname.startsWith( '/canvas-entry/' ) )
            {
                const stem = decodeURIComponent( url.pathname.slice( '/canvas-entry/'.length ) ).replace( /\/+$/, '' );
                const entryId = url.searchParams.get( 'entry' ) ?? '';

                if ( !/^[a-z0-9-]+$/.test( stem ) || entryId === '' )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such entry layout.' );
                    return;
                }

                const rendered = await pipeline.renderEntryLayout( stem, entryId, true );
                const html = rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            // The 404 page's editing canvas (a full page, not a
            // partial: visitors meet it as a real page).
            if ( url.pathname === '/preview-404' || url.pathname === '/preview-404/' )
            {
                const rendered = await pipeline.renderNotFound( true );
                const html = rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            // The entry's rendered page, pure: the template through
            // this entry's data, no markers and no bridge - what a
            // visitor would see.
            if ( url.pathname.startsWith( '/preview-entry/' ) )
            {
                const stem = decodeURIComponent( url.pathname.slice( '/preview-entry/'.length ) ).replace( /\/+$/, '' );

                if ( !/^[a-z0-9-]+$/.test( stem ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such collection.' );
                    return;
                }

                const rendered = await pipeline.renderCollectionSurface( stem, 'template', false, url.searchParams.get( 'entry' ) ?? undefined );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( rendered.html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            // A component's ghost preview for the picker card: the
            // first example, rendered pure and chrome-free.
            if ( url.pathname.startsWith( '/preview-component/' ) )
            {
                const reference = decodeURIComponent( url.pathname.slice( '/preview-component/'.length ) ).replace( /\/+$/, '' );

                if ( !/^[@A-Za-z0-9/_.-]+$/.test( reference ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such component.' );
                    return;
                }

                const rendered = await pipeline.renderComponentSample( reference );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( rendered.html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            // The region canvas (SCHEMA 12.5).
            if ( url.pathname.startsWith( '/preview-region/' ) )
            {
                const region = decodeURIComponent( url.pathname.slice( '/preview-region/'.length ) ).replace( /\/+$/, '' );

                if ( !/^[a-z][a-z0-9-]*$/.test( region ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such region.' );
                    return;
                }

                const rendered = await pipeline.renderRegion( region );
                const html = rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            if ( url.pathname.startsWith( '/preview-tax-index/' ) || url.pathname.startsWith( '/preview-tax-template/' ) )
            {
                const surface = url.pathname.startsWith( '/preview-tax-index/' ) ? 'index' : 'template';
                const stem = decodeURIComponent( url.pathname.slice( `/preview-tax-${surface}/`.length ) ).replace( /\/+$/, '' );

                if ( !/^[a-z0-9-]+$/.test( stem ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such taxonomy.' );
                    return;
                }

                const rendered = await pipeline.renderTaxonomySurface( stem, surface, true, url.searchParams.get( 'term' ) ?? undefined );
                const html = rendered.html?.replace( '</body>', '<script type="module" src="/preview-bridge.js"></script>\n</body>' );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            // The term's rendered page, pure - the visitor's view.
            if ( url.pathname.startsWith( '/preview-term/' ) )
            {
                const stem = decodeURIComponent( url.pathname.slice( '/preview-term/'.length ) ).replace( /\/+$/, '' );

                if ( !/^[a-z0-9-]+$/.test( stem ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such taxonomy.' );
                    return;
                }

                const rendered = await pipeline.renderTaxonomySurface( stem, 'template', false, url.searchParams.get( 'term' ) ?? undefined );

                response.writeHead( 200, { 'content-type': 'text/html; charset=utf-8' } );
                response.end( rendered.html ?? issuesPreviewPage( rendered.issues ) );
                return;
            }

            if ( url.pathname.startsWith( '/preview-index/' ) || url.pathname.startsWith( '/preview-template/' ) )
            {
                const surface = url.pathname.startsWith( '/preview-index/' ) ? 'index' : 'template';
                const stem = decodeURIComponent( url.pathname.slice( `/preview-${surface}/`.length ) ).replace( /\/+$/, '' );

                if ( !/^[a-z0-9-]+$/.test( stem ) )
                {
                    response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                    response.end( 'No such collection.' );
                    return;
                }

                await serveCollectionPreview( pipeline, stem, surface, response, url.searchParams.get( 'entry' ) ?? undefined );
                return;
            }

            if ( url.pathname === '/api/save' && request.method === 'POST' )
            {
                await saveVersion( options, response );
                return;
            }

            if ( url.pathname === '/api/publish' && request.method === 'POST' )
            {
                await publishVersion( options, response );
                return;
            }

            // Discard returns the working tree to the last save - every
            // owned content file, including removing files created since
            // - and journals the result, so a discard is itself undoable.
            if ( url.pathname === '/api/discard' && request.method === 'POST' )
            {
                const restored = await withJournalLock( async () =>
                {
                    const directory = options.contentDirectory;
                    const headList = await runGit( directory, [ 'ls-tree', '--name-only', 'HEAD' ] );

                    if ( headList.code !== 0 ) { return false; }

                    const inHead: string[] = [];

                    for ( const name of headList.stdout.split( '\n' ).filter( ( line ) => line.endsWith( '.json' ) ) )
                    {
                        if ( name === 'site.json' || name === 'pages.json' )
                        {
                            inHead.push( name );
                            continue;
                        }

                        const blob = await runGit( directory, [ 'show', `HEAD:${name}` ] );

                        try
                        {
                            const value = JSON.parse( blob.stdout ) as Record<string, unknown> | null;

                            if ( value !== null && typeof value === 'object' && value.casomerSchema === 1 ) { inHead.push( name ); }
                        }
                        catch { /* foreign or unparsable files stay untouched */ }
                    }

                    const result = await runGit( directory, [ 'restore', '--worktree', '--source', 'HEAD', '--', ...inHead ] );

                    if ( result.code !== 0 ) { return false; }

                    for ( const name of await ownedContentFiles( directory ) )
                    {
                        if ( !inHead.includes( name ) ) { await unlink( join( directory, name ) ); }
                    }

                    await journalSnapshot( directory );
                    return true;
                } );

                response.writeHead( restored ? 200 : 409, { 'content-type': 'application/json; charset=utf-8' } );
                response.end( JSON.stringify( restored ? { discarded: true } : { error: 'There is no saved version to return to.' } ) );
                return;
            }

            if ( ( url.pathname === '/api/undo' || url.pathname === '/api/redo' ) && request.method === 'POST' )
            {
                const step = await withJournalLock( () => ( url.pathname === '/api/undo'
                    ? journalUndo( options.contentDirectory )
                    : journalRedo( options.contentDirectory ) ) );

                response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );
                response.end( JSON.stringify( step ) );
                return;
            }

            if ( url.pathname === '/assets/css/main.css' )
            {
                const css = await pipeline.themeCss();

                response.writeHead( 200, { 'content-type': 'text/css; charset=utf-8' } );
                response.end( css );
                return;
            }

            if ( url.pathname === '/assets/js/alpine.min.js' )
            {
                await serveFile( pipeline.alpineFile(), response );
                return;
            }

            if ( url.pathname === '/assets/js/casomer-runtime.js' )
            {
                await serveFile( pipeline.runtimeFile(), response );
                return;
            }

            const vendorFile = vendorFiles[ url.pathname ];

            if ( vendorFile !== undefined )
            {
                await serveFile( vendorFile(), response );
                return;
            }

            // Self-hosted fonts preview straight from the content
            // directory, exactly as the build ships them.
            if ( url.pathname.startsWith( '/fonts/' ) )
            {
                const file = resolveWithin( join( options.contentDirectory, 'fonts' ), decodeURIComponent( url.pathname.slice( '/fonts'.length ) ) );

                if ( file !== undefined )
                {
                    try
                    {
                        await serveFile( file, response );
                        return;
                    }
                    catch { /* fall through to the 404 below */ }
                }

                response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                response.end( 'Not found.' );
                return;
            }

            // Trashed media thumbnails - Studio-only, never emitted,
            // never staged (SCHEMA 13.4: the trash model).
            if ( url.pathname.startsWith( '/trash/' ) )
            {
                const file = resolveWithin( join( options.contentDirectory, 'trash' ), decodeURIComponent( url.pathname.slice( '/trash'.length ) ) );

                if ( file !== undefined )
                {
                    try
                    {
                        await serveFile( file, response );
                        return;
                    }
                    catch { /* fall through to the 404 below */ }
                }

                response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                response.end( 'Not found.' );
                return;
            }

            // Site media previews straight from the content directory;
            // ingest and build-time copying are SCHEMA section 13.4 work.
            if ( url.pathname.startsWith( '/media/' ) )
            {
                const file = resolveWithin( join( options.contentDirectory, 'media' ), decodeURIComponent( url.pathname.slice( '/media'.length ) ) );

                if ( file !== undefined )
                {
                    try
                    {
                        await serveFile( file, response );
                        return;
                    }
                    catch { /* fall through to the 404 below */ }
                }

                response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
                response.end( 'Not found.' );
                return;
            }

            await serveAsset( options.assetsDirectory, decodeURIComponent( url.pathname ), response );
        } )().catch( () =>
        {
            response.writeHead( 500, { 'content-type': 'text/plain; charset=utf-8' } );
            response.end( 'Studio hit an unexpected error serving this request.' );
        } );
    } );

    return new Promise( ( resolve, reject ) =>
    {
        server.once( 'error', reject );
        server.listen( port, host, () =>
        {
            const address = server.address();
            const boundPort = typeof address === 'object' && address !== null ? address.port : port;

            resolve( {
                url: `http://${host}:${boundPort}/?t=${token}`,
                port: boundPort,
                token,
                close: () => new Promise( ( closed ) =>
                {
                    watcher?.close();
                    clearTimeout( changeTimer );

                    for ( const stream of eventStreams ) { stream.end(); }

                    eventStreams.clear();
                    server.close( () => closed() );
                } ),
            } );
        } );
    } );
}
