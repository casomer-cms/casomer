import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compileMarkdown, inspectMarkdownHeadings } from './markdown.ts';

describe( 'compileMarkdown', () =>
{
    it( 'renders CommonMark structure: paragraphs, emphasis, lists, quotes, rules', () =>
    {
        const { html } = compileMarkdown(
            'Some *emphasis* and **strength** and `code`.\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---\n',
        );

        assert.ok( html.includes( '<p>Some <em>emphasis</em> and <strong>strength</strong> and <code>code</code>.</p>' ) );
        assert.ok( html.includes( '<ul>\n<li>one</li>\n<li>two</li>\n</ul>' ) );
        assert.ok( html.includes( '<ol>\n<li>first</li>\n</ol>' ) );
        assert.ok( html.includes( '<blockquote>\n<p>quoted</p>\n</blockquote>' ) );
        assert.ok( html.includes( '<hr>' ) );
    } );

    it( 'treats a single newline as a line break, not a space', () =>
    {
        const { html } = compileMarkdown( 'first line\nsecond line\n\nnew paragraph', 2 );

        assert.match( html, /first line<br>\nsecond line/ );
        assert.equal( ( html.match( /<p>/g ) ?? [] ).length, 2 );
    } );

    it( 'strips raw HTML, block and inline, by construction', () =>
    {
        const { html } = compileMarkdown( '<script>alert(1)</script>\n\nSafe <em>inline</em> text.\n' );

        assert.ok( !html.includes( '<script' ) );
        assert.ok( !html.includes( 'alert' ) );
        assert.ok( html.includes( 'Safe' ) );
        assert.ok( !html.includes( '<em>inline</em>' ) );
    } );

    it( 'escapes text content and code blocks', () =>
    {
        const { html } = compileMarkdown( 'a < b & c\n\n```html\n<div>\n```\n' );

        assert.ok( html.includes( '<p>a &lt; b &amp; c</p>' ) );
        assert.ok( html.includes( '<pre><code class="language-html">&lt;div&gt;\n</code></pre>' ) );
    } );

    it( 'gives external links rel="noopener" and drops unsafe schemes', () =>
    {
        const { html } = compileMarkdown(
            '[out](https://example.com) [in](/about) [bad](javascript:alert(1))',
        );

        assert.ok( html.includes( '<a href="https://example.com" rel="noopener">out</a>' ) );
        assert.ok( html.includes( '<a href="/about">in</a>' ) );
        assert.ok( html.includes( 'bad' ) );
        assert.ok( !html.includes( 'javascript:' ) );
    } );

    it( 'requires image URLs to be safe and compiles empty alt as decorative', () =>
    {
        const { html } = compileMarkdown( '![A photo](/a.jpg) ![](/b.jpg)' );

        assert.ok( html.includes( '<img src="/a.jpg" alt="A photo">' ) );
        assert.ok( html.includes( '<img src="/b.jpg" alt="">' ) );
    } );

    it( 'assigns heading levels from the base, never skipping', () =>
    {
        const { html, outline } = compileMarkdown( '# Title\n\n### Deep\n\n##### Deeper\n', 2 );

        // Levels never skip in the OUTLINE; the authored depth rides
        // along as the visual class where the two disagree (SCHEMA 8:
        // semantics from the page, looks from the author).
        assert.ok( html.includes( '<h2 class="h1">Title</h2>' ) );
        assert.ok( html.includes( '<h3>Deep</h3>' ) );
        assert.ok( html.includes( '<h4 class="h5">Deeper</h4>' ) );
        assert.deepEqual( outline, [
            { level: 2, text: 'Title' },
            { level: 3, text: 'Deep' },
            { level: 4, text: 'Deeper' },
        ] );
    } );

    it( 'compiles a lower-ranked heading above the primary as a kicker, outside the outline', () =>
    {
        const { html, outline } = compileMarkdown( '## Eyebrow\n\n# The Real Title\n\n## Subsection\n', 2 );

        assert.ok( html.includes( '<p class="kicker">Eyebrow</p>' ) );
        assert.ok( html.includes( '<h2 class="h1">The Real Title</h2>' ) );
        assert.ok( html.includes( '<h3 class="h2">Subsection</h3>' ) );
        assert.deepEqual( outline.map( ( entry ) => entry.text ), [ 'The Real Title', 'Subsection' ] );
    } );

    it( 'resolves kickers by position at any rank pair, not just h2-over-h1', () =>
    {
        // Mikey's check: an h3 above an h2 (or an h6 above an h4)
        // kickers the SMALLER heading; the larger one is the primary
        // and becomes the scope's lead. Rank is relative, position
        // decides.
        const overH2 = compileMarkdown( '### Eyebrow\n\n## Title\n', 2 );

        assert.ok( overH2.html.includes( '<p class="kicker">Eyebrow</p>' ) );
        assert.ok( overH2.html.includes( '<h2>Title</h2>' ), 'the h2 primary is the lead, visually h2 as authored' );
        assert.deepEqual( overH2.outline.map( ( entry ) => entry.text ), [ 'Title' ] );

        const overH4 = compileMarkdown( '###### Eyebrow\n\n#### Title\n', 2 );

        assert.ok( overH4.html.includes( '<p class="kicker">Eyebrow</p>' ) );
        assert.ok( overH4.html.includes( '<h2 class="h4">Title</h2>' ), 'the h4 primary leads the scope, styled as the authored h4' );
    } );

    it( 'keeps multiple primary-rank headings as siblings', () =>
    {
        const { html } = compileMarkdown( '# One\n\n# Two\n', 2 );

        assert.ok( html.includes( '<h2 class="h1">One</h2>' ) );
        assert.ok( html.includes( '<h2 class="h1">Two</h2>' ) );
    } );

    it( 'caps assigned levels at h6', () =>
    {
        const { html } = compileMarkdown( '# A\n\n## B\n', 6 );

        assert.ok( html.includes( '<h6 class="h1">A</h6>' ) );
        assert.ok( html.includes( '<h6 class="h2">B</h6>' ) );
    } );
} );

describe( 'inspectMarkdownHeadings', () =>
{
    it( 'reports heading presence for the page-level resolver', () =>
    {
        assert.deepEqual( inspectMarkdownHeadings( 'Just prose.' ), { hasHeadings: false, headingCount: 0 } );
        assert.deepEqual( inspectMarkdownHeadings( '# A\n\n## B' ), { hasHeadings: true, headingCount: 2 } );
    } );
} );

describe( 'the GFM content features', () =>
{
    it( 'renders tables with header, body, and alignment', () =>
    {
        const { html } = compileMarkdown( '| Name | Count |\n|:-----|------:|\n| a | 1 |\n| b | 2 |\n' );

        assert.ok( html.includes( '<table>' ) );
        assert.ok( html.includes( '<thead>\n<tr><th style="text-align: left">Name</th><th style="text-align: right">Count</th></tr>\n</thead>' ) );
        assert.ok( html.includes( '<tbody>\n<tr><td style="text-align: left">a</td><td style="text-align: right">1</td></tr>' ) );
    } );

    it( 'renders strikethrough as del', () =>
    {
        const { html } = compileMarkdown( 'It is ~~gone~~ done.' );

        assert.ok( html.includes( 'It is <del>gone</del> done.' ) );
    } );

    it( 'links bare URLs with the external link rules', () =>
    {
        const { html } = compileMarkdown( 'Visit https://example.com today.' );

        assert.ok( html.includes( '<a href="https://example.com" rel="noopener">https://example.com</a>' ) );
    } );

    it( 'leaves unloaded GFM syntax visible instead of losing it', () =>
    {
        const footnotes = compileMarkdown( 'A claim.[^1]\n\n[^1]: The footnote text.\n' );
        const tasks = compileMarkdown( '- [ ] undone\n- [x] done\n' );

        assert.ok( footnotes.html.includes( '[^1]' ) );
        assert.ok( footnotes.html.includes( 'The footnote text.' ) );
        assert.ok( tasks.html.includes( '<li>[ ] undone</li>' ) );
        assert.ok( tasks.html.includes( '<li>[x] done</li>' ) );
    } );
} );

describe( 'the source map (EDITOR 3.1)', () =>
{
    it( 'marks paragraphs and headings with their content range only when asked', () =>
    {
        const source = '# Title\n\nHello **world**.';
        const mapped = compileMarkdown( source, 2, { sourceMap: true } ).html;
        const plain = compileMarkdown( source, 2 ).html;

        assert.match( mapped, /<h2[^>]*data-casomer-md="2-7">Title<\/h2>/, 'the heading range excludes its marker' );
        assert.match( mapped, /<p data-casomer-md="9-25">Hello <strong>world<\/strong>\.<\/p>/ );
        assert.equal( source.slice( 9, 25 ), 'Hello **world**.' );
        assert.ok( !plain.includes( 'data-casomer-md' ), 'the delivered output never carries it' );
    } );
} );
