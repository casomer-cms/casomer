// Site configuration, from SCHEMA section 12: the theme tokens that are
// the site's design vocabulary, and component governance. Validation here
// is structural plus the cross-checks the config can settle on its own
// (rhythm must name a spacing token); blocks-level token usage is checked
// by the site loader against the families validated here.

import { suggestNearest } from '../schema/fields.ts';
import { parseComponentReference, ComponentReferenceError, type SchemaIssue } from '../schema/manifest.ts';

const siteConfigKeys = [ 'casomerSchema', 'theme', 'components', 'use', 'name', 'icon', 'regions', 'menus', 'notFound', 'partials', 'media' ];
const regionNames = [ 'header', 'footer' ];
const menuRecordKeys = [ 'topLevelPages', 'childPages', 'collectionIndexes', 'taxonomyIndexes', 'items' ];
const menuRuleKeys = [ 'topLevelPages', 'childPages', 'collectionIndexes', 'taxonomyIndexes' ] as const;
const menuItemKeys = [ 'page', 'collection', 'taxonomy', 'url', 'label', 'items', 'auto' ];
const menuTargetKeys = [ 'page', 'collection', 'taxonomy', 'url' ] as const;
const themeKeys = [ 'colors', 'widths', 'spacing', 'radius', 'shadows', 'typography', 'breakpoints', 'allowCustomColors', 'rhythm', 'layout', 'text', 'resources' ];
const textElements = [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ];
const layoutKeys = [ 'gutter', 'width' ];
const tokenFamilies = [ 'colors', 'widths', 'spacing', 'radius', 'shadows', 'typography' ] as const;
const governanceKeys = [ 'disabled', 'enabled' ];

export interface SiteTheme
{
    readonly families: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly breakpointNames: readonly string[];
    readonly breakpoints: Readonly<Record<string, number>>;
    readonly spacingTokens: readonly string[];
    readonly allowCustomColors: boolean;
    readonly rhythm?: string;

    // The page's layout contract (SCHEMA section 11.8): the content
    // width every top-level block constrains to, and the horizontal
    // gutter that keeps content off the viewport edges. Both are
    // token references with sensible defaults.
    readonly layout?: { readonly gutter?: string; readonly width?: string };

    // Element typography (SCHEMA 12.1): per-element size and font for
    // p and h1-h6, each font naming a typography family token. Absent
    // elements keep the browser/theme defaults.
    readonly text?: Readonly<Record<string, { readonly size?: string; readonly font?: string }>>;

    // Third-party resources: stylesheet URLs (fonts and the like)
    // every page loads. https only.
    readonly resources?: readonly string[];
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
    readonly declaredUse?: 'personal' | 'commercial';

    // The site's identity (SCHEMA 12.3 neighborhood): a display name
    // that overrides the folder-derived project name and joins every
    // page's document title, and an icon - one square image whose
    // site-relative path feeds the favicon link tags.
    readonly name?: string;
    readonly icon?: string;

    // Regions (SCHEMA 12.5): the persistent chrome - header and
    // footer block lists rendered on every page, outside <main>.
    readonly regions?: { readonly header?: readonly unknown[]; readonly footer?: readonly unknown[] };

    // The user-authored 404 page (Mikey): a block list emitted as
    // /404.html - the static-hosting convention - and served by the
    // preview for unknown addresses. Absent means no 404 page is
    // emitted; nothing is ever scaffolded.
    readonly notFound?: readonly unknown[];

    // User-defined template partials (SCHEMA 12.5, Mikey's vision):
    // named block lists edited once and inserted into pages as
    // { "partial": "<name>" } blocks. Header and footer stay the two
    // well-known names with their own storage; these are the rest of
    // that system.
    readonly partials?: Readonly<Record<string, readonly unknown[]>>;

    // Media metadata and policy (SCHEMA 13.4): labels map UUID
    // filenames to the human names they uploaded as; track governs
    // whether binaries are staged into git (absent = true); maxEdge
    // and quality tune the upload-time optimizer (absent = 2560/80).
    readonly media?: {
        readonly track?: boolean;
        readonly maxEdge?: number;
        readonly quality?: number;
        readonly labels?: Readonly<Record<string, string>>;
    };

    // Menus (SCHEMA 12.5): named records of { topLevelPages, items }.
    // An item targets a page, a public collection index, a public
    // taxonomy index, or a literal URL - or is a label-only group -
    // and any item may nest children under "items". A bare item
    // array is the pre-nesting spelling, read as { items } (Studio
    // saves migrate it).
    readonly menus?: Readonly<Record<string, MenuRecord>>;
}

export interface MenuRecord
{
    // The auto-include rules (SCHEMA 12.5): each materializes rows
    // Studio shows as reorderable AUTO items.
    readonly topLevelPages?: boolean;
    readonly childPages?: boolean;
    readonly collectionIndexes?: boolean;
    readonly taxonomyIndexes?: boolean;
    readonly items: readonly MenuItem[];
}

export interface MenuItem
{
    readonly page?: string;
    readonly collection?: string;
    readonly taxonomy?: string;
    readonly label?: string;
    readonly url?: string;
    readonly items?: readonly MenuItem[];

    // Machine bookkeeping (SCHEMA 12.5): an auto-included item names
    // the rule that materialized it ("topLevelPages"). Auto items are
    // ordinary rows in Studio - reorderable, label-overridable - but
    // they drop SILENTLY when their target stops qualifying, and
    // deleting one offers to turn the rule off instead.
    readonly auto?: string;
}

function validateTokenRecord ( raw: unknown, path: string, issues: SchemaIssue[] ): Record<string, string>
{
    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A token family is an object of token names to values.' } );
        return {};
    }

    const tokens: Record<string, string> = {};

    for ( const [ name, value ] of Object.entries( raw as Record<string, unknown> ) )
    {
        if ( typeof value !== 'string' || value.length === 0 )
        {
            issues.push( { path: `${path}.${name}`, message: 'Token values are non-empty strings.' } );
            continue;
        }

        tokens[ name ] = value;
    }

    return tokens;
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

// Menu items, recursively (SCHEMA 12.5): each is exactly one of a
// page id, a collection stem, a taxonomy stem, or a literal url - or
// none of those with a label, a group heading a nested family. Any
// item may carry children under "items".
function validateMenuItems ( raw: unknown, path: string, issues: SchemaIssue[] ): MenuItem[]
{
    if ( !Array.isArray( raw ) )
    {
        issues.push( { path, message: '"items" is an array of menu items.' } );
        return [];
    }

    const valid: MenuItem[] = [];

    for ( const [ index, entry ] of ( raw as unknown[] ).entries() )
    {
        const itemPath = `${path}[${index}]`;

        if ( entry === null || typeof entry !== 'object' || Array.isArray( entry ) )
        {
            issues.push( { path: itemPath, message: 'A menu item is an object (SCHEMA 12.5).' } );
            continue;
        }

        const item = entry as Record<string, unknown>;

        for ( const key of Object.keys( item ) )
        {
            if ( !menuItemKeys.includes( key ) )
            {
                issues.push( { path: `${itemPath}.${key}`, message: `Unknown menu item key "${key}".${suggestNearest( key, menuItemKeys )}` } );
            }
        }

        const targets = menuTargetKeys.filter( ( key ) => typeof item[ key ] === 'string' && item[ key ] !== '' );
        const label = typeof item.label === 'string' && item.label !== '' ? item.label : undefined;

        if ( targets.length > 1 )
        {
            issues.push( { path: itemPath, message: 'A menu item targets exactly one of "page", "collection", "taxonomy", or "url".' } );
            continue;
        }

        if ( targets.length === 0 && label === undefined )
        {
            issues.push( { path: itemPath, message: 'A menu item targets a "page", "collection", "taxonomy", or "url" - or is a label-only group ("label" plus nested "items").' } );
            continue;
        }

        if ( targets[ 0 ] === 'url' && label === undefined )
        {
            issues.push( { path: itemPath, message: 'A literal menu item needs a "label".' } );
            continue;
        }

        const children = item.items === undefined
            ? undefined
            : validateMenuItems( item.items, `${itemPath}.items`, issues );

        if ( item.auto !== undefined && ( typeof item.auto !== 'string' || item.auto === '' ) )
        {
            issues.push( { path: `${itemPath}.auto`, message: '"auto" names the rule that included this item, like "topLevelPages".' } );
            continue;
        }

        valid.push( {
            ...( targets[ 0 ] === undefined ? {} : { [ targets[ 0 ] ]: item[ targets[ 0 ] ] as string } ),
            ...( label === undefined ? {} : { label } ),
            ...( children === undefined || children.length === 0 ? {} : { items: children } ),
            ...( item.auto === undefined ? {} : { auto: item.auto } ),
        } );
    }

    return valid;
}

export function validateSiteConfig ( raw: unknown, issues: SchemaIssue[] ): SiteConfig
{
    const emptyTheme: SiteTheme = { families: {}, breakpointNames: [], breakpoints: {}, spacingTokens: [], allowCustomColors: false };

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

    // Identity lives in the data, not the filename (SCHEMA section 13.1):
    // a site.json without the key is some other tool's site.json.
    if ( record.casomerSchema !== 1 )
    {
        issues.push( {
            path: 'site.casomerSchema',
            message: `Every Casomer file carries "casomerSchema": 1 (SCHEMA section 13.1); got ${JSON.stringify( record.casomerSchema )}. A newer schema needs a newer Casomer.`,
        } );
    }

    let theme = emptyTheme;

    if ( record.theme === null || typeof record.theme !== 'object' || Array.isArray( record.theme ) )
    {
        issues.push( { path: 'site.theme', message: 'site.json declares the "theme" token families (SCHEMA section 12.1).' } );
    }
    else
    {
        const themeRecord = record.theme as Record<string, unknown>;
        const families: Record<string, Readonly<Record<string, string>>> = {};

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

        // Three color roles are guaranteed on every site (SCHEMA 12.1):
        // the contract that lets any component lean on bg-secondary and
        // fit any palette. Extra named colors are unbounded. "accent"
        // is the canonical third role (renamed from "tertiary", which
        // stays accepted as an alias - both variables emit while it
        // lives, and Studio's theme save migrates the spelling).
        if ( families.colors !== undefined )
        {
            if ( families.colors.accent === undefined && families.colors.tertiary !== undefined )
            {
                families.colors = { ...families.colors, accent: families.colors.tertiary };
            }

            for ( const role of [ 'primary', 'secondary', 'accent' ] )
            {
                if ( families.colors[ role ] === undefined )
                {
                    issues.push( {
                        path: `site.theme.colors.${role}`,
                        message: `Every site's colors include "${role}".${suggestNearest( role, Object.keys( families.colors ) )} The primary/secondary/accent roles are what let components fit any palette.`,
                    } );
                }
            }
        }

        // Element typography: p and h1-h6 only, sizes as non-empty
        // strings, fonts naming a typography token (never "scale").
        let text: Record<string, { size?: string; font?: string }> | undefined;

        if ( themeRecord.text !== undefined )
        {
            if ( themeRecord.text === null || typeof themeRecord.text !== 'object' || Array.isArray( themeRecord.text ) )
            {
                issues.push( { path: 'site.theme.text', message: '"text" is an object of element settings: p, h1-h6.' } );
            }
            else
            {
                text = {};

                for ( const [ element, raw ] of Object.entries( themeRecord.text as Record<string, unknown> ) )
                {
                    if ( !textElements.includes( element ) )
                    {
                        issues.push( { path: `site.theme.text.${element}`, message: `"${element}" is not a text element.${suggestNearest( element, textElements )}` } );
                        continue;
                    }

                    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
                    {
                        issues.push( { path: `site.theme.text.${element}`, message: 'An element setting is an object: { "size", "font" }.' } );
                        continue;
                    }

                    const record = raw as Record<string, unknown>;
                    const entry: { size?: string; font?: string } = {};

                    if ( record.size !== undefined )
                    {
                        if ( typeof record.size === 'string' && record.size.trim() !== '' ) { entry.size = record.size; }
                        else { issues.push( { path: `site.theme.text.${element}.size`, message: '"size" is a CSS length, like "2.25rem".' } ); }
                    }

                    if ( record.font !== undefined )
                    {
                        // A free font-family stack ("Helvetica, Arial,
                        // sans-serif") or a bare typography token name.
                        if ( typeof record.font === 'string' && record.font.trim() !== '' ) { entry.font = record.font; }
                        else { issues.push( { path: `site.theme.text.${element}.font`, message: '"font" is a font-family stack, or a typography token name.' } ); }
                    }

                    text[ element ] = entry;
                }
            }
        }

        // Third-party resources: https stylesheet URLs.
        let resources: string[] | undefined;

        if ( themeRecord.resources !== undefined )
        {
            if ( !Array.isArray( themeRecord.resources ) )
            {
                issues.push( { path: 'site.theme.resources', message: '"resources" is an array of https URLs.' } );
            }
            else
            {
                resources = [];

                for ( const [ index, value ] of ( themeRecord.resources as unknown[] ).entries() )
                {
                    if ( typeof value === 'string' && value.startsWith( 'https://' ) ) { resources.push( value ); }
                    else { issues.push( { path: `site.theme.resources[${index}]`, message: 'A resource is an https:// URL.' } ); }
                }
            }
        }

        const breakpointNames: string[] = [];
        const breakpoints: Record<string, number> = {};

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

                    breakpoints[ name ] = value;
                    breakpointNames.push( name );
                }
            }
        }

        if ( themeRecord.allowCustomColors !== undefined && typeof themeRecord.allowCustomColors !== 'boolean' )
        {
            issues.push( { path: 'site.theme.allowCustomColors', message: '"allowCustomColors" is a boolean; tokens-only is the default state.' } );
        }

        const spacingTokens = Object.keys( families.spacing ?? {} );
        const widthTokens = Object.keys( families.widths ?? {} );
        let layout: { gutter?: string; width?: string } | undefined;

        if ( themeRecord.layout !== undefined )
        {
            if ( themeRecord.layout === null || typeof themeRecord.layout !== 'object' || Array.isArray( themeRecord.layout ) )
            {
                issues.push( { path: 'site.theme.layout', message: '"layout" is an object: { "gutter": <spacing token>, "width": <widths token> }.' } );
            }
            else
            {
                const layoutRecord = themeRecord.layout as Record<string, unknown>;

                for ( const key of Object.keys( layoutRecord ) )
                {
                    if ( !layoutKeys.includes( key ) )
                    {
                        issues.push( { path: `site.theme.layout.${key}`, message: `Unknown layout key "${key}".${suggestNearest( key, layoutKeys )}` } );
                    }
                }

                layout = {};

                if ( layoutRecord.gutter !== undefined )
                {
                    if ( typeof layoutRecord.gutter === 'string' && spacingTokens.includes( layoutRecord.gutter ) )
                    {
                        layout = { ...layout, gutter: layoutRecord.gutter };
                    }
                    else
                    {
                        issues.push( { path: 'site.theme.layout.gutter', message: `"gutter" is a spacing token (${spacingTokens.join( ', ' )}).` } );
                    }
                }

                if ( layoutRecord.width !== undefined )
                {
                    if ( typeof layoutRecord.width === 'string' && widthTokens.includes( layoutRecord.width ) )
                    {
                        layout = { ...layout, width: layoutRecord.width };
                    }
                    else
                    {
                        issues.push( { path: 'site.theme.layout.width', message: `"width" is a widths token (${widthTokens.join( ', ' )}).` } );
                    }
                }
            }
        }

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
            breakpoints,
            spacingTokens,
            allowCustomColors: themeRecord.allowCustomColors === true,
            ...( rhythm === undefined ? {} : { rhythm } ),
            ...( layout === undefined ? {} : { layout } ),
            ...( text === undefined ? {} : { text } ),
            ...( resources === undefined ? {} : { resources } ),
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

    let declaredUse: 'personal' | 'commercial' | undefined;

    if ( record.use !== undefined )
    {
        if ( record.use === 'personal' || record.use === 'commercial' )
        {
            declaredUse = record.use;
        }
        else
        {
            issues.push( { path: 'site.use', message: '"use" declares the site as "personal" or "commercial" (BUSINESS 5.3).' } );
        }
    }

    // Regions: header and footer only, each an array of blocks
    // (block-level scrutiny happens in the site loader, where the
    // packages are known).
    let regions: { header?: readonly unknown[]; footer?: readonly unknown[] } | undefined;

    if ( record.regions !== undefined )
    {
        if ( record.regions === null || typeof record.regions !== 'object' || Array.isArray( record.regions ) )
        {
            issues.push( { path: 'site.regions', message: '"regions" is an object: { "header": [...blocks], "footer": [...blocks] } (SCHEMA 12.5).' } );
        }
        else
        {
            regions = {};

            for ( const [ name, blocks ] of Object.entries( record.regions as Record<string, unknown> ) )
            {
                if ( !regionNames.includes( name ) )
                {
                    issues.push( { path: `site.regions.${name}`, message: `"${name}" is not a region.${suggestNearest( name, regionNames )} Exactly two exist: header and footer.` } );
                    continue;
                }

                if ( !Array.isArray( blocks ) )
                {
                    issues.push( { path: `site.regions.${name}`, message: 'A region is an array of blocks.' } );
                    continue;
                }

                regions = { ...regions, [ name ]: blocks };
            }
        }
    }

    // Menus: named records of { topLevelPages, items }, items nesting
    // freely. A bare array is the pre-nesting spelling of { items }.
    let menus: Record<string, MenuRecord> | undefined;

    if ( record.menus !== undefined )
    {
        if ( record.menus === null || typeof record.menus !== 'object' || Array.isArray( record.menus ) )
        {
            issues.push( { path: 'site.menus', message: '"menus" is an object of named menus (SCHEMA 12.5).' } );
        }
        else
        {
            menus = {};

            for ( const [ name, rawMenu ] of Object.entries( record.menus as Record<string, unknown> ) )
            {
                if ( !/^[a-z][a-z0-9-]*$/.test( name ) )
                {
                    issues.push( { path: `site.menus.${name}`, message: 'A menu name is token shaped: lowercase, digits, hyphens.' } );
                    continue;
                }

                if ( Array.isArray( rawMenu ) )
                {
                    menus[ name ] = { items: validateMenuItems( rawMenu, `site.menus.${name}`, issues ) };
                    continue;
                }

                if ( rawMenu === null || typeof rawMenu !== 'object' )
                {
                    issues.push( { path: `site.menus.${name}`, message: 'A menu is { "topLevelPages", "items" } - or a bare item array.' } );
                    continue;
                }

                const menuRecord = rawMenu as Record<string, unknown>;

                for ( const key of Object.keys( menuRecord ) )
                {
                    if ( !menuRecordKeys.includes( key ) )
                    {
                        issues.push( { path: `site.menus.${name}.${key}`, message: `Unknown menu key "${key}".${suggestNearest( key, menuRecordKeys )}` } );
                    }
                }

                for ( const rule of menuRuleKeys )
                {
                    if ( menuRecord[ rule ] !== undefined && typeof menuRecord[ rule ] !== 'boolean' )
                    {
                        issues.push( { path: `site.menus.${name}.${rule}`, message: `"${rule}" is a boolean auto-include rule.` } );
                    }
                }

                menus[ name ] = {
                    ...Object.fromEntries( menuRuleKeys.filter( ( rule ) => menuRecord[ rule ] === true ).map( ( rule ) => [ rule, true ] ) ),
                    items: validateMenuItems( menuRecord.items ?? [], `site.menus.${name}.items`, issues ),
                };
            }
        }
    }

    let partials: Record<string, readonly unknown[]> | undefined;

    if ( record.partials !== undefined )
    {
        if ( record.partials === null || typeof record.partials !== 'object' || Array.isArray( record.partials ) )
        {
            issues.push( { path: 'site.partials', message: '"partials" is an object of named block lists (SCHEMA 12.5).' } );
        }
        else
        {
            partials = {};

            for ( const [ name, blocks ] of Object.entries( record.partials as Record<string, unknown> ) )
            {
                if ( !/^[a-z][a-z0-9-]*$/.test( name ) || [ 'header', 'footer', 'notFound' ].includes( name ) )
                {
                    issues.push( { path: `site.partials.${name}`, message: 'A partial name is token shaped, and header/footer/notFound are reserved.' } );
                    continue;
                }

                if ( !Array.isArray( blocks ) )
                {
                    issues.push( { path: `site.partials.${name}`, message: 'A partial is an array of blocks.' } );
                    continue;
                }

                partials[ name ] = blocks;
            }
        }
    }

    let notFound: readonly unknown[] | undefined;

    if ( record.notFound !== undefined )
    {
        if ( Array.isArray( record.notFound ) ) { notFound = record.notFound; }
        else { issues.push( { path: 'site.notFound', message: '"notFound" is an array of blocks: the 404 page.' } ); }
    }

    // Media metadata and policy (SCHEMA 13.4): labels are Studio
    // bookkeeping - never emitted, never load-bearing; track and the
    // optimizer settings are the user's media policy.
    let media: SiteConfig[ 'media' ] | undefined;

    if ( record.media !== undefined )
    {
        if ( record.media === null || typeof record.media !== 'object' || Array.isArray( record.media ) )
        {
            issues.push( { path: 'site.media', message: '"media" is an object: { "track"?, "maxEdge"?, "quality"?, "labels"? }.' } );
        }
        else
        {
            const raw = record.media as Record<string, unknown>;
            const mediaKeys = [ 'track', 'maxEdge', 'quality', 'labels' ];

            for ( const key of Object.keys( raw ) )
            {
                if ( !mediaKeys.includes( key ) )
                {
                    issues.push( { path: `site.media.${key}`, message: `Unknown key "${key}".${suggestNearest( key, mediaKeys )} Unknown keys are rejected, not ignored.` } );
                }
            }

            const labels: Record<string, string> = {};

            if ( raw.labels !== undefined )
            {
                if ( raw.labels === null || typeof raw.labels !== 'object' || Array.isArray( raw.labels ) )
                {
                    issues.push( { path: 'site.media.labels', message: '"labels" maps media filenames to their human names.' } );
                }
                else
                {
                    for ( const [ file, label ] of Object.entries( raw.labels as Record<string, unknown> ) )
                    {
                        if ( typeof label !== 'string' )
                        {
                            issues.push( { path: `site.media.labels.${file}`, message: 'A media label is a string.' } );
                            continue;
                        }

                        labels[ file ] = label;
                    }
                }
            }

            if ( raw.track !== undefined && typeof raw.track !== 'boolean' )
            {
                issues.push( { path: 'site.media.track', message: '"track" is true or false: whether git versions the media binaries.' } );
            }

            for ( const bound of [ 'maxEdge', 'quality' ] as const )
            {
                if ( raw[ bound ] !== undefined && ( typeof raw[ bound ] !== 'number' || !Number.isInteger( raw[ bound ] ) || ( raw[ bound ] as number ) < 1 ) )
                {
                    issues.push( { path: `site.media.${bound}`, message: `"${bound}" is a positive whole number.` } );
                }
            }

            media = {
                ...( typeof raw.track === 'boolean' ? { track: raw.track } : {} ),
                ...( typeof raw.maxEdge === 'number' && Number.isInteger( raw.maxEdge ) && raw.maxEdge >= 1 ? { maxEdge: raw.maxEdge } : {} ),
                ...( typeof raw.quality === 'number' && Number.isInteger( raw.quality ) && raw.quality >= 1 ? { quality: raw.quality } : {} ),
                ...( Object.keys( labels ).length === 0 ? {} : { labels } ),
            };
        }
    }

    let siteName: string | undefined;

    if ( record.name !== undefined )
    {
        if ( typeof record.name === 'string' && record.name.trim() !== '' ) { siteName = record.name.trim(); }
        else { issues.push( { path: 'site.name', message: '"name" is the site\'s display name - a non-empty string.' } ); }
    }

    let icon: string | undefined;

    if ( record.icon !== undefined )
    {
        if ( typeof record.icon === 'string' && record.icon.startsWith( '/' ) ) { icon = record.icon; }
        else { issues.push( { path: 'site.icon', message: '"icon" is a site-relative path to a square image, like "/media/icon.png".' } ); }
    }

    return {
        theme,
        governance,
        ...( declaredUse === undefined ? {} : { declaredUse } ),
        ...( siteName === undefined ? {} : { name: siteName } ),
        ...( icon === undefined ? {} : { icon } ),
        ...( regions === undefined ? {} : { regions } ),
        ...( menus === undefined ? {} : { menus } ),
        ...( notFound === undefined ? {} : { notFound } ),
        ...( partials === undefined ? {} : { partials } ),
        ...( media === undefined ? {} : { media } ),
    };
}
