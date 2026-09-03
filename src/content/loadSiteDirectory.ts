// Loading a site's content directory: the multi-file breakout of SCHEMA
// section 13.1, validated end to end. Every document must already be in
// canonical form (appendix B) so that a save which changes nothing
// produces an empty diff; ids are globally unique UUIDs (13.2); block
// component references must resolve against core or the installed
// packages; and spacing tokens and breakpoint names used by layout must
// exist in the theme (sections 11.6 and 12.1).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { suggestNearest } from '../schema/fields.ts';
import { parseComponentReference, type SchemaIssue } from '../schema/manifest.ts';
import { type LoadedPackage } from '../schema/loadPackage.ts';

export interface LoadedPage
{
    readonly id: string;
    readonly title: string;
    readonly slug: string;
    readonly blocks: readonly unknown[];

    // A draft page persists and edits normally but is omitted from
    // the build and the pure preview.
    readonly draft?: boolean;

    // The URL tree (SCHEMA 13.6): a child page nests its URL under
    // its parent's. Home is the root and never carries one.
    readonly parent?: string;

    // The page template (SCHEMA 12.6): a name from site.templates, or
    // the page's own inline template ("Custom"). Absent means default.
    readonly template?: string | PageTemplate;
}
import { serializeCanonicalJson, type JsonValue } from './canonicalJson.ts';
import { analyzeBlocks, type BlocksAnalysis } from './blocks.ts';
import { validatePageTemplate, validateSiteConfig, type MenuItem, type PageTemplate, type SiteConfig } from './siteConfig.ts';
import { loadContentDocuments, type LoadedCollection, type LoadedTaxonomy } from './contentDocuments.ts';

// The core roster of SCHEMA section 1.1: this small because layout is
// not a component concern, and admission is conservative because it is
// forever.
const coreComponentIds = [ 'markdown', 'image', 'link', 'heading' ];

// A content slot belongs to a page template's main layout and
// nowhere else (SCHEMA 12.6): a page, a partial, a collection surface,
// or the 404 holding one is a mistake, not an empty.
function checkNoSlots ( analysis: BlocksAnalysis, issues: SchemaIssue[] ): void
{
    for ( const path of analysis.slots )
    {
        issues.push( { path, message: 'A content slot belongs in a page template\'s main layout (SCHEMA 12.6), not here.' } );
    }
}

function templateParts ( template: PageTemplate ): [ string, readonly unknown[] ][]
{
    return [
        ...( template.header === undefined ? [] : [ [ 'header', template.header ] as [ string, readonly unknown[] ] ] ),
        [ 'blocks', template.blocks ],
        ...( template.footer === undefined ? [] : [ [ 'footer', template.footer ] as [ string, readonly unknown[] ] ] ),
    ];
}

// The 404 page (SCHEMA 13.6, decided 2026-09-02): a reserved page,
// slug "404", present on every site. A pages.json without one gets it
// synthesized under this id - carrying an older site.notFound's
// blocks - and Studio writes it into pages.json on first touch.
export const NOT_FOUND_PAGE_ID = '00000000-0000-4000-8000-000000000404';
export const NOT_FOUND_SLUG = '404';

const pagesFileKeys = [ 'casomerSchema', 'pages' ];
const pageKeys = [ 'id', 'title', 'slug', 'blocks', 'draft', 'parent', 'template' ];
const templateNameShape = /^[a-z][a-z0-9-]*$/;

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pageSlugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SiteLoadResult
{
    readonly config: SiteConfig;
    readonly pageCount: number;
    readonly pages: readonly LoadedPage[];
    readonly collections: readonly LoadedCollection[];
    readonly taxonomies: readonly LoadedTaxonomy[];
    readonly issues: readonly SchemaIssue[];
}

interface LoadedDocument
{
    readonly value: JsonValue;
}

async function readCanonicalDocument (
    file: string,
    label: string,
    issues: SchemaIssue[],
): Promise<LoadedDocument | undefined>
{
    let text: string;

    try
    {
        text = await readFile( file, 'utf8' );
    }
    catch
    {
        issues.push( { path: label, message: `${label} is missing or unreadable.` } );
        return undefined;
    }

    let value: JsonValue;

    try
    {
        value = JSON.parse( text ) as JsonValue;
    }
    catch ( error )
    {
        issues.push( { path: label, message: `${label} is not valid JSON: ${( error as Error ).message}.` } );
        return undefined;
    }

    if ( serializeCanonicalJson( value ) !== text )
    {
        issues.push( {
            path: label,
            message: `${label} is not in canonical form (appendix B: four-space indent, LF, trailing newline, stable order). A Casomer save will normalize it.`,
        } );
    }

    return { value };
}

function checkReferences (
    analysis: BlocksAnalysis,
    packages: readonly LoadedPackage[],
    issues: SchemaIssue[],
): void
{
    for ( const { reference, path } of analysis.references )
    {
        const { packageName, componentId } = parseComponentReference( reference );

        if ( packageName === 'core' )
        {
            if ( !coreComponentIds.includes( componentId ) )
            {
                issues.push( {
                    path,
                    message: `There is no core component "${componentId}".${suggestNearest( componentId, coreComponentIds )} Core is deliberately small: ${coreComponentIds.map( ( id ) => `core/${id}` ).join( ', ' )}.`,
                } );
            }

            continue;
        }

        const installed = packages.find( ( candidate ) => candidate.manifest.name === packageName );

        if ( installed === undefined )
        {
            issues.push( { path, message: `The package "${packageName}" is not installed.` } );
            continue;
        }

        if ( !installed.components.has( componentId ) )
        {
            issues.push( {
                path,
                message: `The package "${packageName}" has no component "${componentId}".${suggestNearest( componentId, [ ...installed.components.keys() ] )}`,
            } );
        }
    }
}

function checkSpacingTokens ( analysis: BlocksAnalysis, config: SiteConfig, issues: SchemaIssue[] ): void
{
    const { spacingTokens, breakpointNames } = config.theme;
    const validBreakpointKeys = [ 'base', ...breakpointNames ];

    const checkToken = ( token: string, path: string ): void =>
    {
        if ( !spacingTokens.includes( token ) )
        {
            issues.push( {
                path,
                message: `"${token}" is not a spacing token.${suggestNearest( token, spacingTokens )} Spacing draws from theme.spacing (${spacingTokens.join( ', ' )}); raw CSS values never appear in layout.`,
            } );
        }
    };

    for ( const { value, path } of analysis.spacingValues )
    {
        if ( typeof value === 'string' )
        {
            checkToken( value, path );
            continue;
        }

        for ( const [ breakpoint, token ] of Object.entries( value ) )
        {
            if ( !validBreakpointKeys.includes( breakpoint ) )
            {
                issues.push( {
                    path: `${path}.${breakpoint}`,
                    message: `"${breakpoint}" is not a theme breakpoint.${suggestNearest( breakpoint, validBreakpointKeys )} Responsive maps use "base" plus the names in theme.breakpoints.`,
                } );
            }

            checkToken( token, `${path}.${breakpoint}` );
        }
    }
}

export async function loadSiteDirectory (
    contentDirectory: string,
    packages: readonly LoadedPackage[] = [],
): Promise<SiteLoadResult>
{
    const issues: SchemaIssue[] = [];
    const seenIds = new Map<string, string>();
    const repeatSources: { collection: string; path: string }[] = [];

    const siteDocument = await readCanonicalDocument( join( contentDirectory, 'site.json' ), 'site.json', issues );
    const config = validateSiteConfig( siteDocument?.value, issues );

    const pagesDocument = await readCanonicalDocument( join( contentDirectory, 'pages.json' ), 'pages.json', issues );
    let pageCount = 0;
    const pages: LoadedPage[] = [];

    if ( pagesDocument !== undefined )
    {
        let pageList: readonly unknown[] | undefined;

        if ( pagesDocument.value === null || typeof pagesDocument.value !== 'object' || Array.isArray( pagesDocument.value ) )
        {
            issues.push( { path: 'pages.json', message: 'pages.json is an object: { "casomerSchema": 1, "pages": [ ... ] }.' } );
        }
        else
        {
            const pagesRecord = pagesDocument.value as Record<string, unknown>;

            for ( const key of Object.keys( pagesRecord ) )
            {
                if ( !pagesFileKeys.includes( key ) )
                {
                    issues.push( { path: `pages.${key}`, message: `Unknown key "${key}".${suggestNearest( key, pagesFileKeys )}` } );
                }
            }

            if ( pagesRecord.casomerSchema !== 1 )
            {
                issues.push( {
                    path: 'pages.casomerSchema',
                    message: `Every Casomer file carries "casomerSchema": 1 (SCHEMA section 13.1); got ${JSON.stringify( pagesRecord.casomerSchema )}. A newer schema needs a newer Casomer.`,
                } );
            }

            if ( !Array.isArray( pagesRecord.pages ) )
            {
                issues.push( { path: 'pages.pages', message: '"pages" is an array of pages.' } );
            }
            else { pageList = pagesRecord.pages; }
        }

        if ( pageList !== undefined )
        {
            const seenSlugs = new Map<string, string>();

            for ( const [ index, rawPage ] of pageList.entries() )
            {
                const pagePath = `pages[${index}]`;

                if ( rawPage === null || typeof rawPage !== 'object' || Array.isArray( rawPage ) )
                {
                    issues.push( { path: pagePath, message: 'A page is an object with id, title, slug, and blocks.' } );
                    continue;
                }

                pageCount += 1;
                const page = rawPage as Record<string, unknown>;

                // The page's template (SCHEMA 12.6): a name checked
                // against the site's templates with did-you-mean, or
                // an inline template validated like a site one.
                let template: string | PageTemplate | undefined;

                if ( typeof page.template === 'string' )
                {
                    if ( !templateNameShape.test( page.template ) || config.templates[ page.template ] === undefined )
                    {
                        issues.push( { path: `${pagePath}.template`, message: `There is no page template "${page.template}".${suggestNearest( page.template, Object.keys( config.templates ) )} A page names one of site.templates, or leaves the key out for the default.` } );
                    }
                    else { template = page.template; }
                }
                else if ( page.template !== undefined )
                {
                    template = validatePageTemplate( page.template, `${pagePath}.template`, issues );
                }

                // The reserved 404 page is never a draft and never in
                // the tree: an address that does not exist is what it
                // answers, so it has none of its own.
                if ( page.slug === NOT_FOUND_SLUG && page.draft === true )
                {
                    issues.push( { path: `${pagePath}.draft`, message: 'The 404 page cannot be a draft: it is served whenever an address does not exist.' } );
                }

                pages.push( {
                    id: String( page.id ?? '' ),
                    title: String( page.title ?? '' ),
                    slug: String( page.slug ?? '' ),
                    blocks: Array.isArray( page.blocks ) ? page.blocks : [],
                    ...( page.draft === true && page.slug !== NOT_FOUND_SLUG ? { draft: true } : {} ),
                    ...( typeof page.parent === 'string' ? { parent: page.parent } : {} ),
                    ...( template === undefined ? {} : { template } ),
                } );

                for ( const key of Object.keys( page ) )
                {
                    if ( !pageKeys.includes( key ) )
                    {
                        issues.push( { path: `${pagePath}.${key}`, message: `Unknown page key "${key}".${suggestNearest( key, pageKeys )}` } );
                    }
                }

                if ( typeof page.id !== 'string' || !uuidShape.test( page.id ) )
                {
                    issues.push( { path: `${pagePath}.id`, message: 'Every object carries a UUID id, auto-generated on creation (SCHEMA section 13.2).' } );
                }
                else if ( seenIds.has( page.id ) )
                {
                    issues.push( { path: `${pagePath}.id`, message: `Duplicate id "${page.id}" (also at ${seenIds.get( page.id )}). Ids are globally unique; the reference system depends on it.` } );
                }
                else { seenIds.set( page.id, pagePath ); }

                if ( typeof page.title !== 'string' || page.title.length === 0 )
                {
                    issues.push( { path: `${pagePath}.title`, message: 'A page needs a title: it is the designated h1 (SCHEMA section 8).' } );
                }

                if ( typeof page.slug !== 'string' || !pageSlugShape.test( page.slug ) )
                {
                    issues.push( { path: `${pagePath}.slug`, message: 'A page slug is lowercase words joined by hyphens; UUIDs are plumbing, slugs are the public spelling.' } );
                }
                else if ( seenSlugs.has( page.slug ) )
                {
                    issues.push( { path: `${pagePath}.slug`, message: `Duplicate slug "${page.slug}" (also at ${seenSlugs.get( page.slug )}).` } );
                }
                else { seenSlugs.set( page.slug, pagePath ); }

                const analysis = analyzeBlocks( page.blocks, `${pagePath}.blocks`, issues );

                checkReferences( analysis, packages, issues );
                checkSpacingTokens( analysis, config, issues );
                checkNoSlots( analysis, issues );
                repeatSources.push( ...analysis.repeatSources );

                // A page-owned template gets the layout scrutiny of a
                // site one, under the page's path.
                if ( template !== undefined && typeof template !== 'string' )
                {
                    for ( const [ part, list ] of templateParts( template ) )
                    {
                        const partAnalysis = analyzeBlocks( list, `${pagePath}.template.${part}`, issues );

                        checkReferences( partAnalysis, packages, issues );
                        checkSpacingTokens( partAnalysis, config, issues );
                        repeatSources.push( ...partAnalysis.repeatSources );
                    }
                }
            }
        }
    }

    // Every site has a 404 page: absent from pages.json, it is
    // synthesized last, carrying the retired site.notFound blocks.
    if ( !pages.some( ( page ) => page.slug === NOT_FOUND_SLUG ) )
    {
        // Counted as a page of the site once it is written; the count
        // speaks the file (the golden fixture pins it).
        pages.push( { id: NOT_FOUND_PAGE_ID, title: 'Not found', slug: NOT_FOUND_SLUG, blocks: config.notFound ?? [] } );
    }

    // The URL tree's page rules (SCHEMA 13.6): a parent names an
    // existing page, home neither takes nor grants one, and the chain
    // never loops. The 404 page is outside the tree on both sides.
    const pageById = new Map( pages.map( ( page ) => [ page.id, page ] ) );

    for ( const [ index, page ] of pages.entries() )
    {
        if ( page.parent === undefined ) { continue; }

        const parentPath = `pages[${index}].parent`;

        if ( page.slug === NOT_FOUND_SLUG )
        {
            issues.push( { path: parentPath, message: 'The 404 page has no address of its own; it takes no parent (SCHEMA 13.6).' } );
            continue;
        }

        if ( page.slug === 'home' )
        {
            issues.push( { path: parentPath, message: 'Home is the root of the URL tree; it takes no parent (SCHEMA 13.6).' } );
            continue;
        }

        const parentPage = pageById.get( page.parent );

        if ( parentPage === undefined )
        {
            issues.push( { path: parentPath, message: `"parent" names no page. A page's parent is another page's id (SCHEMA 13.6).` } );
            continue;
        }

        if ( parentPage.slug === NOT_FOUND_SLUG )
        {
            issues.push( { path: parentPath, message: 'The 404 page has no address, so nothing can nest under it (SCHEMA 13.6).' } );
            continue;
        }

        if ( parentPage.slug === 'home' )
        {
            issues.push( { path: parentPath, message: 'Home is the root, not a node: its children would just be top-level pages (SCHEMA 13.6).' } );
            continue;
        }

        const visited = new Set<string>( [ page.id ] );
        let ancestor: LoadedPage | undefined = parentPage;

        while ( ancestor !== undefined )
        {
            if ( visited.has( ancestor.id ) )
            {
                issues.push( { path: parentPath, message: 'Page parents form a loop; the URL tree is a tree (SCHEMA 13.6).' } );
                break;
            }

            visited.add( ancestor.id );
            ancestor = ancestor.parent === undefined ? undefined : pageById.get( ancestor.parent );
        }
    }

    // The self-describing content files: collections and taxonomies
    // (SCHEMA section 13.1), sharing the pages' global id space.
    const documents = await loadContentDocuments( contentDirectory, issues, seenIds );

    // Collection-held layouts get the same block scrutiny as pages:
    // the entry template, the index page, and any diverged entries.
    const checkLayout = ( blocks: unknown, path: string, slotsAllowed = false ): void =>
    {
        const analysis = analyzeBlocks( blocks, path, issues );

        checkReferences( analysis, packages, issues );
        checkSpacingTokens( analysis, config, issues );
        repeatSources.push( ...analysis.repeatSources );

        if ( !slotsAllowed ) { checkNoSlots( analysis, issues ); }
    };

    // A mounted collection's parent must be a real, mountable page
    // (SCHEMA 13.6): existing, and never home - the root already is
    // where an unmounted collection lives.
    for ( const collection of documents.collections )
    {
        if ( collection.parent === undefined ) { continue; }

        const stem = collection.file.replace( /\.json$/, '' );
        const mountPage = pageById.get( collection.parent );

        if ( mountPage === undefined )
        {
            issues.push( { path: `${stem}.parent`, message: `"parent" names no page. A mounted collection nests under an existing page's URL (SCHEMA 13.6).` } );
        }
        else if ( mountPage.slug === 'home' )
        {
            issues.push( { path: `${stem}.parent`, message: 'Home is the root: an unmounted collection already lives there. Leave "parent" out (SCHEMA 13.6).' } );
        }
    }

    for ( const collection of documents.collections )
    {
        const stem = collection.file.replace( /\.json$/, '' );

        if ( collection.templateBlocks !== undefined ) { checkLayout( collection.templateBlocks, `${stem}.template.blocks` ); }
        if ( Array.isArray( collection.indexBlocks ) ) { checkLayout( collection.indexBlocks, `${stem}.index.blocks` ); }

        for ( const [ index, entry ] of collection.entries.entries() )
        {
            if ( entry.blocks !== undefined ) { checkLayout( entry.blocks, `${stem}.entries[${index}].blocks` ); }
        }
    }

    // Template blocks (SCHEMA 12.6) get the same scrutiny as page
    // blocks - same grammar, same components, same tokens - and the
    // main layout is the one place a content slot may sit (the slot
    // count itself is the config's check).
    for ( const [ name, template ] of Object.entries( config.templates ) )
    {
        for ( const [ part, list ] of templateParts( template ) )
        {
            checkLayout( list, `site.templates.${name}.${part}`, true );
        }
    }

    if ( config.notFound !== undefined ) { checkLayout( config.notFound, 'site.notFound' ); }

    for ( const [ partialName, partialBlocks ] of Object.entries( config.partials ?? {} ) )
    {
        checkLayout( partialBlocks, `site.partials.${partialName}` );
    }

    // Menu targets must exist: page ids, collection stems, taxonomy
    // stems - checked through every nesting level. A PRIVATE target
    // ("index": false) is a state, not a mistake: resolution omits
    // the item silently, like a draft, and no issue is raised.
    const menuCollectionStems = new Set( documents.collections.map( ( collection ) => collection.file.replace( /\.json$/, '' ) ) );
    const menuTaxonomyStems = new Set( documents.taxonomies.map( ( taxonomy ) => taxonomy.file.replace( /\.json$/, '' ) ) );
    const checkMenuItems = ( items: readonly MenuItem[], path: string ): void =>
    {
        for ( const [ index, item ] of items.entries() )
        {
            const itemPath = `${path}[${index}]`;

            // An AUTO item's dangling target is machine bookkeeping
            // (the page was deleted after materialization): resolution
            // drops it silently and Studio prunes the row - no issue.
            if ( item.page !== undefined && !pageById.has( item.page ) && item.auto === undefined )
            {
                issues.push( { path: `${itemPath}.page`, message: '"page" names no page. A page item carries an existing page id (SCHEMA 12.5).' } );
            }

            if ( item.collection !== undefined && !menuCollectionStems.has( item.collection ) && item.auto === undefined )
            {
                issues.push( { path: `${itemPath}.collection`, message: `"collection" names no collection. There is no ${item.collection}.json.` } );
            }

            if ( item.taxonomy !== undefined && !menuTaxonomyStems.has( item.taxonomy ) && item.auto === undefined )
            {
                issues.push( { path: `${itemPath}.taxonomy`, message: `"taxonomy" names no taxonomy. There is no ${item.taxonomy}.json.` } );
            }

            if ( item.items !== undefined ) { checkMenuItems( item.items, `${itemPath}.items` ); }
        }
    };

    for ( const [ menuName, menu ] of Object.entries( config.menus ?? {} ) )
    {
        checkMenuItems( menu.items, `site.menus.${menuName}.items` );
    }

    // Taxonomy-held layouts get the same block scrutiny.
    for ( const taxonomy of documents.taxonomies )
    {
        const stem = taxonomy.file.replace( /\.json$/, '' );

        if ( taxonomy.templateBlocks !== undefined ) { checkLayout( taxonomy.templateBlocks, `${stem}.template.blocks` ); }
        if ( Array.isArray( taxonomy.indexBlocks ) ) { checkLayout( taxonomy.indexBlocks, `${stem}.index.blocks` ); }
    }

    // A reference field targets a taxonomy ("reference |
    // taxonomy:venues") or another collection's entries ("reference |
    // type:venues") - SCHEMA 13.3; either way the target has to be a
    // file that actually loaded, and entry values are id strings.
    // Dangling ids are deliberately not fatal here - deletion cleanup
    // is an editor flow, and a stale assignment must never block a
    // build.
    const taxonomyStems = documents.taxonomies.map( ( taxonomy ) => taxonomy.file.replace( /\.json$/, '' ) );
    const referenceCollectionStems = documents.collections.map( ( collection ) => collection.file.replace( /\.json$/, '' ) );

    for ( const collection of documents.collections )
    {
        const stem = collection.file.replace( /\.json$/, '' );

        for ( const [ key, field ] of Object.entries( collection.fields ) )
        {
            if ( field.type !== 'reference' ) { continue; }

            const target = field.rules.taxonomy;
            const entryTarget = field.rules.type;

            if ( typeof target === 'string' && !taxonomyStems.includes( target ) )
            {
                issues.push( {
                    path: `${stem}.fields.${key}`,
                    message: `There is no taxonomy "${target}".${suggestNearest( target, taxonomyStems )} A reference names a taxonomy file by its stem.`,
                } );
            }

            if ( typeof entryTarget === 'string' && !referenceCollectionStems.includes( entryTarget ) )
            {
                issues.push( {
                    path: `${stem}.fields.${key}`,
                    message: `There is no collection "${entryTarget}".${suggestNearest( entryTarget, referenceCollectionStems )} An entry reference names a collection file by its stem.`,
                } );
            }

            for ( const [ index, entry ] of collection.entries.entries() )
            {
                const value = entry.values[ key ];

                if ( value !== undefined && value !== '' && typeof value !== 'string' )
                {
                    issues.push( {
                        path: `${stem}.entries[${index}].${key}`,
                        message: 'A reference value is a term id string.',
                    } );
                }
            }
        }
    }

    // A repeat's collection reference is a file stem; it has to name a
    // collection that actually loaded.
    const collectionStems = documents.collections.map( ( collection ) => collection.file.replace( /\.json$/, '' ) );

    for ( const { collection, path } of repeatSources )
    {
        if ( !collectionStems.includes( collection ) )
        {
            issues.push( {
                path,
                message: `There is no collection "${collection}".${suggestNearest( collection, collectionStems )} A repeat names a collection file by its stem.`,
            } );
        }
    }

    return { config, pageCount, pages, collections: documents.collections, taxonomies: documents.taxonomies, issues };
}
