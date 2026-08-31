import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTemplate, renderTemplate, TemplateSyntaxError } from './template.ts';
import { normalizeFields } from '../schema/fields.ts';
import { normalizeComponentManifest } from '../schema/manifest.ts';
import { resolveRenderPayload } from '../resolver/resolvePayload.ts';

const render = ( template: string, fields: unknown, props: Record<string, unknown> ): string =>
{
    const normalized = normalizeFields( fields );

    return renderTemplate( parseTemplate( template ), resolveRenderPayload( normalized, props ), normalized );
};

describe( 'parseTemplate', () =>
{
    it( 'passes everything outside tags through byte for byte, Alpine included', () =>
    {
        const source = '<div x-data="{ open: false }" x-show="open" @click="open = !open">static</div>';

        assert.equal( render( source, {}, {} ), source );
    } );

    it( 'names the line and column of an unclosed block', () =>
    {
        assert.throws(
            () => parseTemplate( '<p>\n{{#if title}}\n<span>' ),
            ( error: unknown ) =>
                error instanceof TemplateSyntaxError
                && error.message.includes( 'never closed' )
                && error.line === 2 && error.column === 1,
        );
    } );

    it( 'rejects mismatched closers, stray closers, and floating else', () =>
    {
        assert.throws( () => parseTemplate( '{{#if a}}{{/each}}' ), /does not match/ );
        assert.throws( () => parseTemplate( '{{/if}}' ), /closes nothing/ );
        assert.throws( () => parseTemplate( '{{else}}' ), /belongs inside/ );
        assert.throws( () => parseTemplate( '{{#if a}}{{else}}{{else}}{{/if}}' ), /belongs inside/ );
    } );

    it( 'rejects bad paths and bad conditions with guidance', () =>
    {
        assert.throws( () => parseTemplate( '{{ 1bad }}' ), /not a field path/ );
        assert.throws( () => parseTemplate( '{{#if a ==}}x{{/if}}' ), /does not parse/ );
    } );
} );

describe( 'renderTemplate', () =>
{
    it( 'escapes interpolated text fields, HTML-safely for attributes too', () =>
    {
        const output = render( '<h2 title="{{ title }}">{{ title }}</h2>', { title: 'text' }, { title: '<b>"A" & \'B\'</b>' } );

        assert.equal(
            output,
            '<h2 title="&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;">&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;</h2>',
        );
    } );

    it( 'inserts markdown fields as their compiled HTML, unescaped', () =>
    {
        assert.equal(
            render( '<div>{{ body }}</div>', { body: 'markdown' }, { body: '<p>Hi</p>' } ),
            '<div><p>Hi</p></div>',
        );
    } );

    it( 'renders absent values as nothing, never as "undefined"', () =>
    {
        assert.equal( render( '<p>{{ tagline }}</p>', { tagline: 'text' }, {} ), '<p></p>' );
    } );

    it( 'walks dotted paths into image and group fields', () =>
    {
        const fields = {
            photo: 'image!',
            meta: { type: 'group', fields: { author: 'text' } },
        };
        const props = { photo: { src: '/a.jpg', alt: 'A' }, meta: { author: 'Mikey' } };

        assert.equal(
            render( '<img src="{{ photo.src }}" alt="{{ photo.alt }}"><i>{{ meta.author }}</i>', fields, props ),
            '<img src="/a.jpg" alt="A"><i>Mikey</i>',
        );
    } );

    it( 'seeds x-data with the json helper, attribute-safe', () =>
    {
        const output = render(
            '<div x-data="{ count: {{ json count }}, label: {{ json label }} }"></div>',
            { count: 'number', label: 'text' },
            { count: 3, label: 'a "b"' },
        );

        assert.equal( output, '<div x-data="{ count: 3, label: &quot;a \\&quot;b\\&quot;&quot; }"></div>' );
    } );

    it( 'branches if/else on the expression language', () =>
    {
        const fields = { layout: { type: 'select', options: [ 'stacked', 'overlay' ] } };
        const template = '{{#if layout == "overlay"}}<b>o</b>{{else}}<i>s</i>{{/if}}';

        assert.equal( render( template, fields, { layout: 'overlay' } ), '<b>o</b>' );
        assert.equal( render( template, fields, { layout: 'stacked' } ), '<i>s</i>' );
    } );

    it( 'treats a hidden field as absent inside template conditions', () =>
    {
        const fields = {
            layout: { type: 'select', options: [ 'stacked', 'overlay' ] },
            scrim: { type: 'toggle', showWhen: 'layout == "overlay"' },
        };
        const template = '{{#if scrim}}<div class="scrim"></div>{{/if}}';

        assert.equal( render( template, fields, { layout: 'stacked', scrim: true } ), '' );
        assert.equal( render( template, fields, { layout: 'overlay', scrim: true } ), '<div class="scrim"></div>' );
    } );

    it( 'iterates lists with item-scoped fields and nested markdown', () =>
    {
        const fields = {
            faqs: { type: 'list', fields: { question: 'text!', answer: 'markdown!' } },
        };
        const props = {
            faqs: [
                { question: 'A & B?', answer: '<p>Yes</p>' },
                { question: 'C?', answer: '<p>No</p>' },
            ],
        };
        const template = '{{#each faqs}}<dt>{{ question }}</dt><dd>{{ answer }}</dd>{{/each}}';

        assert.equal(
            render( template, fields, props ),
            '<dt>A &amp; B?</dt><dd><p>Yes</p></dd><dt>C?</dt><dd><p>No</p></dd>',
        );
    } );

    it( 'renders each over an absent or empty list as nothing', () =>
    {
        const fields = { faqs: { type: 'list', fields: { question: 'text!' } } };

        assert.equal( render( '{{#each faqs}}x{{/each}}', fields, {} ), '' );
        assert.equal( render( '{{#each faqs}}x{{/each}}', fields, { faqs: [] } ), '' );
    } );
} );

// The section 4 ratification: the fixture card is the deliberately
// gnarly component, rendered end to end through the real manifest,
// resolver, and template from disk.
describe( 'the tedxv2 model, ratified on the fixture card', () =>
{
    it( 'renders the card template with conditions, lists, and Alpine intact', async () =>
    {
        const componentDirectory = fileURLToPath(
            new URL( '../../fixtures/site-basic/fixture-kit/components/card/', import.meta.url ),
        );
        const manifest = normalizeComponentManifest(
            JSON.parse( await readFile( join( componentDirectory, 'casomer.json' ), 'utf8' ) ),
        );
        const template = parseTemplate( await readFile( join( componentDirectory, 'template.html' ), 'utf8' ) );
        const payload = resolveRenderPayload( manifest.fields, {
            title: 'Hello & Co',
            layout: 'overlay',
            scrim: true,
            photo: { src: '/img/a.jpg', alt: 'A photo' },
            faqs: [ { question: 'Q1?', answer: '<p>A1</p>' } ],
        } );
        const output = renderTemplate( template, payload, manifest.fields );

        // Content merged at build time, escaped by schema.
        assert.ok( output.includes( '<h2 data-anchor="title">Hello &amp; Co</h2>' ) );
        assert.ok( output.includes( '<img data-anchor="photo" data-morph="card-photo" src="/img/a.jpg" alt="A photo">' ) );
        assert.ok( output.includes( 'title: &quot;Hello &amp; Co&quot;' ) );
        assert.ok( output.includes( '<dt>Q1?</dt>' ) );
        assert.ok( output.includes( '<dd><p>A1</p></dd>' ) );

        // The overlay branch renders; the else branch does not.
        assert.ok( output.includes( 'class="scrim"' ) );
        assert.ok( !output.includes( 'Stacked layout.' ) );

        // Alpine passes through byte for byte, untouched by the toolchain.
        assert.ok( output.includes( 'x-data="{ open: false, title: &quot;Hello &amp; Co&quot; }"' ) );
        assert.ok( output.includes( '<div class="scrim" x-show="open" x-cloak></div>' ) );
        assert.ok( output.includes( '<button x-on:click="open = !open" x-bind:aria-expanded="open">Details</button>' ) );

        // The width default landed in the payload even though no prop set it.
        assert.equal( payload.width, 'prose' );
    } );
} );
