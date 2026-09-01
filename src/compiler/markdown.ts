// The markdown pipeline, from SCHEMA appendix A: parsed at build time,
// so the delivered site contains HTML only. Parsing is micromark by way
// of mdast-util-from-markdown; rendering is our own walk over the AST,
// which is what makes the output sanitized by construction: raw HTML
// nodes are dropped, unknown nodes are dropped, and only the safe tag
// set below can ever be emitted. Headings are relative (SCHEMA section
// 8): the compiler assigns real levels from a base the page decides,
// distinct source depths become consecutive levels (never skipping),
// and a lower-ranked heading written above the primary compiles to a
// kicker paragraph, invisible to the outline.
//
// The dialect is CommonMark plus the GFM content features: tables,
// strikethrough, and autolink literals. Because sanitization removed
// raw HTML, the dialect must cover real content needs itself; a table
// has no other path. Task lists and footnotes are deliberately not
// loaded, so their syntax stays visible as literal text instead of
// parsing into nodes that would vanish silently.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { Node, Parent, Heading, Code, Image, Table, TableRow } from 'mdast';

export interface OutlineEntry
{
    readonly level: number;
    readonly text: string;
}

export interface CompiledMarkdown
{
    readonly html: string;
    readonly outline: readonly OutlineEntry[];
}

export interface MarkdownHeadingShape
{
    readonly hasHeadings: boolean;
    readonly headingCount: number;
}

const safeLinkPattern = /^(https?:|mailto:|\/|\.\/|\.\.\/|#)/i;

function parseMarkdown ( source: string ): Parent
{
    return fromMarkdown( source, {
        extensions: [ gfmTable(), gfmStrikethrough(), gfmAutolinkLiteral() ],
        mdastExtensions: [ gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmAutolinkLiteralFromMarkdown() ],
    } );
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

function plainTextOf ( node: Node ): string
{
    if ( node.type === 'text' || node.type === 'inlineCode' )
    {
        return ( node as unknown as { value: string } ).value;
    }

    const children = ( node as Partial<Parent> ).children;

    return children === undefined ? '' : children.map( plainTextOf ).join( '' );
}

// The primary heading is the largest-ranked one; anything lower-ranked
// written above it is decoration, not structure (SCHEMA section 8.4).
interface HeadingPlan
{
    readonly kickers: ReadonlySet<Heading>;
    readonly levelByDepth: ReadonlyMap<number, number>;
}

function planHeadings ( headings: readonly Heading[], baseLevel: number ): HeadingPlan
{
    const kickers = new Set<Heading>();
    const levelByDepth = new Map<number, number>();

    if ( headings.length === 0 ) { return { kickers, levelByDepth }; }

    const minimumDepth = Math.min( ...headings.map( ( heading ) => heading.depth ) );

    for ( const heading of headings )
    {
        if ( heading.depth === minimumDepth ) { break; }

        kickers.add( heading );
    }

    const structuralDepths = [ ...new Set(
        headings.filter( ( heading ) => !kickers.has( heading ) ).map( ( heading ) => heading.depth ),
    ) ].sort( ( a, b ) => a - b );

    for ( const [ rank, depth ] of structuralDepths.entries() )
    {
        levelByDepth.set( depth, Math.min( baseLevel + rank, 6 ) );
    }

    return { kickers, levelByDepth };
}

function collectHeadings ( root: Parent ): Heading[]
{
    const headings: Heading[] = [];

    const visit = ( node: Node ): void =>
    {
        if ( node.type === 'heading' ) { headings.push( node as Heading ); }

        for ( const child of ( node as Partial<Parent> ).children ?? [] ) { visit( child ); }
    };

    visit( root );
    return headings;
}

interface RenderContext
{
    readonly plan: HeadingPlan;
    readonly outline: OutlineEntry[];
}

function renderChildren ( node: Partial<Parent>, context: RenderContext ): string
{
    return ( node.children ?? [] ).map( ( child ) => renderNode( child, context ) ).join( '' );
}

function renderTable ( table: Table, context: RenderContext ): string
{
    const alignments = table.align ?? [];

    const renderRow = ( row: TableRow, cellTag: 'th' | 'td' ): string =>
    {
        const cells = row.children.map( ( cell, index ) =>
        {
            const alignment = alignments[ index ];
            const styleAttribute = alignment === undefined || alignment === null
                ? ''
                : ` style="text-align: ${alignment}"`;

            return `<${cellTag}${styleAttribute}>${renderChildren( cell, context )}</${cellTag}>`;
        } );

        return `<tr>${cells.join( '' )}</tr>\n`;
    };

    const [ headerRow, ...bodyRows ] = table.children;
    const head = headerRow === undefined ? '' : `<thead>\n${renderRow( headerRow, 'th' )}</thead>\n`;
    const body = bodyRows.length === 0 ? '' : `<tbody>\n${bodyRows.map( ( row ) => renderRow( row, 'td' ) ).join( '' )}</tbody>\n`;

    return `<table>\n${head}${body}</table>\n`;
}

function renderNode ( node: Node, context: RenderContext ): string
{
    switch ( node.type )
    {
        case 'paragraph': return `<p>${renderChildren( node as Parent, context )}</p>\n`;

        case 'heading':
        {
            const heading = node as Heading;
            const inner = renderChildren( heading, context );

            if ( context.plan.kickers.has( heading ) )
            {
                return `<p class="kicker">${inner}</p>\n`;
            }

            const level = context.plan.levelByDepth.get( heading.depth ) ?? 6;

            // Semantics from the plan, looks from the author (SCHEMA
            // 8, Mikey): a lone "####" compiles to the block's lead
            // level but wears .h4, so the outline is honest and the
            // size is the one the author chose.
            const visual = heading.depth === level ? '' : ` class="h${heading.depth}"`;

            context.outline.push( { level, text: plainTextOf( heading ) } );
            return `<h${level}${visual}>${inner}</h${level}>\n`;
        }

        // A single newline is a soft break in CommonMark - rendered
        // as a space - but a person typing one line under another in
        // a CMS means a line break (Mikey's report). Hard-break
        // semantics for soft breaks, the way chat and most editors
        // behave.
        case 'text': return escapeHtml( ( node as unknown as { value: string } ).value ).replace( /\n/g, '<br>\n' );
        case 'emphasis': return `<em>${renderChildren( node as Parent, context )}</em>`;
        case 'strong': return `<strong>${renderChildren( node as Parent, context )}</strong>`;
        case 'delete': return `<del>${renderChildren( node as Parent, context )}</del>`;
        case 'inlineCode': return `<code>${escapeHtml( ( node as unknown as { value: string } ).value )}</code>`;
        case 'break': return '<br>\n';
        case 'thematicBreak': return '<hr>\n';
        case 'blockquote': return `<blockquote>\n${renderChildren( node as Parent, context )}</blockquote>\n`;
        case 'table': return renderTable( node as Table, context );

        case 'list':
        {
            const list = node as Parent & { ordered?: boolean };
            const tag = list.ordered === true ? 'ol' : 'ul';

            return `<${tag}>\n${renderChildren( list, context )}</${tag}>\n`;
        }

        case 'listItem':
        {
            const item = node as Parent & { children: ( Node & Partial<Parent> )[] };
            const inner = item.children
                .map( ( child ) => ( child.type === 'paragraph' ? renderChildren( child, context ) : renderNode( child, context ) ) )
                .join( '' );

            return `<li>${inner}</li>\n`;
        }

        case 'code':
        {
            const code = node as Code;
            const languageClass = typeof code.lang === 'string' && code.lang !== ''
                ? ` class="language-${escapeHtml( code.lang )}"`
                : '';

            return `<pre><code${languageClass}>${escapeHtml( code.value )}\n</code></pre>\n`;
        }

        case 'link':
        {
            const link = node as Parent & { url: string };
            const inner = renderChildren( link, context );

            // An unsafe scheme renders its text and drops the link.
            if ( !safeLinkPattern.test( link.url ) ) { return inner; }

            const external = /^https?:/i.test( link.url );
            const relAttribute = external ? ' rel="noopener"' : '';

            return `<a href="${escapeHtml( link.url )}"${relAttribute}>${inner}</a>`;
        }

        case 'image':
        {
            const image = node as Image;

            if ( !safeLinkPattern.test( image.url ) ) { return ''; }

            // Markdown alt is always present as text; empty compiles to a
            // decorative image. The editor nags about missing alt; the
            // compiler stays lenient with content (SCHEMA section 7).
            return `<img src="${escapeHtml( image.url )}" alt="${escapeHtml( image.alt ?? '' )}">`;
        }

        // Raw HTML is stripped by default: sanitization is the absence
        // of a case, not a filter that can miss.
        case 'html': return '';

        default: return '';
    }
}

export function inspectMarkdownHeadings ( source: string ): MarkdownHeadingShape
{
    const headings = collectHeadings( parseMarkdown( source ) );

    return { hasHeadings: headings.length > 0, headingCount: headings.length };
}

export function compileMarkdown ( source: string, baseLevel = 2 ): CompiledMarkdown
{
    const tree = parseMarkdown( source );
    const context: RenderContext = {
        plan: planHeadings( collectHeadings( tree ), baseLevel ),
        outline: [],
    };
    const html = renderChildren( tree, context );

    return { html, outline: context.outline };
}
