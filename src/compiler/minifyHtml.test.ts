import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { minifyHtml } from './minifyHtml.ts';

describe( 'minifyHtml', () =>
{
    it( 'collapses newline runs to a single space, preserving flow semantics', () =>
    {
        const html = '<main>\n    <p>\n        Hello <em>there</em>\n        friend\n    </p>\n</main>\n';

        assert.equal( minifyHtml( html ), '<main><p>Hello <em>there</em> friend</p></main>\n' );
    } );

    it( 'drops whitespace between block tags, keeps it beside inline flow', () =>
    {
        assert.equal(
            minifyHtml( '</head>\n<body>\n    <div>a</div>\n    <section>b</section>\n</body>' ),
            '</head><body><div>a</div><section>b</section></body>\n',
        );
        assert.equal(
            minifyHtml( '<p><em>one</em>\n<em>two</em></p>' ),
            '<p><em>one</em> <em>two</em></p>\n',
            'the space between inline siblings is meaningful and survives',
        );
        assert.equal(
            minifyHtml( '<div><img src="/a.jpg" alt="">\n<img src="/b.jpg" alt=""></div>' ),
            '<div><img src="/a.jpg" alt=""> <img src="/b.jpg" alt=""></div>\n',
        );
    } );

    it( 'never touches pre, textarea, script, or style content', () =>
    {
        const code = '<pre><code class="language-js">const a = 1;\n    const indented = 2;\n</code></pre>';
        const html = `<div>\n    ${code}\n</div>`;

        assert.ok( minifyHtml( html ).includes( code ) );
    } );

    it( 'is idempotent and ends with exactly one newline', () =>
    {
        const html = '<p>\n   a\n</p>\n\n';
        const once = minifyHtml( html );

        assert.equal( minifyHtml( once ), once );
        assert.ok( once.endsWith( '>\n' ) );
    } );

    // Quoted attribute values pass through byte for byte: an Alpine
    // expression keeps its exact whitespace, so line comments and
    // template literals with meaningful newlines survive.
    it( 'never rewrites whitespace inside quoted attribute values', () =>
    {
        const alpine = '<div x-data="{\n    // a comment\n    open: false,\n    msg: `line1\nline2`\n}">x</div>';
        const minified = minifyHtml( alpine );

        assert.ok( minified.includes( '"{\n    // a comment\n    open: false,\n    msg: `line1\nline2`\n}"' ) );
    } );

    it( 'still collapses whitespace between attributes', () =>
    {
        const html = '<div\n    class="a"\n    x-show="open"\n>x</div>';

        assert.equal( minifyHtml( html ), '<div class="a" x-show="open" >x</div>\n' );
    } );

    it( 'handles the other quote style and apostrophes in text', () =>
    {
        const html = '<div x-data=\'{\n  open: false\n}\'>it\'s fine\n</div>';

        assert.ok( minifyHtml( html ).includes( '\'{\n  open: false\n}\'' ) );
        assert.ok( minifyHtml( html ).includes( 'it\'s fine</div>' ) );
    } );
} );
