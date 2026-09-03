// Self-describing content files (SCHEMA section 13.1): beyond the two
// reserved names, every content file declares what it is in its own
// header - kind "collection" or "taxonomy" (plus "comments", the
// collaboration sidecar). A JSON file without our casomerSchema key is
// somebody else's and is silently ignored; a file that carries our key
// gets the manifest-strict treatment, did-you-mean included. The file,
// not the filename, is the truth.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeFields, suggestNearest, FieldSchemaError, type NormalizedFields, type SchemaIssue } from '../schema/fields.ts';

const contentKinds = [ 'collection', 'taxonomy', 'comments' ];
const collectionHeaderKeys = [ 'casomerSchema', 'kind', 'label', 'fields', 'layouts', 'layout', 'template', 'index', 'table', 'locked', 'parent', 'entries' ];
const taxonomyHeaderKeys = [ 'casomerSchema', 'kind', 'label', 'terms', 'index', 'layout', 'template', 'hierarchical' ];
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LoadedEntry
{
    readonly id: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly hasOwnBlocks: boolean;
    readonly blocks?: readonly unknown[];

    // The named layout this entry follows (SCHEMA 13.4, named layouts
    // 2026-09-02); absent means "default". Own blocks win over it.
    readonly layout?: string;

    // A draft persists and stays editable but is omitted from every
    // public rendering: build emission, repeats, the pure preview -
    // and from required-field enforcement (parallel to a block's
    // "hidden": present in the document, absent from the output).
    readonly draft?: boolean;
}

export interface LoadedCollection
{
    readonly file: string;
    readonly label: string;
    readonly fields: NormalizedFields;
    readonly entries: readonly LoadedEntry[];
    readonly locked: boolean;

    // A mounted collection (SCHEMA 13.6): its public pages nest under
    // a page's URL instead of the root.
    readonly parent?: string;
    readonly templateBlocks?: readonly unknown[];
    readonly indexBlocks?: readonly unknown[] | false;

    // Pagination (SCHEMA 13.5): entries per index page; absent means
    // the whole listing on one page.
    readonly indexPageSize?: number;

    // The page templates the layouts render through (SCHEMA 12.6,
    // Mikey): "index.template" and the default layout's "template";
    // absent means default.
    readonly indexTemplate?: string;
    readonly entryTemplate?: string;

    // Every named entry layout (SCHEMA 13.4, Mikey 2026-09-02):
    // "layouts": { "<name>": { "blocks", "template"? } }. "default" is
    // the one entries follow unless they name another or carry their
    // own blocks. templateBlocks and entryTemplate above mirror the
    // default's, for the consumers that predate names.
    readonly layouts: Readonly<Record<string, EntryLayout>>;
}

export interface EntryLayout
{
    readonly blocks: readonly unknown[];
    readonly template?: string;
}

// The layout an entry renders through: its own blocks when it has
// them (rogue), else the named layout, else the default. The page
// template rides with the layout it left when rogue.
export function entryLayoutOf ( collection: Pick<LoadedCollection, 'layouts'>, entry: Pick<LoadedEntry, 'blocks' | 'layout'> ): { readonly name: string; readonly own: boolean; readonly blocks?: readonly unknown[]; readonly template?: string }
{
    const name = entry.layout ?? 'default';
    const layout = collection.layouts[ name ] ?? collection.layouts.default;

    if ( entry.blocks !== undefined )
    {
        return { name, own: true, blocks: entry.blocks, ...( layout?.template === undefined ? {} : { template: layout.template } ) };
    }

    return { name, own: false, ...( layout === undefined ? {} : { blocks: layout.blocks, ...( layout.template === undefined ? {} : { template: layout.template } ) } ) };
}

export interface LoadedTaxonomy
{
    readonly file: string;
    readonly label: string;

    // A hierarchical taxonomy's terms may carry a parent term id;
    // a flat one never does (SCHEMA: a vocabulary, optionally a tree).
    readonly hierarchical: boolean;

    // The fixed term shape (SCHEMA 13.3): name, parent, description,
    // image - deliberately not user-extensible; richer data is a
    // collection reached through a reference field.
    readonly terms: readonly LoadedTerm[];

    // Public term pages own two surfaces, exactly like a collection:
    // the term listing (index) and the shared term template.
    readonly templateBlocks?: readonly unknown[];
    readonly indexBlocks?: readonly unknown[] | false;

    // The page templates the two render through (SCHEMA 12.6).
    readonly indexTemplate?: string;
    readonly termTemplate?: string;
}

// A layout's page template (SCHEMA 12.6): "template" inside an index
// or entry layout names the page template it renders through; absent
// means default.
function templateNameOf ( value: unknown, path: string, issues: { path: string; message: string }[] ): string | undefined
{
    if ( value === undefined ) { return undefined; }
    if ( typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test( value ) ) { return value; }

    issues.push( { path, message: '"template" names a page template: lowercase, digits, hyphens.' } );
    return undefined;
}

export interface LoadedTerm
{
    readonly id: string;
    readonly name: string;
    readonly parent?: string;
    readonly description?: string;
    readonly image?: Readonly<Record<string, unknown>>;
}

// A term and everything nested beneath it (SCHEMA 13.3: a category
// page shows its subcategories' content). Cycle-guarded like every
// tree walk.
export function termAndDescendantIds ( terms: readonly LoadedTerm[], id: string ): string[]
{
    const ids = [ id ];
    const seen = new Set( [ id ] );

    for ( let cursor = 0; cursor < ids.length; cursor += 1 )
    {
        for ( const term of terms )
        {
            if ( term.parent === ids[ cursor ] && !seen.has( term.id ) )
            {
                seen.add( term.id );
                ids.push( term.id );
            }
        }
    }

    return ids;
}

export interface ContentDocuments
{
    readonly collections: readonly LoadedCollection[];
    readonly taxonomies: readonly LoadedTaxonomy[];
}

function checkHeaderKeys ( record: Record<string, unknown>, known: readonly string[], file: string, issues: SchemaIssue[] ): void
{
    for ( const key of Object.keys( record ) )
    {
        if ( !known.includes( key ) )
        {
            issues.push( { path: `${file}.${key}`, message: `Unknown key "${key}".${suggestNearest( key, known )}` } );
        }
    }
}

function labelOf ( record: Record<string, unknown>, file: string, issues: SchemaIssue[] ): string | undefined
{
    if ( typeof record.label !== 'string' || record.label === '' )
    {
        issues.push( { path: `${file}.label`, message: 'Every collection and taxonomy carries a "label" - the name people see.' } );
        return undefined;
    }

    return record.label;
}

function parseCollection ( record: Record<string, unknown>, file: string, issues: SchemaIssue[], seenIds: Map<string, string> ): LoadedCollection | undefined
{
    checkHeaderKeys( record, collectionHeaderKeys, file, issues );

    const label = labelOf( record, file, issues );

    let fields: NormalizedFields = {};

    try
    {
        fields = normalizeFields( record.fields ?? { title: 'text!' } );
    }
    catch ( error )
    {
        if ( !( error instanceof FieldSchemaError ) ) { throw error; }

        issues.push( ...error.issues.map( ( issue ) => ( { path: `${file}.fields.${issue.path}`, message: issue.message } ) ) );
    }

    if ( record.fields !== undefined && fields.title === undefined )
    {
        issues.push( { path: `${file}.fields`, message: 'Every collection has a "title" field - entries need labels (SCHEMA section 13.3).' } );
    }

    const entryList = record.entries ?? [];

    if ( !Array.isArray( entryList ) )
    {
        issues.push( { path: `${file}.entries`, message: '"entries" is an array of entries.' } );
        return undefined;
    }

    const entryKeys = [ 'id', 'blocks', 'draft', 'layout', ...Object.keys( fields ) ];
    const entries: LoadedEntry[] = [];

    for ( const [ index, rawEntry ] of entryList.entries() )
    {
        const entryPath = `${file}.entries[${index}]`;

        if ( rawEntry === null || typeof rawEntry !== 'object' || Array.isArray( rawEntry ) )
        {
            issues.push( { path: entryPath, message: 'An entry is an object of field values with an id.' } );
            continue;
        }

        const entry = rawEntry as Record<string, unknown>;

        if ( typeof entry.id !== 'string' || !uuidShape.test( entry.id ) )
        {
            issues.push( { path: `${entryPath}.id`, message: 'Every entry has a UUID id (SCHEMA section 13.2).' } );
        }
        else if ( seenIds.has( entry.id ) )
        {
            issues.push( { path: `${entryPath}.id`, message: `The id "${entry.id}" is already used by ${seenIds.get( entry.id )}. Ids are globally unique.` } );
        }
        else { seenIds.set( entry.id, entryPath ); }

        for ( const key of Object.keys( entry ) )
        {
            if ( !entryKeys.includes( key ) )
            {
                issues.push( { path: `${entryPath}.${key}`, message: `"${key}" is not a field of this collection.${suggestNearest( key, entryKeys )}` } );
            }
        }

        const { id, blocks, draft, layout: layoutName, ...values } = entry;

        if ( blocks !== undefined && !Array.isArray( blocks ) )
        {
            issues.push( { path: `${entryPath}.blocks`, message: 'A diverged entry\'s "blocks" is a blocks array (SCHEMA section 13.4).' } );
        }

        if ( layoutName !== undefined && ( typeof layoutName !== 'string' || !/^[a-z][a-z0-9-]*$/.test( layoutName ) ) )
        {
            issues.push( { path: `${entryPath}.layout`, message: '"layout" names one of the collection\'s layouts: lowercase, digits, hyphens.' } );
        }

        entries.push( {
            id: typeof id === 'string' ? id : '',
            values,
            hasOwnBlocks: blocks !== undefined,
            ...( Array.isArray( blocks ) ? { blocks } : {} ),
            ...( typeof layoutName === 'string' && /^[a-z][a-z0-9-]*$/.test( layoutName ) ? { layout: layoutName } : {} ),
            ...( draft === true ? { draft: true } : {} ),
        } );
    }

    // The entry template and the index page are blocks layouts that
    // live in the collection header (SCHEMA section 13.4). An absent
    // index means the listing page exists and is empty; index: false
    // opts the collection out of a public listing entirely.
    let templateBlocks: readonly unknown[] | undefined;
    let layoutTemplate: string | undefined;

    // Named layouts (Mikey, 2026-09-02): "layouts": { "<name>": {
    // "blocks", "template"? } }. A file still on the single "layout"
    // object (or its retired "template" spelling) reads that object as
    // the default layout until Studio's next write to the file.
    const layouts: Record<string, EntryLayout> = {};
    const readLayout = ( value: unknown, path: string ): EntryLayout | undefined =>
    {
        const record = value as Record<string, unknown> | null;

        if ( record === null || typeof record !== 'object' || Array.isArray( record ) || !Array.isArray( record.blocks ) )
        {
            issues.push( { path, message: '"layout" is an object with a "blocks" array - an entry layout.' } );
            return undefined;
        }

        const template = templateNameOf( record.template, `${path}.template`, issues );

        return { blocks: record.blocks, ...( template === undefined ? {} : { template } ) };
    };

    if ( record.layouts !== undefined )
    {
        if ( record.layouts === null || typeof record.layouts !== 'object' || Array.isArray( record.layouts ) )
        {
            issues.push( { path: `${file}.layouts`, message: '"layouts" is an object of named entry layouts.' } );
        }
        else
        {
            for ( const [ name, value ] of Object.entries( record.layouts as Record<string, unknown> ) )
            {
                if ( !/^[a-z][a-z0-9-]*$/.test( name ) )
                {
                    issues.push( { path: `${file}.layouts.${name}`, message: 'A layout name is token shaped: lowercase, digits, hyphens.' } );
                    continue;
                }

                const layout = readLayout( value, `${file}.layouts.${name}` );

                if ( layout !== undefined ) { layouts[ name ] = layout; }
            }
        }
    }
    else
    {
        const layoutKey = record.layout !== undefined ? 'layout' : 'template';

        if ( record[ layoutKey ] !== undefined )
        {
            const layout = readLayout( record[ layoutKey ], `${file}.${layoutKey}` );

            if ( layout !== undefined ) { layouts.default = layout; }
        }
    }

    if ( layouts.default !== undefined )
    {
        templateBlocks = layouts.default.blocks;
        layoutTemplate = layouts.default.template;
    }

    for ( const [ index, entry ] of entries.entries() )
    {
        if ( entry.layout !== undefined && layouts[ entry.layout ] === undefined )
        {
            issues.push( { path: `${file}.entries[${index}].layout`, message: `There is no layout "${entry.layout}" in this collection.` } );
        }
    }

    let indexBlocks: readonly unknown[] | false | undefined;
    let indexTemplate: string | undefined;
    let indexPageSize: number | undefined;

    if ( record.index === false ) { indexBlocks = false; }
    else if ( record.index !== undefined )
    {
        const indexPage = record.index as Record<string, unknown> | null;

        if ( indexPage === null || typeof indexPage !== 'object' || Array.isArray( indexPage ) || !Array.isArray( indexPage.blocks ) )
        {
            issues.push( { path: `${file}.index`, message: '"index" is false, or an object with a "blocks" array - the public listing page.' } );
        }
        else
        {
            indexBlocks = indexPage.blocks;
            indexTemplate = templateNameOf( indexPage.template, `${file}.index.template`, issues );

            // Pagination (SCHEMA 13.5): "pageSize" splits the index
            // into /page/2/ and beyond; absent means one page.
            if ( indexPage.pageSize !== undefined )
            {
                if ( typeof indexPage.pageSize === 'number' && Number.isInteger( indexPage.pageSize ) && indexPage.pageSize >= 1 )
                {
                    indexPageSize = indexPage.pageSize;
                }
                else
                {
                    issues.push( { path: `${file}.index.pageSize`, message: '"pageSize" is a positive whole number of entries per index page.' } );
                }
            }
        }
    }

    if ( record.parent !== undefined && typeof record.parent !== 'string' )
    {
        issues.push( { path: `${file}.parent`, message: '"parent" is a page id: the collection mounts under that page\'s URL (SCHEMA 13.6).' } );
    }

    if ( label === undefined ) { return undefined; }

    return {
        file,
        label,
        fields,
        entries,
        locked: record.locked === true,
        ...( typeof record.parent === 'string' ? { parent: record.parent } : {} ),
        layouts,
        ...( templateBlocks === undefined ? {} : { templateBlocks } ),
        ...( indexBlocks === undefined ? {} : { indexBlocks } ),
        ...( indexPageSize === undefined ? {} : { indexPageSize } ),
        ...( indexTemplate === undefined ? {} : { indexTemplate } ),
        ...( layoutTemplate === undefined ? {} : { entryTemplate: layoutTemplate } ),
    };
}

function parseTaxonomy ( record: Record<string, unknown>, file: string, issues: SchemaIssue[], seenIds: Map<string, string> ): LoadedTaxonomy | undefined
{
    checkHeaderKeys( record, taxonomyHeaderKeys, file, issues );

    const label = labelOf( record, file, issues );
    const termList = record.terms ?? [];

    if ( !Array.isArray( termList ) )
    {
        issues.push( { path: `${file}.terms`, message: '"terms" is an array of terms.' } );
        return undefined;
    }

    const hierarchical = record.hierarchical === true;
    const terms: { id: string; name: string; parent?: string; description?: string; image?: Record<string, unknown> }[] = [];

    for ( const [ index, rawTerm ] of termList.entries() )
    {
        const termPath = `${file}.terms[${index}]`;
        const term = rawTerm as Record<string, unknown> | null;

        if ( term === null || typeof term !== 'object' || Array.isArray( term )
            || typeof term.id !== 'string' || !uuidShape.test( term.id ) || typeof term.name !== 'string' )
        {
            issues.push( { path: termPath, message: 'A term is an object with a UUID id and a name.' } );
            continue;
        }

        if ( seenIds.has( term.id ) )
        {
            issues.push( { path: `${termPath}.id`, message: `The id "${term.id}" is already used by ${seenIds.get( term.id )}. Ids are globally unique.` } );
        }
        else { seenIds.set( term.id, termPath ); }

        if ( term.parent !== undefined && !hierarchical )
        {
            issues.push( { path: `${termPath}.parent`, message: 'Terms only nest in a hierarchical taxonomy ("hierarchical": true in the header).' } );
        }

        if ( term.parent !== undefined && typeof term.parent !== 'string' )
        {
            issues.push( { path: `${termPath}.parent`, message: '"parent" is another term\'s id.' } );
        }

        if ( term.description !== undefined && typeof term.description !== 'string' )
        {
            issues.push( { path: `${termPath}.description`, message: '"description" is a string.' } );
        }

        const rawImage = term.image as Record<string, unknown> | null | undefined;
        let termImage: Record<string, unknown> | undefined;

        if ( rawImage !== undefined )
        {
            if ( rawImage === null || typeof rawImage !== 'object' || Array.isArray( rawImage ) || typeof rawImage.src !== 'string' )
            {
                issues.push( { path: `${termPath}.image`, message: '"image" is an object with a "src" path (and an "alt").' } );
            }
            else { termImage = rawImage; }
        }

        terms.push( {
            id: term.id,
            name: term.name,
            ...( hierarchical && typeof term.parent === 'string' ? { parent: term.parent } : {} ),
            ...( typeof term.description === 'string' && term.description !== '' ? { description: term.description } : {} ),
            ...( termImage !== undefined ? { image: termImage } : {} ),
        } );
    }

    // Parents must exist in this taxonomy, and the tree must be a
    // tree: walking up from any term has to reach a root, never loop.
    const byId = new Map( terms.map( ( term ) => [ term.id, term ] ) );

    for ( const [ index, term ] of terms.entries() )
    {
        if ( term.parent === undefined ) { continue; }

        if ( !byId.has( term.parent ) )
        {
            issues.push( { path: `${file}.terms[${index}].parent`, message: `No term in this taxonomy has the id "${term.parent}".` } );
            continue;
        }

        const seen = new Set<string>( [ term.id ] );
        let current = term.parent as string | undefined;

        while ( current !== undefined )
        {
            if ( seen.has( current ) )
            {
                issues.push( { path: `${file}.terms[${index}].parent`, message: 'Term parents form a loop; a hierarchy is a tree.' } );
                break;
            }

            seen.add( current );
            current = byId.get( current )?.parent;
        }
    }

    let templateBlocks: readonly unknown[] | undefined;
    let layoutTemplate: string | undefined;

    const layoutKey = record.layout !== undefined ? 'layout' : 'template';

    if ( record[ layoutKey ] !== undefined )
    {
        const template = record[ layoutKey ] as Record<string, unknown> | null;

        if ( template === null || typeof template !== 'object' || Array.isArray( template ) || !Array.isArray( template.blocks ) )
        {
            issues.push( { path: `${file}.${layoutKey}`, message: '"layout" is an object with a "blocks" array - the layout every term page follows.' } );
        }
        else
        {
            templateBlocks = template.blocks;
            layoutTemplate = templateNameOf( template.template, `${file}.${layoutKey}.template`, issues );
        }
    }

    let indexBlocks: readonly unknown[] | false | undefined;
    let indexTemplate: string | undefined;

    if ( record.index === false ) { indexBlocks = false; }
    else if ( record.index !== undefined )
    {
        const indexPage = record.index as Record<string, unknown> | null;

        if ( indexPage === null || typeof indexPage !== 'object' || Array.isArray( indexPage ) || !Array.isArray( indexPage.blocks ) )
        {
            issues.push( { path: `${file}.index`, message: '"index" is false, or an object with a "blocks" array - the public term listing.' } );
        }
        else
        {
            indexBlocks = indexPage.blocks;
            indexTemplate = templateNameOf( indexPage.template, `${file}.index.template`, issues );
        }
    }

    if ( label === undefined ) { return undefined; }

    return {
        file,
        label,
        hierarchical,
        terms,
        ...( templateBlocks === undefined ? {} : { templateBlocks } ),
        ...( indexBlocks === undefined ? {} : { indexBlocks } ),
        ...( indexTemplate === undefined ? {} : { indexTemplate } ),
        ...( layoutTemplate === undefined ? {} : { termTemplate: layoutTemplate } ),
    };
}

export async function loadContentDocuments (
    contentDirectory: string,
    issues: SchemaIssue[],
    seenIds: Map<string, string>,
): Promise<ContentDocuments>
{
    const collections: LoadedCollection[] = [];
    const taxonomies: LoadedTaxonomy[] = [];

    let names: string[];

    try
    {
        names = ( await readdir( contentDirectory, { withFileTypes: true } ) )
            .filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.json' ) )
            .map( ( entry ) => entry.name )
            .sort();
    }
    catch
    {
        return { collections, taxonomies };
    }

    for ( const name of names )
    {
        if ( name === 'site.json' || name === 'pages.json' ) { continue; }

        let value: unknown;

        try
        {
            value = JSON.parse( await readFile( join( contentDirectory, name ), 'utf8' ) );
        }
        catch
        {
            continue;
        }

        if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) { continue; }

        const record = value as Record<string, unknown>;

        if ( record.casomerSchema !== 1 ) { continue; }

        if ( typeof record.kind !== 'string' || !contentKinds.includes( record.kind ) )
        {
            issues.push( {
                path: `${name}.kind`,
                message: `A content file's "kind" is "collection" or "taxonomy".${suggestNearest( String( record.kind ?? '' ), contentKinds )}`,
            } );
            continue;
        }

        if ( record.kind === 'collection' )
        {
            const collection = parseCollection( record, name, issues, seenIds );

            if ( collection !== undefined ) { collections.push( collection ); }
        }

        if ( record.kind === 'taxonomy' )
        {
            const taxonomy = parseTaxonomy( record, name, issues, seenIds );

            if ( taxonomy !== undefined ) { taxonomies.push( taxonomy ); }
        }
    }

    return { collections, taxonomies };
}
