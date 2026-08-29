// Site configuration, from SCHEMA section 12: the theme tokens that are
// the site's design vocabulary, and component governance. Validation here
// is structural plus the cross-checks the config can settle on its own
// (rhythm must name a spacing token); blocks-level token usage is checked
// by the site loader against the families validated here.

import { suggestNearest } from '../schema/fields.ts';
import { parseComponentReference, ComponentReferenceError, type SchemaIssue } from '../schema/manifest.ts';

const siteConfigKeys = [ 'theme', 'components' ];
const themeKeys = [ 'colors', 'widths', 'spacing', 'radius', 'shadows', 'typography', 'breakpoints', 'allowCustomColors', 'rhythm' ];
const tokenFamilies = [ 'colors', 'widths', 'spacing', 'radius', 'shadows', 'typography' ] as const;
const governanceKeys = [ 'disabled', 'enabled' ];

export interface SiteTheme
{
    readonly families: Readonly<Record<string, readonly string[]>>;
    readonly breakpointNames: readonly string[];
    readonly spacingTokens: readonly string[];
    readonly allowCustomColors: boolean;
    readonly rhythm?: string;
}

export interface SiteGovernance
{
    readonly disabled: readonly string[];
    readonly enabled?: readonly string[];
}

export interface SiteConfig
{
    readonly theme: SiteTheme;
    readonly governance: SiteGovernance;
}

function validateTokenRecord ( raw: unknown, path: string, issues: SchemaIssue[] ): string[]
{
    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A token family is an object of token names to values.' } );
        return [];
    }

    const names: string[] = [];

    for ( const [ name, value ] of Object.entries( raw as Record<string, unknown> ) )
    {
        if ( typeof value !== 'string' || value.length === 0 )
        {
            issues.push( { path: `${path}.${name}`, message: 'Token values are non-empty strings.' } );
            continue;
        }

        names.push( name );
    }

    return names;
}

function validateGovernanceList ( raw: unknown, path: string, issues: SchemaIssue[] ): string[]
{
    if ( !Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A governance list is an array of component references or "package/*" wildcards.' } );
        return [];
    }

    const entries: string[] = [];

    for ( const [ index, entry ] of raw.entries() )
    {
        const entryPath = `${path}[${index}]`;

        if ( typeof entry !== 'string' )
        {
            issues.push( { path: entryPath, message: 'Governance entries are strings.' } );
            continue;
        }

        try
        {
            if ( entry.endsWith( '/*' ) )
            {
                // Wildcards disable whole packages; validate the package half
                // by parsing a placeholder id against it.
                parseComponentReference( `${entry.slice( 0, -2 )}/placeholder` );
            }
            else
            {
                parseComponentReference( entry );
            }

            entries.push( entry );
        }
        catch ( error )
        {
            if ( error instanceof ComponentReferenceError )
            {
                issues.push( { path: entryPath, message: error.message } );
            }
            else { throw error; }
        }
    }

    return entries;
}

export function validateSiteConfig ( raw: unknown, issues: SchemaIssue[] ): SiteConfig
{
    const emptyTheme: SiteTheme = { families: {}, breakpointNames: [], spacingTokens: [], allowCustomColors: false };

    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path: 'site', message: 'site.json is a JSON object.' } );
        return { theme: emptyTheme, governance: { disabled: [] } };
    }

    const record = raw as Record<string, unknown>;

    for ( const key of Object.keys( record ) )
    {
        if ( !siteConfigKeys.includes( key ) )
        {
            issues.push( {
                path: `site.${key}`,
                message: `Unknown key "${key}".${suggestNearest( key, siteConfigKeys )} Unknown keys are rejected, not ignored.`,
            } );
        }
    }

    let theme = emptyTheme;

    if ( record.theme === null || typeof record.theme !== 'object' || Array.isArray( record.theme ) )
    {
        issues.push( { path: 'site.theme', message: 'site.json declares the "theme" token families (SCHEMA section 12.1).' } );
    }
    else
    {
        const themeRecord = record.theme as Record<string, unknown>;
        const families: Record<string, readonly string[]> = {};

        for ( const key of Object.keys( themeRecord ) )
        {
            if ( !themeKeys.includes( key ) )
            {
                issues.push( { path: `site.theme.${key}`, message: `Unknown theme key "${key}".${suggestNearest( key, themeKeys )}` } );
            }
        }

        for ( const family of tokenFamilies )
        {
            if ( themeRecord[ family ] !== undefined )
            {
                families[ family ] = validateTokenRecord( themeRecord[ family ], `site.theme.${family}`, issues );
            }
        }

        const breakpointNames: string[] = [];

        if ( themeRecord.breakpoints !== undefined )
        {
            if ( themeRecord.breakpoints === null || typeof themeRecord.breakpoints !== 'object' || Array.isArray( themeRecord.breakpoints ) )
            {
                issues.push( { path: 'site.theme.breakpoints', message: '"breakpoints" is an object of names to pixel numbers.' } );
            }
            else
            {
                for ( const [ name, value ] of Object.entries( themeRecord.breakpoints as Record<string, unknown> ) )
                {
                    if ( typeof value !== 'number' || !Number.isFinite( value ) || value <= 0 )
                    {
                        issues.push( { path: `site.theme.breakpoints.${name}`, message: 'A breakpoint is a positive pixel number.' } );
                        continue;
                    }

                    breakpointNames.push( name );
                }
            }
        }

        if ( themeRecord.allowCustomColors !== undefined && typeof themeRecord.allowCustomColors !== 'boolean' )
        {
            issues.push( { path: 'site.theme.allowCustomColors', message: '"allowCustomColors" is a boolean; tokens-only is the default state.' } );
        }

        const spacingTokens = families.spacing ?? [];
        let rhythm: string | undefined;

        if ( themeRecord.rhythm !== undefined )
        {
            if ( typeof themeRecord.rhythm === 'string' && spacingTokens.includes( themeRecord.rhythm ) )
            {
                rhythm = themeRecord.rhythm;
            }
            else
            {
                issues.push( {
                    path: 'site.theme.rhythm',
                    message: `"rhythm" is a spacing token; ${typeof themeRecord.rhythm === 'string' ? `"${themeRecord.rhythm}" is not in theme.spacing (${spacingTokens.join( ', ' )})` : 'got a non-string'}. One knob sets the vertical rhythm of the whole site.`,
                } );
            }
        }

        theme = {
            families,
            breakpointNames,
            spacingTokens,
            allowCustomColors: themeRecord.allowCustomColors === true,
            ...( rhythm === undefined ? {} : { rhythm } ),
        };
    }

    let governance: SiteGovernance = { disabled: [] };

    if ( record.components !== undefined )
    {
        if ( record.components === null || typeof record.components !== 'object' || Array.isArray( record.components ) )
        {
            issues.push( { path: 'site.components', message: '"components" is the governance object: { "disabled" } or { "enabled" } (SCHEMA section 12.2).' } );
        }
        else
        {
            const governanceRecord = record.components as Record<string, unknown>;

            for ( const key of Object.keys( governanceRecord ) )
            {
                if ( !governanceKeys.includes( key ) )
                {
                    issues.push( { path: `site.components.${key}`, message: `Unknown governance key "${key}".${suggestNearest( key, governanceKeys )}` } );
                }
            }

            const disabled = governanceRecord.disabled === undefined
                ? []
                : validateGovernanceList( governanceRecord.disabled, 'site.components.disabled', issues );
            const enabled = governanceRecord.enabled === undefined
                ? undefined
                : validateGovernanceList( governanceRecord.enabled, 'site.components.enabled', issues );

            governance = { disabled, ...( enabled === undefined ? {} : { enabled } ) };
        }
    }

    return { theme, governance };
}
