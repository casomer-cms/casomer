// The blocks-and-sections layout grammar of SCHEMA section 11: a page's
// content is a blocks array, each block a wrapper holding a component
// instance or a section. Layout lives on wrappers and sections; margin
// does not exist; spacing values are design tokens or breakpoint maps
// over them. This validates the shape; token existence and breakpoint
// names are cross-checked by the site loader, which knows the theme.

import { suggestNearest } from '../schema/fields.ts';
import { parseExpression } from '../schema/expressions.ts';
import { parseComponentReference, ComponentReferenceError, type SchemaIssue } from '../schema/manifest.ts';

export type TokenValue = string | Readonly<Record<string, string>>;

const componentBlockKeys = [ 'component', 'props', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull', 'morph' ];
const partialBlockKeys = [ 'partial', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull' ];
const morphShape = /^[a-z][a-z0-9-]*$/;
const sectionBlockKeys = [ 'section', 'blocks', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull' ];
const repeatBlockKeys = [ 'repeat', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull' ];
const repeatKeys = [ 'source', 'component', 'props', 'empty' ];
const repeatSourceKeys = [ 'collection', 'order', 'limit', 'entries', 'term', 'menu', 'taxonomy', 'filter' ];
const bindPathShape = /^entry\.[A-Za-z_][A-Za-z0-9_.]*$/;
const orderShape = /^-?entry\.[A-Za-z_][A-Za-z0-9_.]*$/;
const sectionPropertyKeys = [ 'gap', 'justify', 'align', 'wrap', 'padding', 'direction', 'minHeight', 'width' ];

const directions = [ 'row', 'column', 'layer' ];
const minHeightPresets = [ 'screen', 'half', 'third' ];

const sizeFractionShape = /^[1-9][0-9]*\/[1-9][0-9]*$/;
const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CollectedReference
{
    readonly reference: string;
    readonly path: string;
}

export interface CollectedTokenValue
{
    readonly value: TokenValue;
    readonly path: string;
}

export interface BlocksAnalysis
{
    readonly references: readonly CollectedReference[];
    readonly spacingValues: readonly CollectedTokenValue[];
    readonly repeatSources: readonly { readonly collection: string; readonly path: string }[];
}

function validateTokenValue (
    raw: unknown,
    path: string,
    issues: SchemaIssue[],
    spacingValues: CollectedTokenValue[],
): void
{
    if ( typeof raw === 'string' && raw.length > 0 )
    {
        spacingValues.push( { value: raw, path } );
        return;
    }

    if ( raw !== null && typeof raw === 'object' && !Array.isArray( raw ) )
    {
        const entries = Object.entries( raw as Record<string, unknown> );

        if ( entries.length > 0 && entries.every( ( [ , value ] ) => typeof value === 'string' && value.length > 0 ) )
        {
            spacingValues.push( { value: raw as Record<string, string>, path } );
            return;
        }
    }

    issues.push( {
        path,
        message: 'Spacing values are design tokens ("md") or breakpoint maps over them ({ "base": "sm", "md": "lg" }), never raw CSS.',
    } );
}

function validateWrapperCommon (
    record: Record<string, unknown>,
    path: string,
    issues: SchemaIssue[],
    slugs: Map<string, string>,
    spacingValues: CollectedTokenValue[],
): void
{
    if ( record.size !== undefined )
    {
        const size = record.size;
        const validFraction = typeof size === 'string' && sizeFractionShape.test( size );
        const validGrow = typeof size === 'number' && Number.isFinite( size ) && size > 0;

        if ( !validFraction && !validGrow )
        {
            issues.push( {
                path: `${path}.size`,
                message: 'A block size is a fraction string like "1/3" or a positive flex-grow number.',
            } );
        }
    }

    if ( record.hidden !== undefined && typeof record.hidden !== 'boolean' )
    {
        issues.push( { path: `${path}.hidden`, message: '"hidden" is a boolean; the block persists and is omitted from compilation.' } );
    }

    if ( record.slug !== undefined )
    {
        if ( typeof record.slug !== 'string' || !slugShape.test( record.slug ) )
        {
            issues.push( { path: `${path}.slug`, message: 'A slug is lowercase words joined by hyphens, like "hero" or "contact-form".' } );
        }
        else if ( slugs.has( record.slug ) )
        {
            issues.push( {
                path: `${path}.slug`,
                message: `Duplicate slug "${record.slug}" (also at ${slugs.get( record.slug )}). Slugs are stable handles, so each must be unique within its page.`,
            } );
        }
        else { slugs.set( record.slug, path ); }
    }

    for ( const spacingKey of [ 'spaceBefore', 'spaceAfter', 'pull' ] as const )
    {
        if ( record[ spacingKey ] !== undefined )
        {
            validateTokenValue( record[ spacingKey ], `${path}.${spacingKey}`, issues, spacingValues );
        }
    }
}

function validateSection (
    raw: unknown,
    path: string,
    issues: SchemaIssue[],
    spacingValues: CollectedTokenValue[],
): void
{
    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: '"section" is an object of layout properties; sections are always explicit objects.' } );
        return;
    }

    const record = raw as Record<string, unknown>;

    for ( const key of Object.keys( record ) )
    {
        if ( !sectionPropertyKeys.includes( key ) )
        {
            issues.push( {
                path: `${path}.${key}`,
                message: `Unknown section property "${key}".${suggestNearest( key, sectionPropertyKeys )} Sections own arrangement: ${sectionPropertyKeys.join( ', ' )}. Margin does not exist in Casomer.`,
            } );
        }
    }

    for ( const spacingKey of [ 'gap', 'padding' ] as const )
    {
        if ( record[ spacingKey ] !== undefined )
        {
            validateTokenValue( record[ spacingKey ], `${path}.${spacingKey}`, issues, spacingValues );
        }
    }

    if ( record.wrap !== undefined && typeof record.wrap !== 'boolean' )
    {
        issues.push( { path: `${path}.wrap`, message: '"wrap" is a boolean.' } );
    }

    // Section width overrides the theme's content width for this
    // section's content (SCHEMA section 11.8); the token's existence
    // in theme.widths is checked with the other token references.
    if ( record.width !== undefined && typeof record.width !== 'string' )
    {
        issues.push( { path: `${path}.width`, message: '"width" is a widths token name.' } );
    }

    if ( record.direction !== undefined && ( typeof record.direction !== 'string' || !directions.includes( record.direction ) ) )
    {
        issues.push( {
            path: `${path}.direction`,
            message: `"direction" overrides the nesting alternation and is one of: ${directions.join( ', ' )}.`,
        } );
    }

    if ( record.minHeight !== undefined && ( typeof record.minHeight !== 'string' || !minHeightPresets.includes( record.minHeight ) ) )
    {
        issues.push( {
            path: `${path}.minHeight`,
            message: `"minHeight" is a viewport preset: ${minHeightPresets.join( ', ' )}. With "align" it replaces every spacer workaround; there is no spacer component.`,
        } );
    }

    for ( const freeKey of [ 'justify', 'align' ] as const )
    {
        if ( record[ freeKey ] !== undefined && ( typeof record[ freeKey ] !== 'string' || record[ freeKey ] === '' ) )
        {
            issues.push( { path: `${path}.${freeKey}`, message: `"${freeKey}" is a non-empty string.` } );
        }
    }
}

function validateBlock (
    raw: unknown,
    path: string,
    issues: SchemaIssue[],
    slugs: Map<string, string>,
    references: CollectedReference[],
    spacingValues: CollectedTokenValue[],
    repeatSources: { collection: string; path: string }[],
): void
{
    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A block is an object: a component instance or a section.' } );
        return;
    }

    const record = raw as Record<string, unknown>;
    const isComponent = record.component !== undefined;
    const isSection = record.section !== undefined;
    const isRepeat = record.repeat !== undefined;
    const isPartial = record.partial !== undefined;

    if ( [ isComponent, isSection, isRepeat, isPartial ].filter( Boolean ).length !== 1 )
    {
        issues.push( {
            path,
            message: 'A block is exactly one of a component instance ({ "component", "props" }), a section ({ "section", "blocks" }), a repeat ({ "repeat" }), or a partial ({ "partial": "<name>" }, SCHEMA 12.5).',
        } );
        return;
    }

    const allowedKeys = isComponent
        ? componentBlockKeys
        : ( isRepeat ? repeatBlockKeys : ( isPartial ? partialBlockKeys : sectionBlockKeys ) );

    for ( const key of Object.keys( record ) )
    {
        if ( !allowedKeys.includes( key ) )
        {
            issues.push( {
                path: `${path}.${key}`,
                message: `Unknown block key "${key}".${suggestNearest( key, allowedKeys )} Layout lives on wrappers and sections, never in component props.`,
            } );
        }
    }

    validateWrapperCommon( record, path, issues, slugs, spacingValues );

    // A partial block inserts a named site partial (SCHEMA 12.5);
    // existence is checked by the loader, which knows the config.
    if ( isPartial )
    {
        if ( typeof record.partial !== 'string' || !/^[a-z][a-z0-9-]*$/.test( record.partial ) )
        {
            issues.push( { path: `${path}.partial`, message: '"partial" names a site partial: lowercase, digits, hyphens.' } );
        }

        return;
    }

    if ( isComponent )
    {
        if ( typeof record.component !== 'string' )
        {
            issues.push( { path: `${path}.component`, message: '"component" is a "package/id" reference string.' } );
        }
        else
        {
            try
            {
                parseComponentReference( record.component );
                references.push( { reference: record.component, path: `${path}.component` } );
            }
            catch ( error )
            {
                if ( error instanceof ComponentReferenceError )
                {
                    issues.push( { path: `${path}.component`, message: error.message } );
                }
                else { throw error; }
            }
        }

        if ( record.props !== undefined && ( record.props === null || typeof record.props !== 'object' || Array.isArray( record.props ) ) )
        {
            issues.push( { path: `${path}.props`, message: '"props" is an object of field values.' } );
        }

        // A morph link (SCHEMA 6): a token-shaped name, leading
        // letter - it becomes a view-transition-name at compile.
        if ( record.morph !== undefined && ( typeof record.morph !== 'string' || !morphShape.test( record.morph ) ) )
        {
            issues.push( { path: `${path}.morph`, message: '"morph" is a lowercase name starting with a letter, like "hero". The same name on another page pairs the two blocks\' anchors for the transition.' } );
        }

        return;
    }

    // Repetition is arrangement, never a special component (13.5): a
    // repeat names its source, the component each item renders
    // through, and props whose values may be { "$bind": "entry.x" }.
    if ( isRepeat )
    {
        const repeat = record.repeat;

        if ( repeat === null || typeof repeat !== 'object' || Array.isArray( repeat ) )
        {
            issues.push( { path: `${path}.repeat`, message: '"repeat" is an object: { "source", "component", "props" }.' } );
            return;
        }

        const repeatRecord = repeat as Record<string, unknown>;

        for ( const key of Object.keys( repeatRecord ) )
        {
            if ( !repeatKeys.includes( key ) )
            {
                issues.push( { path: `${path}.repeat.${key}`, message: `Unknown repeat key "${key}".${suggestNearest( key, repeatKeys )}` } );
            }
        }

        const source = repeatRecord.source;

        if ( source === null || typeof source !== 'object' || Array.isArray( source ) )
        {
            issues.push( { path: `${path}.repeat.source`, message: '"source" is an object naming a collection or curating entries.' } );
        }
        else
        {
            const sourceRecord = source as Record<string, unknown>;

            for ( const key of Object.keys( sourceRecord ) )
            {
                if ( !repeatSourceKeys.includes( key ) )
                {
                    issues.push( { path: `${path}.repeat.source.${key}`, message: `Unknown source key "${key}".${suggestNearest( key, repeatSourceKeys )}` } );
                }
            }

            const hasCollection = sourceRecord.collection !== undefined;
            const hasCurated = sourceRecord.entries !== undefined;
            const hasMenu = sourceRecord.menu !== undefined;
            const hasTaxonomy = sourceRecord.taxonomy !== undefined;

            if ( sourceRecord.term !== undefined && sourceRecord.term !== 'current' )
            {
                issues.push( { path: `${path}.repeat.source.term`, message: '"term" takes exactly "current": the entries classified under the term page being rendered (SCHEMA 13.3).' } );
            }

            if ( [ hasCollection, hasCurated, hasMenu, hasTaxonomy ].filter( Boolean ).length !== 1 )
            {
                issues.push( { path: `${path}.repeat.source`, message: 'A source is exactly one of { "collection" }, { "entries" }, { "menu" }, or { "taxonomy" }.' } );
            }

            if ( hasMenu && ( typeof sourceRecord.menu !== 'string' || sourceRecord.menu === '' ) )
            {
                issues.push( { path: `${path}.repeat.source.menu`, message: '"menu" names a site menu by its key.' } );
            }

            if ( hasTaxonomy && ( typeof sourceRecord.taxonomy !== 'string' || sourceRecord.taxonomy === '' ) )
            {
                issues.push( { path: `${path}.repeat.source.taxonomy`, message: '"taxonomy" names a taxonomy file, without its .json.' } );
            }

            if ( hasCollection )
            {
                if ( typeof sourceRecord.collection !== 'string' || sourceRecord.collection === '' )
                {
                    issues.push( { path: `${path}.repeat.source.collection`, message: '"collection" names a collection file, without its .json.' } );
                }
                else { repeatSources.push( { collection: sourceRecord.collection, path: `${path}.repeat.source.collection` } ); }
            }

            if ( hasCurated && ( !Array.isArray( sourceRecord.entries ) || sourceRecord.entries.some( ( id ) => typeof id !== 'string' ) ) )
            {
                issues.push( { path: `${path}.repeat.source.entries`, message: '"entries" is an array of entry ids, in display order.' } );
            }

            if ( sourceRecord.order !== undefined && ( typeof sourceRecord.order !== 'string' || !orderShape.test( sourceRecord.order ) ) )
            {
                issues.push( { path: `${path}.repeat.source.order`, message: '"order" is a signed entry path, like "-entry.eventDate".' } );
            }

            // "filter" narrows a collection query with the SAME
            // expression grammar conditions use (SCHEMA 3.1): field
            // keys as identifiers - 'featured && type == "talk"'.
            if ( sourceRecord.filter !== undefined )
            {
                if ( !hasCollection || typeof sourceRecord.filter !== 'string' || sourceRecord.filter === '' )
                {
                    issues.push( { path: `${path}.repeat.source.filter`, message: '"filter" is an expression string on a collection source, like "featured == true".' } );
                }
                else
                {
                    try { parseExpression( sourceRecord.filter ); }
                    catch ( error )
                    {
                        issues.push( { path: `${path}.repeat.source.filter`, message: `The filter does not parse: ${( error as Error ).message}` } );
                    }
                }
            }

            if ( sourceRecord.limit !== undefined && ( typeof sourceRecord.limit !== 'number' || !Number.isInteger( sourceRecord.limit ) || sourceRecord.limit < 1 ) )
            {
                issues.push( { path: `${path}.repeat.source.limit`, message: '"limit" is a positive whole number.' } );
            }
        }

        // The empty state (SCHEMA 13.5): author-owned markdown shown
        // when the repeat matches nothing - never invented content.
        if ( repeatRecord.empty !== undefined && typeof repeatRecord.empty !== 'string' )
        {
            issues.push( { path: `${path}.repeat.empty`, message: '"empty" is a markdown string shown when the repeat matches nothing.' } );
        }

        if ( typeof repeatRecord.component !== 'string' )
        {
            issues.push( { path: `${path}.repeat.component`, message: '"component" is a "package/id" reference string.' } );
        }
        else
        {
            try
            {
                parseComponentReference( repeatRecord.component );
                references.push( { reference: repeatRecord.component, path: `${path}.repeat.component` } );
            }
            catch ( error )
            {
                if ( error instanceof ComponentReferenceError )
                {
                    issues.push( { path: `${path}.repeat.component`, message: error.message } );
                }
                else { throw error; }
            }
        }

        if ( repeatRecord.props !== undefined )
        {
            if ( repeatRecord.props === null || typeof repeatRecord.props !== 'object' || Array.isArray( repeatRecord.props ) )
            {
                issues.push( { path: `${path}.repeat.props`, message: '"props" is an object; values may be literals or { "$bind": "entry.field" }.' } );
            }
            else
            {
                for ( const [ propKey, propValue ] of Object.entries( repeatRecord.props as Record<string, unknown> ) )
                {
                    const bind = ( propValue as Record<string, unknown> | null )?.$bind;

                    if ( bind !== undefined && ( typeof bind !== 'string' || !bindPathShape.test( bind ) ) )
                    {
                        issues.push( { path: `${path}.repeat.props.${propKey}.$bind`, message: '"$bind" is an entry path, like "entry.title".' } );
                    }
                }
            }
        }

        return;
    }

    validateSection( record.section, `${path}.section`, issues, spacingValues );

    if ( !Array.isArray( record.blocks ) )
    {
        issues.push( { path: `${path}.blocks`, message: 'A section block arranges child blocks under "blocks".' } );
        return;
    }

    for ( const [ index, child ] of record.blocks.entries() )
    {
        validateBlock( child, `${path}.blocks[${index}]`, issues, slugs, references, spacingValues, repeatSources );
    }
}

export function analyzeBlocks ( raw: unknown, path: string, issues: SchemaIssue[] ): BlocksAnalysis
{
    const references: CollectedReference[] = [];
    const spacingValues: CollectedTokenValue[] = [];
    const repeatSources: { collection: string; path: string }[] = [];
    const slugs = new Map<string, string>();

    if ( !Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A page\'s content is a "blocks" array; the page is the root section.' } );
        return { references, spacingValues, repeatSources };
    }

    for ( const [ index, block ] of raw.entries() )
    {
        validateBlock( block, `${path}[${index}]`, issues, slugs, references, spacingValues, repeatSources );
    }

    return { references, spacingValues, repeatSources };
}
