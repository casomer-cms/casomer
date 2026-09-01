// The page assembler: SCHEMA section 11's blocks-and-sections grammar
// rendered to HTML, with the section 8 heading resolver working across
// the whole page and the section 7 accessibility scaffolding emitted
// around it. The chain per component is resolver -> markdown -> template;
// the assembler owns everything between components: layout classes from
// design tokens, heading scopes, hidden-block omission, and landmarks.
//
// Heading mechanics: markdown fields compile at base level 1, template
// headings keep their authored numbers, and both are treated as ranks
// relative to the component. Each top-level block is a heading scope
// (section 11.7); within a scope, the distinct heading levels present
// map onto consecutive real levels from h2 down, so a lead heading
// becomes h2 and repeated titled items beneath it become h3 - and the
// page's designated h1 is its title, emitted by the scaffolding, which
// is what makes the one-h1 rule structural.

import { readFile } from 'node:fs/promises';

import { type SchemaIssue } from '../schema/manifest.ts';
import { parseComponentReference } from '../schema/manifest.ts';
import { type LoadedComponent, type LoadedPackage } from '../schema/loadPackage.ts';
import { type NormalizedFields } from '../schema/fields.ts';
import { type SiteConfig } from '../content/siteConfig.ts';
import { type TokenValue } from '../content/blocks.ts';
import { missingRequiredFields, resolveRenderPayload, type RenderPayload } from '../resolver/resolvePayload.ts';
import { presentEntryValues, type PresentationDocs } from '../content/presentation.ts';
import { resolveBindings } from '../resolver/bindings.ts';
import { type LoadedCollection, type LoadedEntry, type LoadedTaxonomy, type LoadedTerm } from '../content/contentDocuments.ts';
import { entrySlug, type ResolvedMenuItem } from '../content/urlTree.ts';
import { evaluateExpression, parseExpression, type FieldValues } from '../schema/expressions.ts';
import { parseTemplate, renderTemplate, type TemplateNode } from './template.ts';
import { compileMarkdown } from './markdown.ts';

export interface PageInput
{
    readonly id: string;
    readonly title: string;
    readonly slug: string;
    readonly blocks: readonly unknown[];
}

export interface AssembleOptions
{
    readonly config: SiteConfig;
    readonly packages: readonly LoadedPackage[];
    readonly coreComponents: ReadonlyMap<string, LoadedComponent>;
    readonly generatorVersion?: string;

    // Asset URLs for the page head. The build passes content-hashed
    // names (DEVELOPMENT: cache busting is derived, never configured);
    // the defaults keep Studio's in-memory preview on stable paths.
    readonly assets?: {
        readonly stylesheet: string;
        readonly alpineScript: string;
        readonly runtimeScript: string;
    };

    // Studio's canvas stamps each top-level block with its index so
    // the editing bridge can select it (EDITOR section 2). Never set
    // by caso build: delivered output carries no editing markers.
    readonly blockMarkers?: boolean;

    // Repeat blocks (SCHEMA section 13.5) draw their items from the
    // site's collections; absent, a repeat renders empty with an issue.
    readonly collections?: readonly LoadedCollection[];

    // An entry page renders its collection's template with this entry
    // in scope: every { "$bind": "entry.x" } prop resolves against it.
    readonly entryScope?: Readonly<Record<string, unknown>>;

    // A term page renders its taxonomy's template with this term in
    // scope: { "$bind": "term.name" } and friends (SCHEMA 13.3, the
    // fixed term shape).
    readonly termScope?: Readonly<Record<string, unknown>>;

    // The term-scoped repeat's context: which taxonomy the page
    // belongs to and which term ids count as "current" (the term and
    // its descendants - a category page shows its subcategories'
    // content).
    readonly termContext?: {
        readonly taxonomyStem: string;
        readonly termIds: readonly string[];
    };

    // Menus, resolved by the caller (SCHEMA 12.5): nested
    // { label, url, items } trees the site.* bind scope and the menu
    // repeat source draw from. Resolution lives with the caller
    // because it needs the pages and the URL tree.
    readonly resolvedMenus?: Readonly<Record<string, readonly ResolvedMenuItem[]>>;

    // Taxonomies feed the taxonomy repeat source (SCHEMA 13.5): one
    // item per term, in term order, with the term page URL bound in
    // when term pages exist.
    readonly taxonomies?: readonly LoadedTaxonomy[];

    // Every public entry page's address by entry id (urlTree
    // resolveEntryUrls): the inherent entry.url the caller
    // precomputes, because addresses need the page tree.
    readonly entryUrls?: Readonly<Record<string, string>>;

    // Pagination (SCHEMA 13.5): on a paginated index, repeats
    // sourcing THIS collection show the window's slice, and the
    // compiler appends the pager - scaffolding, like the skip link.
    // "base" is the index's address with trailing slash.
    readonly pageWindow?: {
        readonly stem: string;
        readonly size: number;
        readonly number: number;
        readonly base: string;
    };

    // The page's own attributes, bindable (Mikey: the page name and
    // friends are linkable into field values): { "$bind":
    // "page.title" } is how the default heading speaks the title.
    readonly pageScope?: Readonly<Record<string, unknown>>;
}

export interface AssembledPage
{
    readonly html: string;
    readonly issues: readonly SchemaIssue[];

    // Set when a pageWindow rendered: how many pages the full
    // listing needs, so the caller can emit /page/2/ and beyond.
    readonly pagination?: { readonly totalPages: number };
}

function escapeHtml ( text: string ): string
{
    return text
        .replace( /&/g, '&amp;' )
        .replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' )
        .replace( /"/g, '&quot;' )
        .replace( /'/g, '&#39;' );
}

// A spacing value is a token or a breakpoint map over tokens; both
// become Tailwind-style utility classes against the generated theme.
function tokenClasses ( prefix: string, value: TokenValue | undefined ): string[]
{
    if ( value === undefined ) { return []; }

    if ( typeof value === 'string' ) { return [ `${prefix}-${value}` ]; }

    return Object.entries( value ).map(
        ( [ breakpoint, token ] ) =>
            ( breakpoint === 'base' ? `${prefix}-${token}` : `${breakpoint}:${prefix}-${token}` ),
    );
}

function classAttribute ( classes: readonly string[] ): string
{
    const joined = classes.filter( ( entry ) => entry !== '' ).join( ' ' );

    return joined === '' ? '' : ` class="${joined}"`;
}

// Markdown fields compile before the template sees them: the payload
// value becomes the compiled HTML, relative headings at base 1.
// Exported for the same reason renderComponentInstance is public: the
// Studio preview engine is this pass's second importer, and preview
// parity depends on there being exactly one implementation.
export function compileMarkdownFields ( fields: NormalizedFields, payload: RenderPayload ): RenderPayload
{
    const transformed: Record<string, unknown> = { ...payload };

    for ( const [ key, field ] of Object.entries( fields ) )
    {
        const value = transformed[ key ];

        if ( value === undefined ) { continue; }

        if ( field.type === 'markdown' && typeof value === 'string' )
        {
            transformed[ key ] = compileMarkdown( value, 1 ).html;
        }

        if ( field.type === 'list' && Array.isArray( value ) )
        {
            transformed[ key ] = value.map( ( item ) =>
                compileMarkdownFields( field.fields ?? {}, item as RenderPayload ) );
        }

        if ( field.type === 'group' && value !== null && typeof value === 'object' && !Array.isArray( value ) )
        {
            transformed[ key ] = compileMarkdownFields( field.fields ?? {}, value as RenderPayload );
        }
    }

    return transformed as RenderPayload;
}

const headingTagPattern = /<(\/?)h([1-6])(?=[\s>])/g;

function headingLevelsIn ( html: string ): number[]
{
    const levels = new Set<number>();

    for ( const match of html.matchAll( headingTagPattern ) )
    {
        if ( match[ 1 ] === '' ) { levels.add( Number( match[ 2 ] ) ); }
    }

    return [ ...levels ].sort( ( a, b ) => a - b );
}

// The positional guarantee (Mikey: "h3 before h2 is not semantic"):
// after every scope maps, a final walk in DOCUMENT ORDER clamps each
// heading to at most one deeper than the heading before it - the
// outline a rotor reads can step down one level at a time, never
// skip. Semantic only: the visual class (rule 7) rides untouched.
export function clampHeadingSequence ( html: string ): string
{
    let last = 0;
    let openLevel = 0;

    return html.replace( /<(\/?)h([1-6])(?=[\s>])/g, ( _match, closer: string, level: string ) =>
    {
        if ( closer === '/' ) { return `</h${openLevel === 0 ? level : openLevel}`; }

        const clamped = last === 0 ? Number( level ) : Math.min( Number( level ), last + 1 );

        last = clamped;
        openLevel = clamped;
        return `<h${clamped}`;
    } );
}

// Within a scope, distinct relative levels map onto consecutive real
// levels from the base down, capped at h6. Depth never comes from
// layout, only from the content's own declared subordination.
//
// Semantics and looks split when they disagree (Mikey, 2026-09-01):
// the OUTLINE gets the remapped level, the STYLING keeps the
// authored rank via a class alias - a lone "####" in markdown lands
// as <h2 class="h4">, structurally the block's lead heading,
// visually the small heading its author chose. The theme CSS styles
// .h1-.h6 beside the elements.
function remapHeadings ( html: string, baseLevel: number ): string
{
    const levels = headingLevelsIn( html );
    const mapping = new Map( levels.map( ( level, rank ) => [ level, Math.min( baseLevel + rank, 6 ) ] ) );

    return html
        .replace( /<h([1-6])((?:[^>"]|"[^"]*")*)>/g, ( _match, level: string, attributes: string ) =>
        {
            const real = mapping.get( Number( level ) ) ?? 6;

            // A visual rank already stamped upstream (the markdown
            // compiler records the author's depth) always wins; the
            // remap only changes the semantic level under it.
            if ( real === Number( level ) || /class="[^"]*\bh[1-6]\b/.test( attributes ) ) { return `<h${real}${attributes}>`; }

            const withClass = /\bclass="/.test( attributes )
                ? attributes.replace( /\bclass="/, `class="h${level} ` )
                : ` class="h${level}"${attributes}`;

            return `<h${real}${withClass}>`;
        } )
        .replace( /<\/h([1-6])>/g, ( _match, level: string ) => `</h${mapping.get( Number( level ) ) ?? 6}>` );
}

interface Assembler
{
    readonly options: AssembleOptions;
    readonly issues: SchemaIssue[];
    readonly templateCache: Map<string, readonly TemplateNode[]>;

    // Morph-link names used on this page (SCHEMA 6): each resolves
    // to view-transition-names, which must be unique per page.
    readonly morphNames: Map<string, string>;

    // Set by a repeat that applied the pageWindow (SCHEMA 13.5).
    pagination?: { total: number; totalPages: number };

    // Partials currently rendering, for the self-reference guard.
    readonly activePartials: Set<string>;
}

function findComponent ( assembler: Assembler, reference: string ): LoadedComponent | undefined
{
    const { packageName, componentId } = parseComponentReference( reference );

    if ( packageName === 'core' ) { return assembler.options.coreComponents.get( componentId ); }

    return assembler.options.packages
        .find( ( candidate ) => candidate.manifest.name === packageName )
        ?.components.get( componentId );
}

async function renderComponentBlock (
    assembler: Assembler,
    block: Record<string, unknown>,
    path: string,
): Promise<string>
{
    const reference = block.component as string;
    const component = findComponent( assembler, reference );

    if ( component === undefined )
    {
        assembler.issues.push( { path, message: `The component "${reference}" is not available to the build.` } );
        return '';
    }

    let props = ( block.props ?? {} ) as Record<string, unknown>;

    // site.* is always in scope (SCHEMA 12.5: menus feed components
    // through binding); entry.* and term.* join it on their surfaces.
    const scopes = {
        site: { menus: assembler.options.resolvedMenus ?? {} },
        ...( assembler.options.pageScope === undefined ? {} : { page: assembler.options.pageScope } ),
        ...( assembler.options.entryScope === undefined ? {} : { entry: assembler.options.entryScope } ),
        ...( assembler.options.termScope === undefined ? {} : { term: assembler.options.termScope } ),
    };

    props = resolveBindings( props, scopes ) as Record<string, unknown>;

    // Required props are enforced here, at build (the editor nags, the
    // draft never blocks, publish refuses): the preview still renders
    // - the issue rides along - and publish sees it and stops.
    for ( const problem of missingRequiredFields( component.manifest.fields, props ) )
    {
        assembler.issues.push( {
            path: `${path}.props.${problem.key}`,
            message: `"${problem.label}" is required and empty.`,
        } );
    }

    const html = await renderComponentInstance( component, props, assembler.templateCache );

    // Morph links (SCHEMA 6): the block's link name plus each
    // declared anchor id becomes the anchored element's
    // view-transition-name - the SAME name on another page's block
    // pairs the two for the navigation morph. Names are unique per
    // page; a duplicate reports and does not stamp, so the build
    // never emits colliding transition names.
    const morph = block.morph;

    if ( typeof morph !== 'string' || morph === '' ) { return html; }

    const priorPath = assembler.morphNames.get( morph );

    if ( priorPath !== undefined )
    {
        assembler.issues.push( {
            path: `${path}.morph`,
            message: `The morph link "${morph}" is already used at ${priorPath} on this page; view-transition names must be unique per page.`,
        } );
        return html;
    }

    assembler.morphNames.set( morph, path );

    return html.replace( /<([a-z][a-z0-9-]*)((?:[^>"]|"[^"]*")*\bdata-anchor="([^"]+)"(?:[^>"]|"[^"]*")*)>/g, ( _match, tag: string, attributes: string, anchorId: string ) =>
    {
        const name = `view-transition-name: ${morph}-${anchorId}`;
        const withStyle = /\bstyle="/.test( attributes )
            ? attributes.replace( /\bstyle="/, `style="${name}; ` )
            : `${attributes} style="${name}"`;

        return `<${tag}${withStyle}>`;
    } );
}

// The entry scope $bind paths resolve against: the field values plus
// the id, so "entry.title" and "entry.id" both work. Given the
// entry's field definitions and the site's documents, values PRESENT
// (SCHEMA 13.5): dates speak their field's format, references speak
// their target's name. Ordering never sees this scope - it compares
// the raw stored values, or September would sort after April.
export function entryScopeOf (
    entry: LoadedEntry,
    fields?: NormalizedFields,
    docs?: PresentationDocs,
): Record<string, unknown>
{
    const values = fields === undefined ? entry.values : presentEntryValues( entry.values, fields, docs ?? {} );

    return { id: entry.id, ...values };
}

// The term scope: the fixed shape, with absence normalized so a
// template binding term.description never lands undefined.
export function termScopeOf ( term: LoadedTerm ): Record<string, unknown>
{
    return {
        id: term.id,
        name: term.name,
        description: term.description ?? '',
        ...( term.image === undefined ? {} : { image: term.image } ),
    };
}

function compareForOrder ( a: unknown, b: unknown ): number
{
    if ( typeof a === 'number' && typeof b === 'number' ) { return a - b; }

    return String( a ?? '' ).localeCompare( String( b ?? '' ) );
}

async function renderRepeatBlock (
    assembler: Assembler,
    block: Record<string, unknown>,
    path: string,
): Promise<string>
{
    const repeat = block.repeat as {
        source: { collection?: string; order?: string; limit?: number; entries?: string[]; term?: string; menu?: string; taxonomy?: string; filter?: string };
        component: string;
        props?: Record<string, unknown>;
        empty?: string;
    };

    const collections = assembler.options.collections ?? [];
    const component = findComponent( assembler, repeat.component );

    if ( component === undefined )
    {
        assembler.issues.push( { path, message: `The component "${repeat.component}" is not available to the build.` } );
        return '';
    }

    let entries: LoadedEntry[];

    // Presentation context (SCHEMA 13.5): the fields an entry's scope
    // presents through - dates formatted, references named. Menu and
    // taxonomy pseudo-entries are already presentation-shaped.
    const presentationDocs: PresentationDocs = {
        collections,
        ...( assembler.options.taxonomies === undefined ? {} : { taxonomies: assembler.options.taxonomies } ),
    };
    let fieldsOf: ( entry: LoadedEntry ) => NormalizedFields | undefined = () => undefined;

    // A menu repeat (SCHEMA 12.5): the resolved item tree rendered as
    // a real list - ul/li with nested lists for families, so a simple
    // row of links and a mega-menu are the same machinery. Each
    // LINKED item renders through the chosen component with
    // entry.label and entry.url bound in; a group (label, no url)
    // renders its label as plain text heading its children. Menu
    // order is authorial: "order" does not apply, "limit" trims the
    // top level.
    if ( repeat.source.menu !== undefined )
    {
        const menuItems = assembler.options.resolvedMenus?.[ repeat.source.menu ];

        if ( menuItems === undefined )
        {
            assembler.issues.push( { path: `${path}.repeat.source.menu`, message: `There is no menu "${repeat.source.menu}".` } );
            return '';
        }

        const renderMenuItems = async ( items: readonly ResolvedMenuItem[] ): Promise<string> =>
        {
            const parts: string[] = [];

            for ( const item of items )
            {
                let inner: string;

                if ( item.url === undefined )
                {
                    inner = `<span class="cs-menu-label">${escapeHtml( item.label )}</span>`;
                }
                else
                {
                    const scope = {
                        site: { menus: assembler.options.resolvedMenus ?? {} },
                        ...( assembler.options.pageScope === undefined ? {} : { page: assembler.options.pageScope } ),
                        entry: { title: item.label, label: item.label, url: item.url },
                    };
                    const props = resolveBindings( repeat.props ?? {}, scope ) as Record<string, unknown>;

                    inner = await renderComponentInstance( component, props, assembler.templateCache );
                }

                const children = item.items ?? [];
                const sub = children.length === 0 ? '' : `<ul class="cs-menu-sub">${await renderMenuItems( children )}</ul>`;

                parts.push( `<li class="cs-menu-item${sub === '' ? '' : ' cs-menu-parent'}">${inner}${sub}</li>` );
            }

            return parts.join( '' );
        };

        const top = repeat.source.limit === undefined ? menuItems : menuItems.slice( 0, repeat.source.limit );

        return `<ul class="cs-menu">${await renderMenuItems( top )}</ul>`;
    }

    // A taxonomy repeat (SCHEMA 13.5): one item per term, in term
    // order, with the term's name, description, and page URL bound
    // in. The URL is empty when the taxonomy has no term pages.
    if ( repeat.source.taxonomy !== undefined )
    {
        const taxonomy = ( assembler.options.taxonomies ?? [] ).find(
            ( candidate ) => candidate.file.replace( /\.json$/, '' ) === repeat.source.taxonomy,
        );

        if ( taxonomy === undefined )
        {
            assembler.issues.push( { path: `${path}.repeat.source.taxonomy`, message: `There is no taxonomy "${repeat.source.taxonomy}".` } );
            return '';
        }

        const hasTermPages = taxonomy.indexBlocks !== false && taxonomy.templateBlocks !== undefined;
        const taken = new Set<string>();
        const slugById = new Map( taxonomy.terms.map( ( term ) => [ term.id, entrySlug( term.name, term.id, taken ) ] ) );
        const termUrl = ( term: LoadedTerm ): string =>
        {
            if ( !hasTermPages ) { return ''; }

            const segments = [ slugById.get( term.id ) ?? '' ];
            const visited = new Set( [ term.id ] );
            let parent = term.parent;

            while ( parent !== undefined && !visited.has( parent ) )
            {
                visited.add( parent );
                segments.unshift( slugById.get( parent ) ?? '' );
                parent = taxonomy.terms.find( ( candidate ) => candidate.id === parent )?.parent;
            }

            return `/${repeat.source.taxonomy}/${segments.join( '/' )}/`;
        };

        entries = taxonomy.terms.map( ( term ) => ( {
            id: term.id,
            values: {
                title: term.name,
                name: term.name,
                description: term.description ?? '',
                url: termUrl( term ),
                ...( term.image === undefined ? {} : { image: term.image } ),
            },
            hasOwnBlocks: false,
        } ) );
    }
    else if ( repeat.source.entries !== undefined )
    {
        // Curated: the listed ids, in listed order, wherever they
        // live - each presenting through its own collection's fields.
        const byId = new Map( collections.flatMap( ( collection ) => collection.entries.map( ( entry ) => [ entry.id, entry ] as const ) ) );
        const owningFields = new Map( collections.flatMap( ( collection ) => collection.entries.map( ( entry ) => [ entry.id, collection.fields ] as const ) ) );

        entries = repeat.source.entries.flatMap( ( id ) => ( byId.get( id ) === undefined ? [] : [ byId.get( id ) as LoadedEntry ] ) );
        fieldsOf = ( entry ) => owningFields.get( entry.id );
    }
    else
    {
        // Query sources never see drafts; curated lists are filtered
        // below with everything else.
        const collection = collections.find( ( candidate ) => candidate.file.replace( /\.json$/, '' ) === repeat.source.collection );

        if ( collection === undefined )
        {
            assembler.issues.push( { path, message: `There is no collection "${repeat.source.collection ?? ''}" for this repeat to draw from.` } );
            return '';
        }

        entries = [ ...collection.entries ];
        fieldsOf = () => collection.fields;

        // The term-scoped repeat (SCHEMA 13.3): "term": "current"
        // narrows to the entries classified under the term page being
        // rendered, resolved through the one reference field that
        // targets this taxonomy. Descendant terms count as current.
        if ( repeat.source.term === 'current' )
        {
            const context = assembler.options.termContext;

            if ( context === undefined )
            {
                assembler.issues.push( { path: `${path}.repeat.source.term`, message: 'A term-scoped repeat renders only on a term template; this surface has no current term.' } );
                return '';
            }

            const targeting = Object.entries( collection.fields )
                .filter( ( [ , field ] ) => field.type === 'reference' && field.rules.taxonomy === context.taxonomyStem )
                .map( ( [ key ] ) => key );

            if ( targeting.length === 0 )
            {
                assembler.issues.push( { path: `${path}.repeat.source.term`, message: `No field in "${repeat.source.collection ?? ''}" references the taxonomy "${context.taxonomyStem}"; the term filter has nothing to match.` } );
                return '';
            }

            if ( targeting.length > 1 )
            {
                assembler.issues.push( { path: `${path}.repeat.source.term`, message: `Both ${targeting.map( ( key ) => `"${key}"` ).join( ' and ' )} reference "${context.taxonomyStem}"; the term filter cannot pick one.` } );
                return '';
            }

            const fieldKey = targeting[ 0 ] as string;

            entries = entries.filter( ( entry ) =>
            {
                const value = entry.values[ fieldKey ];

                // A multiple reference matches when ANY of its ids is
                // current - an entry tagged with two terms belongs on
                // both term pages.
                if ( Array.isArray( value ) ) { return value.some( ( id ) => typeof id === 'string' && context.termIds.includes( id ) ); }

                return typeof value === 'string' && context.termIds.includes( value );
            } );
        }

        // "filter" narrows the query with the conditions grammar
        // (SCHEMA 3.1): field keys as identifiers, evaluated against
        // the RAW stored values - presentation never changes what
        // matches. A filter that fails to parse reports and matches
        // everything, so the page still renders.
        if ( repeat.source.filter !== undefined )
        {
            try
            {
                const expression = parseExpression( repeat.source.filter );

                entries = entries.filter( ( entry ) => evaluateExpression( expression, entry.values as FieldValues ) );
            }
            catch ( error )
            {
                assembler.issues.push( { path: `${path}.repeat.source.filter`, message: `The filter does not parse: ${( error as Error ).message}` } );
            }
        }

        if ( repeat.source.order !== undefined )
        {
            const descending = repeat.source.order.startsWith( '-' );
            const orderPath = repeat.source.order.replace( /^-?entry\./, '' );

            // Ordering compares the RAW stored values (no fields, no
            // presentation): a formatted September sorts after April.
            const valueOf = ( entry: LoadedEntry ): unknown =>
                orderPath.split( '.' ).reduce<unknown>(
                    ( current, segment ) => ( current === null || typeof current !== 'object' ? undefined : ( current as Record<string, unknown> )[ segment ] ),
                    entryScopeOf( entry ),
                );

            entries.sort( ( a, b ) => ( descending ? -1 : 1 ) * compareForOrder( valueOf( a ), valueOf( b ) ) );
        }
    }

    // Drafts are omitted from every public rendering, curated lists
    // included: naming a draft keeps its slot ready, never shows it.
    entries = entries.filter( ( entry ) => entry.draft !== true );

    // On a paginated index, a repeat sourcing the collection shows
    // this window's slice and records the totals for the pager.
    const window = assembler.options.pageWindow;

    if ( window !== undefined && repeat.source.collection === window.stem )
    {
        assembler.pagination = { total: entries.length, totalPages: Math.max( 1, Math.ceil( entries.length / window.size ) ) };
        entries = entries.slice( ( window.number - 1 ) * window.size, window.number * window.size );
    }

    if ( repeat.source.limit !== undefined ) { entries = entries.slice( 0, repeat.source.limit ); }

    const items: string[] = [];

    for ( const entry of entries )
    {
        // The full scope vocabulary rides every item: entry.* is the
        // repeated thing, and site/page/term stay addressable so
        // inline tokens like {{ $page.title }} work inside repeats.
        const entryScope = entryScopeOf( entry, fieldsOf( entry ), presentationDocs );

        // The inherent entry.url (SCHEMA 13.5): the entry's own page
        // address - a real field named "url" wins over it.
        if ( entryScope.url === undefined )
        {
            entryScope.url = assembler.options.entryUrls?.[ entry.id ] ?? '';
        }

        const props = resolveBindings( repeat.props ?? {}, {
            site: { menus: assembler.options.resolvedMenus ?? {} },
            ...( assembler.options.pageScope === undefined ? {} : { page: assembler.options.pageScope } ),
            ...( assembler.options.termScope === undefined ? {} : { term: assembler.options.termScope } ),
            entry: entryScope,
        } ) as Record<string, unknown>;

        for ( const problem of missingRequiredFields( component.manifest.fields, props ) )
        {
            assembler.issues.push( {
                path: `${path}.repeat`,
                message: `"${problem.label}" is required and empty for the entry "${String( entry.values.title ?? entry.id )}".`,
            } );
        }

        items.push( await renderComponentInstance( component, props, assembler.templateCache ) );
    }

    // The author-owned empty state (SCHEMA 13.5): markdown shown when
    // the repeat matches nothing - inline tokens resolve, page and
    // site scopes included. Absent, an empty repeat renders nothing.
    if ( entries.length === 0 && typeof repeat.empty === 'string' && repeat.empty !== '' )
    {
        const text = String( resolveBindings( repeat.empty, {
            site: { menus: assembler.options.resolvedMenus ?? {} },
            ...( assembler.options.pageScope === undefined ? {} : { page: assembler.options.pageScope } ),
            ...( assembler.options.termScope === undefined ? {} : { term: assembler.options.termScope } ),
        } ) );

        return compileMarkdown( text, 2 ).html;
    }

    return items.join( '' );
}

// The one public way to render a component instance: resolver, then
// markdown compilation, then template. The assembler uses it per block,
// and the conformance harness uses it per declared example, so every
// component renders through the identical path regardless of author.
export async function renderComponentInstance (
    component: LoadedComponent,
    props: Readonly<Record<string, unknown>>,
    templateCache?: Map<string, readonly TemplateNode[]>,
): Promise<string>
{
    let template = templateCache?.get( component.templateFile );

    if ( template === undefined )
    {
        template = parseTemplate( await readFile( component.templateFile, 'utf8' ) );
        templateCache?.set( component.templateFile, template );
    }

    const payload = compileMarkdownFields(
        component.manifest.fields,
        resolveRenderPayload( component.manifest.fields, props ),
    );

    return renderTemplate( template, payload, component.manifest.fields );
}

interface SectionRecord
{
    readonly gap?: TokenValue;
    readonly padding?: TokenValue;
    readonly justify?: string;
    readonly align?: string;
    readonly wrap?: boolean;
    readonly direction?: string;
    readonly minHeight?: string;
    readonly width?: string;
}

// The layout contract (SCHEMA section 11.8): every top-level block
// constrains its content to the theme's content width with a
// horizontal gutter, so nothing butts against the viewport edge; a
// section's BACKGROUND bleeds the full width while its content
// constrains. Both tokens default sensibly when the theme is silent.
function layoutTokens ( config: SiteConfig ): { gutter?: string; width?: string }
{
    const spacing = Object.keys( config.theme.families.spacing ?? {} );
    const widths = Object.keys( config.theme.families.widths ?? {} );
    const gutter = config.theme.layout?.gutter ?? ( spacing.includes( 'md' ) ? 'md' : spacing[ 0 ] );
    const width = config.theme.layout?.width ?? ( widths.includes( 'wide' ) ? 'wide' : widths[ widths.length - 1 ] );

    return {
        ...( gutter === undefined ? {} : { gutter } ),
        ...( width === undefined ? {} : { width } ),
    };
}

function constrainClasses ( config: SiteConfig, widthOverride?: string ): string[]
{
    const layout = layoutTokens( config );
    const width = widthOverride ?? layout.width;

    return [
        'mx-auto',
        'w-full',
        ...( width === undefined ? [] : [ `max-w-${width}` ] ),
        ...( layout.gutter === undefined ? [] : [ `px-${layout.gutter}` ] ),
    ];
}

const justifyClasses: Readonly<Record<string, string>> = {
    start: 'justify-start', center: 'justify-center', end: 'justify-end',
    between: 'justify-between', around: 'justify-around', evenly: 'justify-evenly',
};

const alignClasses: Readonly<Record<string, string>> = {
    start: 'items-start', center: 'items-center', end: 'items-end',
    stretch: 'items-stretch', baseline: 'items-baseline',
};

// Nesting alternates direction: the page flows vertically, a section
// lays out horizontally, a section inside a section stacks again.
function sectionDirection ( section: SectionRecord, depth: number ): string
{
    return section.direction ?? ( depth % 2 === 1 ? 'row' : 'column' );
}

function sectionClasses ( section: SectionRecord, depth: number, config: SiteConfig ): string[]
{
    const direction = sectionDirection( section, depth );
    const directionClass = direction === 'layer'
        ? 'layer'
        : ( direction === 'row' ? 'flex flex-row' : 'flex flex-col' );

    // A section's gap defaults to the theme's gutter (SCHEMA 11.8):
    // children sit a gutter apart unless the section says otherwise.
    const gap = section.gap ?? layoutTokens( config ).gutter;

    return [
        directionClass,
        ...( section.wrap === true ? [ 'flex-wrap' ] : [] ),
        ...( section.justify === undefined ? [] : [ justifyClasses[ section.justify ] ?? '' ] ),
        ...( section.align === undefined ? [] : [ alignClasses[ section.align ] ?? '' ] ),
        ...( section.minHeight === undefined ? [] : [ `min-h-${section.minHeight}` ] ),
        ...tokenClasses( 'gap', gap ),
        ...tokenClasses( 'p', section.padding ),
    ];
}

function wrapperClasses ( block: Record<string, unknown> ): string[]
{
    const size = block.size;
    const sizeClasses = typeof size === 'string'
        ? [ `basis-${size}`, 'shrink-0' ]
        : ( typeof size === 'number' ? [ `grow-[${size}]` ] : [] );

    return [
        ...sizeClasses,
        ...tokenClasses( 'mt', block.spaceBefore as TokenValue | undefined ),
        ...tokenClasses( 'mb', block.spaceAfter as TokenValue | undefined ),
        ...tokenClasses( 'pull', block.pull as TokenValue | undefined ),
    ];
}

// In a row section, children with no declared size share the width
// equally, a gutter apart (Mikey's rule: one child fills the section,
// two take half each); a declared size wins. min-w-0 lets long
// content shrink instead of blowing the column out.
function flowShareClasses ( block: Record<string, unknown>, parentFlow: string ): string[]
{
    return parentFlow === 'row' && block.size === undefined ? [ 'min-w-0', 'flex-1' ] : [];
}

async function renderBlock (
    assembler: Assembler,
    rawBlock: unknown,
    path: string,
    depth: number,
    parentFlow = 'column',
): Promise<string>
{
    const block = rawBlock as Record<string, unknown>;

    // A hidden block persists in the document and is omitted from
    // compilation entirely (SCHEMA section 11.3); because it is skipped
    // before heading resolution, hiding a block never reshapes levels
    // it no longer participates in.
    if ( block.hidden === true ) { return ''; }

    const slugAttribute = typeof block.slug === 'string' ? ` data-slug="${escapeHtml( block.slug )}"` : '';

    // Studio's canvas addresses every block by its document path, so
    // selection works at each level of page > section > component
    // (EDITOR section 2). Never emitted by caso build.
    const marker = assembler.options.blockMarkers === true ? ` data-casomer-block="${path}"` : '';

    if ( block.component !== undefined )
    {
        const inner = await renderComponentBlock( assembler, block, path );
        const classes = depth === 1
            ? [ ...constrainClasses( assembler.options.config ), ...wrapperClasses( block ) ]
            : [ ...flowShareClasses( block, parentFlow ), ...wrapperClasses( block ) ];

        return `<div${marker}${classAttribute( classes )}${slugAttribute}>\n${inner}</div>\n`;
    }

    // A partial block (SCHEMA 12.5, Mikey's vision): a named site
    // partial rendered in place. Its blocks render exactly as they
    // would at this depth - sections bleed and constrain as usual -
    // but marker-less: the partial edits on ITS canvas, and the page
    // selects it as one unit. Recursion terminates with an issue.
    if ( block.partial !== undefined )
    {
        const name = String( block.partial );
        const blocks = assembler.options.config.partials?.[ name ];
        const classes = [ ...wrapperClasses( block ) ];

        if ( blocks === undefined )
        {
            assembler.issues.push( { path: `${path}.partial`, message: `There is no partial "${name}".` } );
            return `<div${marker}${classAttribute( classes )}${slugAttribute}></div>\n`;
        }

        if ( assembler.activePartials.has( name ) )
        {
            assembler.issues.push( { path: `${path}.partial`, message: `The partial "${name}" contains itself; the loop stops here.` } );
            return `<div${marker}${classAttribute( classes )}${slugAttribute}></div>\n`;
        }

        assembler.activePartials.add( name );

        const partialAssembler: Assembler = { ...assembler, options: { ...assembler.options, blockMarkers: false } };
        const rendered: string[] = [];

        for ( const [ index, child ] of blocks.entries() )
        {
            rendered.push( await renderBlock( partialAssembler, child, `site.partials.${name}[${index}]`, depth, parentFlow ) );
        }

        assembler.activePartials.delete( name );

        return `<div${marker}${classAttribute( classes )}${slugAttribute}>\n${rendered.join( '' )}</div>\n`;
    }

    // A repeat is arrangement, not a special component (13.5): one
    // wrapper div holding the items consecutively; layout around the
    // items comes from the enclosing section, never the repeat itself.
    if ( block.repeat !== undefined )
    {
        const inner = await renderRepeatBlock( assembler, block, path );
        const classes = depth === 1
            ? [ ...constrainClasses( assembler.options.config ), ...wrapperClasses( block ) ]
            : [ ...flowShareClasses( block, parentFlow ), ...wrapperClasses( block ) ];

        return `<div${marker}${classAttribute( classes )}${slugAttribute}>\n${inner}</div>\n`;
    }

    const section = ( block.section ?? {} ) as SectionRecord;
    const childBlocks = ( block.blocks ?? [] ) as unknown[];
    const flow = sectionDirection( section, depth );
    const children: string[] = [];

    for ( const [ index, child ] of childBlocks.entries() )
    {
        children.push( await renderBlock( assembler, child, `${path}.blocks[${index}]`, depth + 1, flow ) );
    }

    const inner = children.join( '' );

    // A section whose scope contains a heading is a <section>; a purely
    // layout section is a <div>, keeping the outline honest (11.7).
    const tag = headingLevelsIn( inner ).length > 0 ? 'section' : 'div';

    // An empty section is invisible in the real output but must stay
    // workable on the canvas: the editing document flags it so the
    // bridge can give it a resting ghost (EDITOR section 2). Marker
    // mode only - caso build never emits it.
    const emptyFlag = assembler.options.blockMarkers === true && childBlocks.length === 0 ? ' data-casomer-empty=""' : '';

    // Top level: the section element bleeds (its surface spans the
    // viewport) while an inner container constrains the content and
    // carries the flex layout. Nested sections stay one element.
    if ( depth === 1 )
    {
        const innerClasses = [ ...constrainClasses( assembler.options.config, section.width ), ...sectionClasses( section, depth, assembler.options.config ) ];
        const outerClasses = [ 'w-full', ...wrapperClasses( block ) ];

        return `<${tag}${marker}${classAttribute( outerClasses )}${slugAttribute}>\n<div${emptyFlag}${classAttribute( innerClasses )}>\n${inner}</div>\n</${tag}>\n`;
    }

    const classes = [
        ...flowShareClasses( block, parentFlow ),
        ...sectionClasses( section, depth, assembler.options.config ),
        ...wrapperClasses( block ),
    ];

    return `<${tag}${marker}${emptyFlag}${classAttribute( classes )}${slugAttribute}>\n${inner}</${tag}>\n`;
}

export async function assemblePage ( page: PageInput, options: AssembleOptions ): Promise<AssembledPage>
{
    const assembler: Assembler = {
        options: { ...options, pageScope: options.pageScope ?? { title: page.title, slug: page.slug } },
        issues: [],
        templateCache: new Map(),

        // Shared with the region assembler below by reference, on
        // purpose: a header morph name and a page morph name collide
        // on the same composed document.
        morphNames: new Map(),
        activePartials: new Set(),
    };
    const rhythm = options.config.theme.rhythm;
    const scopes: string[] = [];

    // Every top-level block is a heading scope. The FIRST scope that
    // contains a heading maps from h1 - the page's designated h1 is
    // whatever the user put first (the default page prefills a
    // core/heading bound to page.title); later scopes map from h2.
    // Nothing is scaffolded: no content is hard-coded in the output.
    let firstHeadingScopeSeen = false;

    for ( const [ index, block ] of page.blocks.entries() )
    {
        const rendered = await renderBlock( assembler, block, `blocks[${index}]`, 1 );
        const hasHeadings = headingLevelsIn( rendered ).length > 0;
        const base = hasHeadings && !firstHeadingScopeSeen ? 1 : 2;

        if ( hasHeadings ) { firstHeadingScopeSeen = true; }

        scopes.push( remapHeadings( rendered, base ) );
    }

    const generator = options.generatorVersion === undefined
        ? ''
        : `\n    <meta name="generator" content="casomer ${escapeHtml( options.generatorVersion )}">`;

    // The site's display name joins every document title; home speaks
    // the site name alone. The icon emits as the favicon pair - one
    // square source, the browser scales (derived sizes can come later
    // without changing the document contract).
    const siteName = options.config.name;
    const documentTitle = siteName === undefined
        ? page.title
        : ( page.slug === 'home' ? siteName : `${page.title} \u00b7 ${siteName}` );
    const iconLinks = options.config.icon === undefined
        ? ''
        : `\n    <link rel="icon" href="${escapeHtml( options.config.icon )}">\n    <link rel="apple-touch-icon" href="${escapeHtml( options.config.icon )}">`;

    // Third-party resources (SCHEMA 12.1): user-declared stylesheet
    // URLs - fonts and the like - loaded before the site's own CSS.
    const resourceLinks = ( options.config.theme.resources ?? [] )
        .map( ( url ) => `\n    <link rel="stylesheet" href="${escapeHtml( url )}">` )
        .join( '' );

    // Rhythm governs vertical space: the same token that separates
    // top-level blocks also breathes at the page's top and bottom -
    // otherwise the h1 (and the last block) butt the viewport edge.
    const mainClasses = classAttribute( [ 'flex', 'flex-col', ...( rhythm === undefined ? [] : [ `gap-${rhythm}`, `py-${rhythm}` ] ) ] );

    // Regions (SCHEMA 12.5): the persistent chrome renders outside
    // <main>, marker-less always - a page canvas never selects into
    // a region; regions get their own editing surface.
    const regionAssembler: Assembler = { ...assembler, options: { ...assembler.options, blockMarkers: false } };
    const renderRegion = async ( blocks: readonly unknown[] | undefined, name: string ): Promise<string> =>
    {
        if ( blocks === undefined || blocks.length === 0 ) { return ''; }

        const rendered: string[] = [];

        for ( const [ index, block ] of blocks.entries() )
        {
            rendered.push( remapHeadings( await renderBlock( regionAssembler, block, `site.regions.${name}[${index}]`, 1 ), 2 ) );
        }

        return `\n${rendered.join( '' )}    `;
    };
    const headerHtml = await renderRegion( options.config.regions?.header, 'header' );
    const footerHtml = await renderRegion( options.config.regions?.footer, 'footer' );

    // The pager (SCHEMA 13.5): compiler scaffolding like the skip
    // link - a nav of page links when the window's listing spans
    // more than one page. The theme CSS carries the functional
    // .cs-pager layer; sites restyle freely.
    const window = assembler.options.pageWindow;
    const totalPages = assembler.pagination?.totalPages ?? 1;
    let pagerHtml = '';

    if ( window !== undefined && totalPages > 1 )
    {
        const linkTo = ( n: number ): string => ( n === 1 ? window.base : `${window.base}page/${n}/` );
        const numbers = Array.from( { length: totalPages }, ( _value, index ) => index + 1 )
            .map( ( n ) => ( n === window.number
                ? `<li><span class="cs-pager-current" aria-current="page">${n}</span></li>`
                : `<li><a href="${linkTo( n )}">${n}</a></li>` ) )
            .join( '' );
        const previous = window.number > 1 ? `<li><a class="cs-pager-prev" href="${linkTo( window.number - 1 )}" rel="prev">←</a></li>` : '';
        const next = window.number < totalPages ? `<li><a class="cs-pager-next" href="${linkTo( window.number + 1 )}" rel="next">→</a></li>` : '';

        pagerHtml = `<nav class="cs-pager" aria-label="Pagination"><ul>${previous}${numbers}${next}</ul></nav>\n`;
    }

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">${generator}
    <title>${escapeHtml( documentTitle )}</title>${iconLinks}${resourceLinks}
    <link rel="stylesheet" href="${options.assets?.stylesheet ?? '/assets/css/main.css'}">
    <script defer src="${options.assets?.alpineScript ?? '/assets/js/alpine.min.js'}"></script>
    <script type="module" src="${options.assets?.runtimeScript ?? '/assets/js/casomer-runtime.js'}"></script>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header style="view-transition-name: casomer-header">${headerHtml}</header>
    <main id="main"${mainClasses}>
${scopes.join( '' )}${pagerHtml}    </main>
    <footer style="view-transition-name: casomer-footer">${footerHtml}</footer>
</body>
</html>
`;

    return {
        html: clampHeadingSequence( html ),
        issues: assembler.issues,
        ...( window === undefined ? {} : { pagination: { totalPages } } ),
    };
}
