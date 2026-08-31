// The bounded template grammar of DEVELOPMENT section 4: interpolation,
// if, each, and nothing more, with the if condition reusing the schema's
// expression language. Templates are inert data. Everything outside a
// {{ }} tag, Alpine attributes included, passes through byte for byte:
// the toolchain never parses, interprets, or transforms Alpine. Escaping
// is schema-aware and decided by field type, never by author syntax: a
// markdown field interpolates as its already-compiled HTML; everything
// else is HTML-escaped. The json helper exists so props can seed x-data.

import {
    parseExpression,
    evaluateExpression,
    ExpressionSyntaxError,
    type ExpressionNode,
    type FieldValues,
} from '../schema/expressions.ts';
import { type NormalizedField, type NormalizedFields } from '../schema/fields.ts';
import { type RenderPayload } from '../resolver/resolvePayload.ts';

export class TemplateSyntaxError extends Error
{
    readonly line: number;
    readonly column: number;

    constructor ( message: string, line: number, column: number )
    {
        super( `${message} (line ${line}, column ${column})` );
        this.name = 'TemplateSyntaxError';
        this.line = line;
        this.column = column;
    }
}

export type TemplateNode
    = | { kind: 'text'; text: string }
        | { kind: 'interpolation'; path: readonly string[]; json: boolean }
        | { kind: 'if'; condition: ExpressionNode; source: string; whenTrue: readonly TemplateNode[]; whenFalse: readonly TemplateNode[] }
        | { kind: 'each'; path: readonly string[]; body: readonly TemplateNode[] };

const tagPattern = /\{\{([\s\S]*?)\}\}/g;
const pathShape = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function positionOf ( source: string, offset: number ): { line: number; column: number }
{
    const before = source.slice( 0, offset );
    const line = before.split( '\n' ).length;
    const column = offset - before.lastIndexOf( '\n' );

    return { line, column };
}

interface IfFrame
{
    readonly kind: 'if';
    readonly offset: number;
    readonly condition: ExpressionNode;
    readonly source: string;
    readonly outer: TemplateNode[];
    readonly whenTrue: TemplateNode[];
    whenFalse?: TemplateNode[];
}

interface EachFrame
{
    readonly kind: 'each';
    readonly offset: number;
    readonly path: readonly string[];
    readonly outer: TemplateNode[];
    readonly body: TemplateNode[];
}

type Frame = IfFrame | EachFrame;

export function parseTemplate ( source: string ): readonly TemplateNode[]
{
    const fail = ( message: string, offset: number ): never =>
    {
        const { line, column } = positionOf( source, offset );

        throw new TemplateSyntaxError( message, line, column );
    };

    const parsePath = ( text: string, offset: number ): string[] =>
    {
        if ( !pathShape.test( text ) )
        {
            fail(
                `"${text}" is not a field path. Paths are field keys, dotted into object fields where needed, like "title" or "photo.src".`,
                offset,
            );
        }

        return text.split( '.' );
    };

    const root: TemplateNode[] = [];
    const stack: Frame[] = [];
    let nodes = root;
    let lastIndex = 0;

    for ( const match of source.matchAll( tagPattern ) )
    {
        if ( match.index > lastIndex )
        {
            nodes.push( { kind: 'text', text: source.slice( lastIndex, match.index ) } );
        }

        lastIndex = match.index + match[ 0 ].length;
        const inner = ( match[ 1 ] as string ).trim();
        const offset = match.index;

        if ( inner.startsWith( '#if' ) )
        {
            const conditionSource = inner.slice( 3 ).trim();
            let condition: ExpressionNode;

            try
            {
                condition = parseExpression( conditionSource );
            }
            catch ( error )
            {
                if ( !( error instanceof ExpressionSyntaxError ) ) { throw error; }

                condition = fail( `The condition "${conditionSource}" does not parse: ${error.message}`, offset );
            }

            const frame: IfFrame = { kind: 'if', offset, condition, source: conditionSource, outer: nodes, whenTrue: [] };

            stack.push( frame );
            nodes = frame.whenTrue;
            continue;
        }

        if ( inner === 'else' )
        {
            const top = stack[ stack.length - 1 ];

            if ( top === undefined || top.kind !== 'if' || top.whenFalse !== undefined )
            {
                fail( '{{else}} belongs inside an {{#if}} block, once.', offset );
                continue;
            }

            top.whenFalse = [];
            nodes = top.whenFalse;
            continue;
        }

        if ( inner.startsWith( '#each' ) )
        {
            const frame: EachFrame = { kind: 'each', offset, path: parsePath( inner.slice( 5 ).trim(), offset ), outer: nodes, body: [] };

            stack.push( frame );
            nodes = frame.body;
            continue;
        }

        if ( inner === '/if' || inner === '/each' )
        {
            const expected = inner.slice( 1 );
            const top = stack.pop();

            if ( top === undefined || top.kind !== expected )
            {
                fail(
                    top === undefined
                        ? `{{${inner}}} closes nothing; there is no open block.`
                        : `{{${inner}}} does not match the open {{#${top.kind}}} block.`,
                    offset,
                );
                continue;
            }

            if ( top.kind === 'if' )
            {
                top.outer.push( {
                    kind: 'if',
                    condition: top.condition,
                    source: top.source,
                    whenTrue: top.whenTrue,
                    whenFalse: top.whenFalse ?? [],
                } );
            }
            else
            {
                top.outer.push( { kind: 'each', path: top.path, body: top.body } );
            }

            nodes = top.outer;
            continue;
        }

        if ( inner.startsWith( 'json ' ) )
        {
            nodes.push( { kind: 'interpolation', path: parsePath( inner.slice( 5 ).trim(), offset ), json: true } );
            continue;
        }

        nodes.push( { kind: 'interpolation', path: parsePath( inner, offset ), json: false } );
    }

    if ( stack.length > 0 )
    {
        const top = stack[ stack.length - 1 ] as Frame;
        const { line, column } = positionOf( source, top.offset );

        throw new TemplateSyntaxError( `The {{#${top.kind}}} block is never closed; add {{/${top.kind}}}.`, line, column );
    }

    if ( lastIndex < source.length )
    {
        nodes.push( { kind: 'text', text: source.slice( lastIndex ) } );
    }

    return root;
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

interface Scope
{
    readonly payload: RenderPayload;
    readonly fields: NormalizedFields;
}

function walkPath ( scope: Scope, path: readonly string[] ): { value: unknown; field: NormalizedField | undefined }
{
    let value: unknown = scope.payload;
    let fields: NormalizedFields | undefined = scope.fields;
    let field: NormalizedField | undefined;

    for ( const key of path )
    {
        field = fields?.[ key ];
        value = value !== null && typeof value === 'object' && !Array.isArray( value )
            ? ( value as Record<string, unknown> )[ key ]
            : undefined;

        // Only group fields keep a schema below themselves; an image or
        // file member (photo.src) is a plain scalar with no field entry.
        fields = field?.type === 'group' ? field.fields : undefined;
    }

    return { value, field };
}

// Conditions compare scalars; a present non-scalar reads as its natural
// truthiness (a list with items is true), matching the resolver's view.
function conditionViewOf ( scope: Scope ): FieldValues
{
    const view: Record<string, FieldValues[ string ]> = {};

    for ( const key of Object.keys( scope.fields ) )
    {
        const value = scope.payload[ key ];

        if ( value === undefined || value === null ) { continue; }

        if ( typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' )
        {
            view[ key ] = value;
        }
        else
        {
            view[ key ] = Array.isArray( value ) ? value.length > 0 : true;
        }
    }

    return view;
}

function renderNodes ( nodes: readonly TemplateNode[], scope: Scope, output: string[] ): void
{
    for ( const node of nodes )
    {
        switch ( node.kind )
        {
            case 'text':
                output.push( node.text );
                continue;

            case 'interpolation':
            {
                const { value, field } = walkPath( scope, node.path );

                if ( value === undefined || value === null ) { continue; }

                if ( node.json )
                {
                    output.push( escapeHtml( JSON.stringify( value ) ) );
                    continue;
                }

                if ( typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' ) { continue; }

                const text = String( value );

                // Markdown fields carry compiled, sanitized HTML by the
                // time they reach a template; every other field escapes.
                output.push( field?.type === 'markdown' ? text : escapeHtml( text ) );
                continue;
            }

            case 'if':
                renderNodes(
                    evaluateExpression( node.condition, conditionViewOf( scope ) ) ? node.whenTrue : node.whenFalse,
                    scope,
                    output,
                );
                continue;

            case 'each':
            {
                const { value, field } = walkPath( scope, node.path );

                if ( !Array.isArray( value ) || field?.type !== 'list' ) { continue; }

                for ( const item of value )
                {
                    renderNodes( node.body, { payload: item as RenderPayload, fields: field.fields ?? {} }, output );
                }

                continue;
            }
        }
    }
}

export function renderTemplate (
    nodes: readonly TemplateNode[],
    payload: RenderPayload,
    fields: NormalizedFields,
): string
{
    const output: string[] = [];

    renderNodes( nodes, { payload, fields }, output );
    return output.join( '' );
}
