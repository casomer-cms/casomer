// The chrome checker (DEVELOPMENT section 2): static verification for
// Alpine markup, a gate of the same rank as lint. It harvests the real
// component, magic, and directive registrations by importing the app
// module against a stubbed Alpine, instantiates each data factory to
// collect the scope vocabulary (getters included), then parses every
// directive expression with the TypeScript API and verifies:
//
//   1. every expression parses,
//   2. every root identifier resolves to a scope member, loop
//      variable, registered magic, component name, or allowed global,
//   3. every x-component names a template that exists,
//   4. every x-data names a registered component,
//   5. purity: statements in markup are refused; logic lives in
//      factories, never in markup blobs.
//
// Level 2 (committed follow-up): JSDoc-typed factories + synthetic
// per-expression TS so property access typechecks too.
//
// Usage: node tools/alpine-checks.mjs [html-file] [app-module]

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire( import.meta.url );
const ts = require( 'typescript' );

const htmlFile = process.argv[ 2 ] ?? join( process.cwd(), 'studio', 'app', 'index.html' );
const appModule = process.argv[ 3 ] ?? join( process.cwd(), 'studio', 'app', 'app.js' );

// -- 1. Harvest the real registrations by importing the app with stubs.

const components = new Map();
const customDirectives = new Set();
const magics = new Set( [ '$refs', '$el', '$event', '$data', '$store', '$watch', '$dispatch', '$nextTick', '$root', '$id' ] );
const initListeners = [];

globalThis.window = {
    Alpine: {
        data: ( name, factory ) => components.set( name, factory ),
        directive: ( name ) => customDirectives.add( name ),
        magic: ( name ) => magics.add( `$${name}` ),
        initTree: () => {},
        plugin: () => {},
    },
    addEventListener: () => {},
    __previewLatencies: [],
};
globalThis.document = {
    addEventListener: ( name, listener ) =>
    {
        if ( name === 'alpine:init' ) { initListeners.push( listener ); }
    },
    getElementById: () => undefined,
};
globalThis.performance = globalThis.performance ?? { now: () => 0 };

await import( pathToFileURL( appModule ).href );
for ( const listener of initListeners ) { listener(); }

const scopeMembers = new Set();

for ( const factory of components.values() )
{
    const instance = factory.call( {}, {}, {}, {} );

    for ( const name of Object.getOwnPropertyNames( instance ) ) { scopeMembers.add( name ); }
}

const globals = new Set( [ 'JSON', 'Object', 'Math', 'Array', 'String', 'Number', 'Boolean', 'performance', 'window', 'structuredClone', 'Alpine', 'undefined', 'navigator' ] );

// -- 2. Walk the markup.

const html = await readFile( htmlFile, 'utf8' );
const lineOf = ( index ) => html.slice( 0, index ).split( '\n' ).length;

const templateIds = new Set( [ ...html.matchAll( /<template id="([^"]+)"/g ) ].map( ( match ) => match[ 1 ] ) );
const problems = [];

const expressionAttributes = /\s(x-data|x-show|x-if|x-text|x-effect|x-model|x-for|x-component|:[a-z-]+|@[a-z.]+)="([^"]*)"/g;
const loopVariables = new Set();

for ( const match of html.matchAll( expressionAttributes ) )
{
    if ( match[ 1 ] === 'x-for' )
    {
        const forShape = /^\(?\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*\)?\s+in\s+(.+)$/.exec( match[ 2 ] );

        if ( forShape === null )
        {
            problems.push( `line ${lineOf( match.index )}: x-for="${match[ 2 ]}" is not "item in expression" shaped` );
            continue;
        }

        loopVariables.add( forShape[ 1 ] );
        if ( forShape[ 2 ] !== undefined ) { loopVariables.add( forShape[ 2 ] ); }
    }
}

function checkExpression ( raw, line, attribute )
{
    const source = ts.createSourceFile( 'expr.ts', `( ${raw} )`, ts.ScriptTarget.ES2022, true );

    if ( source.parseDiagnostics !== undefined && source.parseDiagnostics.length > 0 )
    {
        problems.push( `line ${line}: ${attribute}="${raw}" does not parse` );
        return;
    }

    const locals = new Set();

    const visit = ( node ) =>
    {
        if ( ts.isArrowFunction( node ) )
        {
            for ( const parameter of node.parameters ) { locals.add( parameter.name.getText( source ) ); }
        }

        if ( ts.isVariableStatement( node ) || ts.isForStatement( node ) || ts.isIfStatement( node ) || ts.isBlock( node ) )
        {
            problems.push( `line ${line}: ${attribute} carries a statement; markup expressions stay pure` );
        }

        if ( ts.isIdentifier( node ) )
        {
            const parent = node.parent;
            const isPropertyName = ( ts.isPropertyAccessExpression( parent ) && parent.name === node )
                || ( ts.isPropertyAssignment( parent ) && parent.name === node );

            if ( !isPropertyName && !locals.has( node.text ) )
            {
                const known = scopeMembers.has( node.text ) || loopVariables.has( node.text )
                    || magics.has( node.text ) || globals.has( node.text ) || components.has( node.text );

                if ( !known )
                {
                    problems.push( `line ${line}: ${attribute} references "${node.text}", which no component, loop, magic, or allowed global provides` );
                }
            }
        }

        ts.forEachChild( node, visit );
    };

    visit( source );
}

for ( const match of html.matchAll( expressionAttributes ) )
{
    const [ , attribute, value ] = match;
    const line = lineOf( match.index );

    if ( attribute === 'x-component' )
    {
        if ( !templateIds.has( value ) ) { problems.push( `line ${line}: x-component="${value}" names no template in this file` ); }
        continue;
    }

    if ( attribute === 'x-data' )
    {
        const name = /^([A-Za-z_$][\w$]*)/.exec( value )?.[ 1 ];

        if ( name !== undefined && !components.has( name ) )
        {
            problems.push( `line ${line}: x-data="${value}" names no registered component` );
        }
    }

    if ( attribute === 'x-for' )
    {
        const forShape = /^\(?\s*[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*)?\s*\)?\s+in\s+(.+)$/.exec( value );

        if ( forShape !== null ) { checkExpression( forShape[ 1 ], line, 'x-for' ); }
        continue;
    }

    checkExpression( value, line, attribute );
}

// -- 3. Report.

const expressionCount = [ ...html.matchAll( expressionAttributes ) ].length;

if ( problems.length === 0 )
{
    console.log( `checks passed: ${expressionCount} directive expressions verified against ${components.size} components (${scopeMembers.size} scope members), ${templateIds.size} templates, ${magics.size} magics` );
}
else
{
    console.error( `checks found ${problems.length} problem${problems.length === 1 ? '' : 's'}:` );
    for ( const problem of problems ) { console.error( `  ${problem}` ); }
    process.exitCode = 1;
}
