import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { prettifyHtml } from './prettifyHtml.ts';

describe( 'prettifyHtml', () =>
{
    it( 'repairs ragged indentation instead of preserving it', () =>
    {
        const ragged = '<div>\n    <span>Text here\n</span>\n</div>\n';
        const pretty = prettifyHtml( ragged );

        assert.ok( pretty.includes( '<span>Text here </span>' ) );
        assert.ok( !/[^\n>]\n<\/span>/.test( pretty ) );
    } );

    it( 'indents nesting consistently at four spaces', () =>
    {
        const pretty = prettifyHtml( '<main><section><article><h2>Hi</h2></article></section></main>' );
        const lines = pretty.split( '\n' );
        const indentOf = ( text: string ): number =>
        {
            const line = lines.find( ( candidate ) => candidate.includes( text ) ) ?? '';

            return line.length - line.trimStart().length;
        };

        assert.equal( indentOf( '<section' ), 4 );
        assert.equal( indentOf( '<article' ), 8 );
        assert.equal( indentOf( '<h2' ), 12 );
        assert.equal( indentOf( '<article' ), indentOf( '</article' ) );
    } );

    it( 'preserves pre content exactly', () =>
    {
        const code = '<pre><code>const a = 1;\n    const b = 2;\n</code></pre>';
        const pretty = prettifyHtml( `<div>\n${code}\n</div>` );

        assert.ok( pretty.includes( 'const a = 1;\n    const b = 2;' ) );
    } );

    it( 'is stable: prettifying twice changes nothing', () =>
    {
        const once = prettifyHtml( '<div>\n<p>a</p>\n\n\n<p>b</p></div>' );

        assert.equal( prettifyHtml( once ), once );
    } );
} );
