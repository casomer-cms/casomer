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
import { resolveRenderPayload, type RenderPayload } from '../resolver/resolvePayload.ts';
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
}

export interface AssembledPage
{
    readonly html: string;
    readonly issues: readonly SchemaIssue[];
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
function compileMarkdownFields ( fields: NormalizedFields, payload: RenderPayload ): RenderPayload
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

// Within a scope, distinct relative levels map onto consecutive real
// levels from the base down, capped at h6. Depth never comes from
// layout, only from the content's own declared subordination.
function remapHeadings ( html: string, baseLevel: number ): string
{
    const levels = headingLevelsIn( html );
    const mapping = new Map( levels.map( ( level, rank ) => [ level, Math.min( baseLevel + rank, 6 ) ] ) );

    return html.replace(
        headingTagPattern,
        ( _match, closer: string, level: string ) => `<${closer}h${mapping.get( Number( level ) ) ?? 6}`,
    );
}

interface Assembler
{
    readonly options: AssembleOptions;
    readonly issues: SchemaIssue[];
    readonly templateCache: Map<string, readonly TemplateNode[]>;
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

    return renderComponentInstance( component, ( block.props ?? {} ) as Record<string, unknown>, assembler.templateCache );
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
}

const justifyClasses: Readonly<Record<string, string>> = {
    start: 'justify-start', center: 'justify-center', end: 'justify-end',
    between: 'justify-between', around: 'justify-around', evenly: 'justify-evenly',
};

const alignClasses: Readonly<Record<string, string>> = {
    start: 'items-start', center: 'items-center', end: 'items-end',
    stretch: 'items-stretch', baseline: 'items-baseline',
};

function sectionClasses ( section: SectionRecord, depth: number ): string[]
{
    // Nesting alternates direction: the page flows vertically, a section
    // lays out horizontally, a section inside a section stacks again.
    const defaultDirection = depth % 2 === 1 ? 'row' : 'column';
    const direction = section.direction ?? defaultDirection;
    const directionClass = direction === 'layer'
        ? 'layer'
        : ( direction === 'row' ? 'flex flex-row' : 'flex flex-col' );

    return [
        directionClass,
        ...( section.wrap === true ? [ 'flex-wrap' ] : [] ),
        ...( section.justify === undefined ? [] : [ justifyClasses[ section.justify ] ?? '' ] ),
        ...( section.align === undefined ? [] : [ alignClasses[ section.align ] ?? '' ] ),
        ...( section.minHeight === undefined ? [] : [ `min-h-${section.minHeight}` ] ),
        ...tokenClasses( 'gap', section.gap ),
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

async function renderBlock (
    assembler: Assembler,
    rawBlock: unknown,
    path: string,
    depth: number,
): Promise<string>
{
    const block = rawBlock as Record<string, unknown>;

    // A hidden block persists in the document and is omitted from
    // compilation entirely (SCHEMA section 11.3); because it is skipped
    // before heading resolution, hiding a block never reshapes levels
    // it no longer participates in.
    if ( block.hidden === true ) { return ''; }

    const slugAttribute = typeof block.slug === 'string' ? ` data-slug="${escapeHtml( block.slug )}"` : '';

    if ( block.component !== undefined )
    {
        const inner = await renderComponentBlock( assembler, block, path );

        return `<div${classAttribute( wrapperClasses( block ) )}${slugAttribute}>\n${inner}</div>\n`;
    }

    const section = ( block.section ?? {} ) as SectionRecord;
    const childBlocks = ( block.blocks ?? [] ) as unknown[];
    const children: string[] = [];

    for ( const [ index, child ] of childBlocks.entries() )
    {
        children.push( await renderBlock( assembler, child, `${path}.blocks[${index}]`, depth + 1 ) );
    }

    const inner = children.join( '' );

    // A section whose scope contains a heading is a <section>; a purely
    // layout section is a <div>, keeping the outline honest (11.7).
    const tag = headingLevelsIn( inner ).length > 0 ? 'section' : 'div';
    const classes = [ ...sectionClasses( section, depth ), ...wrapperClasses( block ) ];

    return `<${tag}${classAttribute( classes )}${slugAttribute}>\n${inner}</${tag}>\n`;
}

export async function assemblePage ( page: PageInput, options: AssembleOptions ): Promise<AssembledPage>
{
    const assembler: Assembler = { options, issues: [], templateCache: new Map() };
    const rhythm = options.config.theme.rhythm;
    const scopes: string[] = [];

    for ( const [ index, block ] of page.blocks.entries() )
    {
        const rendered = await renderBlock( assembler, block, `blocks[${index}]`, 1 );

        // Every top-level block is a heading scope: its first heading
        // becomes h2, subordinate ranks follow consecutively.
        scopes.push( remapHeadings( rendered, 2 ) );
    }

    const generator = options.generatorVersion === undefined
        ? ''
        : `\n    <meta name="generator" content="casomer ${escapeHtml( options.generatorVersion )}">`;

    const mainClasses = classAttribute( [ 'flex', 'flex-col', ...( rhythm === undefined ? [] : [ `gap-${rhythm}` ] ) ] );

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">${generator}
    <title>${escapeHtml( page.title )}</title>
    <link rel="stylesheet" href="/assets/css/main.css">
    <script defer src="/assets/js/alpine.min.js"></script>
    <script type="module" src="/assets/js/casomer-runtime.js"></script>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header style="view-transition-name: casomer-header"></header>
    <main id="main"${mainClasses}>
        <h1>${escapeHtml( page.title )}</h1>
${scopes.join( '' )}    </main>
    <footer style="view-transition-name: casomer-footer"></footer>
</body>
</html>
`;

    return { html, issues: assembler.issues };
}
