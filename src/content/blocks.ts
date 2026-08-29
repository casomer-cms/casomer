// The blocks-and-sections layout grammar of SCHEMA section 11: a page's
// content is a blocks array, each block a wrapper holding a component
// instance or a section. Layout lives on wrappers and sections; margin
// does not exist; spacing values are design tokens or breakpoint maps
// over them. This validates the shape; token existence and breakpoint
// names are cross-checked by the site loader, which knows the theme.

import { suggestNearest } from '../schema/fields.ts';
import { parseComponentReference, ComponentReferenceError, type SchemaIssue } from '../schema/manifest.ts';

export type TokenValue = string | Readonly<Record<string, string>>;

const componentBlockKeys = [ 'component', 'props', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull' ];
const sectionBlockKeys = [ 'section', 'blocks', 'size', 'hidden', 'slug', 'spaceBefore', 'spaceAfter', 'pull' ];
const sectionPropertyKeys = [ 'gap', 'justify', 'align', 'wrap', 'padding', 'direction', 'minHeight' ];

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

    if ( isComponent === isSection )
    {
        issues.push( {
            path,
            message: 'A block is exactly one of a component instance ({ "component", "props" }) or a section ({ "section", "blocks" }).',
        } );
        return;
    }

    const allowedKeys = isComponent ? componentBlockKeys : sectionBlockKeys;

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
        validateBlock( child, `${path}.blocks[${index}]`, issues, slugs, references, spacingValues );
    }
}

export function analyzeBlocks ( raw: unknown, path: string, issues: SchemaIssue[] ): BlocksAnalysis
{
    const references: CollectedReference[] = [];
    const spacingValues: CollectedTokenValue[] = [];
    const slugs = new Map<string, string>();

    if ( !Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A page\'s content is a "blocks" array; the page is the root section.' } );
        return { references, spacingValues };
    }

    for ( const [ index, block ] of raw.entries() )
    {
        validateBlock( block, `${path}[${index}]`, issues, slugs, references, spacingValues );
    }

    return { references, spacingValues };
}
