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
import { serializeCanonicalJson, type JsonValue } from './canonicalJson.ts';
import { analyzeBlocks, type BlocksAnalysis } from './blocks.ts';
import { validateSiteConfig, type SiteConfig } from './siteConfig.ts';

// The core roster of SCHEMA section 1.1: this small because layout is
// not a component concern, and admission is conservative because it is
// forever.
const coreComponentIds = [ 'markdown', 'image' ];

const pageKeys = [ 'id', 'title', 'slug', 'blocks' ];

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pageSlugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SiteLoadResult
{
    readonly config: SiteConfig;
    readonly pageCount: number;
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

    const siteDocument = await readCanonicalDocument( join( contentDirectory, 'site.json' ), 'site.json', issues );
    const config = validateSiteConfig( siteDocument?.value, issues );

    const pagesDocument = await readCanonicalDocument( join( contentDirectory, 'pages.json' ), 'pages.json', issues );
    let pageCount = 0;

    if ( pagesDocument !== undefined )
    {
        if ( !Array.isArray( pagesDocument.value ) )
        {
            issues.push( { path: 'pages.json', message: 'pages.json is an array of pages.' } );
        }
        else
        {
            const seenIds = new Map<string, string>();
            const seenSlugs = new Map<string, string>();

            for ( const [ index, rawPage ] of pagesDocument.value.entries() )
            {
                const pagePath = `pages[${index}]`;

                if ( rawPage === null || typeof rawPage !== 'object' || Array.isArray( rawPage ) )
                {
                    issues.push( { path: pagePath, message: 'A page is an object with id, title, slug, and blocks.' } );
                    continue;
                }

                pageCount += 1;
                const page = rawPage as Record<string, unknown>;

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
            }
        }
    }

    return { config, pageCount, issues };
}
