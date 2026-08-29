import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFields, FieldSchemaError, type SchemaIssue } from './fields.ts';

const issuesFor = ( raw: unknown ): SchemaIssue[] =>
{
    try
    {
        normalizeFields( raw );
        return [];
    }
    catch ( error )
    {
        if ( error instanceof FieldSchemaError ) { return [ ...error.issues ]; }

        throw error;
    }
};

describe( 'shorthand grammar', () =>
{
    it( 'parses type, required flag, and rules with arguments', () =>
    {
        const fields = normalizeFields( { title: 'text! | max:80', count: 'number | min:1 | max:12' } );

        assert.equal( fields.title?.type, 'text' );
        assert.equal( fields.title?.required, true );
        assert.deepEqual( fields.title?.rules, { max: 80 } );
        assert.equal( fields.count?.required, false );
        assert.deepEqual( fields.count?.rules, { min: 1, max: 12 } );
    } );

    it( 'parses flag rules and reference targets', () =>
    {
        const fields = normalizeFields( { count: 'number | integer', author: 'reference | type:post' } );

        assert.deepEqual( fields.count?.rules, { integer: true } );
        assert.deepEqual( fields.author?.rules, { type: 'post' } );
    } );

    it( 'rejects unknown types with a suggestion', () =>
    {
        const [ issue ] = issuesFor( { body: 'markdwon!' } );

        assert.ok( issue?.message.includes( 'markdown' ) );
    } );

    it( 'rejects rules that do not apply to the type', () =>
    {
        const [ issue ] = issuesFor( { flag: 'toggle | max:3' } );

        assert.ok( issue?.message.includes( 'takes no rules' ) );
    } );

    it( 'rejects non-numeric arguments to numeric rules', () =>
    {
        const [ issue ] = issuesFor( { title: 'text | max:eighty' } );

        assert.ok( issue?.message.includes( 'needs a number' ) );
    } );
} );

describe( 'object form', () =>
{
    it( 'normalizes the full object form', () =>
    {
        const fields = normalizeFields( {
            title: {
                type: 'text',
                required: true,
                label: 'Card title',
                help: 'Shown on the card.',
                rules: { max: 80 },
                messages: { max: 'Keep titles under 80 characters.' },
            },
        } );

        assert.equal( fields.title?.label, 'Card title' );
        assert.equal( fields.title?.messages.max, 'Keep titles under 80 characters.' );
    } );

    it( 'defaults the label from the key, title-cased', () =>
    {
        const fields = normalizeFields( { cta_text: 'text', heroImage: 'image' } );

        assert.equal( fields.cta_text?.label, 'Cta Text' );
        assert.equal( fields.heroImage?.label, 'Hero Image' );
    } );

    it( 'rejects unknown keys with a did-you-mean, per the strict-manifest rule', () =>
    {
        const [ issue ] = issuesFor( { tagline: { type: 'text', showWen: 'title' } } );

        assert.equal( issue?.path, 'fields.tagline.showWen' );
        assert.ok( issue?.message.includes( 'Did you mean "showWhen"?' ) );
    } );

    it( 'rejects messages for rules that do not exist on the field', () =>
    {
        const [ issue ] = issuesFor( { title: { type: 'text', messages: { max: 'Too long.' } } } );

        assert.ok( issue?.message.includes( 'no such rule' ) );
    } );

    it( 'rejects field keys that conditions could not reference', () =>
    {
        const [ issue ] = issuesFor( { 'cta-text': 'text' } );

        assert.ok( issue?.message.includes( 'letters, digits, and underscores' ) );
    } );
} );

describe( 'selects and options', () =>
{
    it( 'requires options on select fields', () =>
    {
        const [ issue ] = issuesFor( { layout: 'select' } );

        assert.ok( issue?.message.includes( 'needs "options"' ) );
    } );

    it( 'normalizes static, labeled, token-sourced, and dependent options', () =>
    {
        const fields = normalizeFields( {
            layout: { type: 'select', options: [ 'stacked', { value: 'split', label: 'Side by side' } ] },
            width: { type: 'select', options: { fromTokens: 'widths' } },
            style: { type: 'select', options: { byField: 'layout', map: { stacked: [ 'tight', 'airy' ] } } },
        } );

        assert.deepEqual( fields.layout?.options, {
            source: 'static',
            values: [ { value: 'stacked', label: 'stacked' }, { value: 'split', label: 'Side by side' } ],
        } );
        assert.deepEqual( fields.width?.options, { source: 'fromTokens', tokenFamily: 'widths' } );
        assert.equal( fields.style?.options?.source, 'byField' );
    } );

    it( 'rejects byField pointing at a missing sibling', () =>
    {
        const [ issue ] = issuesFor( {
            style: { type: 'select', options: { byField: 'layoutt', map: { a: [ 'b' ] } } },
        } );

        assert.ok( issue?.message.includes( 'no sibling field' ) );
    } );

    it( 'rejects options on types that do not take them', () =>
    {
        const [ issue ] = issuesFor( { title: { type: 'text', options: [ 'a' ] } } );

        assert.ok( issue?.message.includes( 'Only select and multiselect' ) );
    } );
} );

describe( 'lists and groups', () =>
{
    it( 'normalizes a list with item fields and top-level min/max', () =>
    {
        const fields = normalizeFields( {
            faqs: { type: 'list', min: 1, max: 20, fields: { question: 'text!', answer: 'markdown!' } },
        } );

        assert.deepEqual( fields.faqs?.rules, { min: 1, max: 20 } );
        assert.equal( fields.faqs?.fields?.question?.required, true );
    } );

    it( 'allows lists two deep and rejects the third level', () =>
    {
        const twoDeep = {
            outer: { type: 'list', fields: { inner: { type: 'list', fields: { leaf: 'text' } } } },
        };

        assert.doesNotThrow( () => normalizeFields( twoDeep ) );

        const threeDeep = {
            outer: {
                type: 'list',
                fields: { middle: { type: 'list', fields: { inner: { type: 'list', fields: { leaf: 'text' } } } } },
            },
        };
        const [ issue ] = issuesFor( threeDeep );

        assert.ok( issue?.message.includes( 'relational layer' ) );
    } );

    it( 'scopes conditions to item siblings inside a list', () =>
    {
        const fields = {
            heading: 'text',
            faqs: {
                type: 'list',
                fields: { question: 'text!', pinned: { type: 'toggle', showWhen: 'heading' } },
            },
        };
        const [ issue ] = issuesFor( fields );

        assert.equal( issue?.path, 'fields.faqs.fields.pinned.showWhen' );
        assert.ok( issue?.message.includes( 'no sibling field' ) );
    } );
} );

describe( 'condition analysis', () =>
{
    it( 'accepts conditions over known siblings', () =>
    {
        assert.doesNotThrow( () => normalizeFields( {
            layout: { type: 'select', options: [ 'stacked', 'overlay' ] },
            scrim: { type: 'toggle', showWhen: 'layout == "overlay"' },
        } ) );
    } );

    it( 'rejects unknown field keys in conditions, with a suggestion', () =>
    {
        const [ issue ] = issuesFor( {
            layout: { type: 'select', options: [ 'a' ] },
            scrim: { type: 'toggle', showWhen: 'layot == "a"' },
        } );

        assert.ok( issue?.message.includes( 'Did you mean "layout"?' ) );
    } );

    it( 'reports expression syntax errors at the field path', () =>
    {
        const [ issue ] = issuesFor( { scrim: { type: 'toggle', showWhen: 'a ==' } } );

        assert.equal( issue?.path, 'fields.scrim.showWhen' );
    } );

    it( 'rejects circular showWhen chains, naming the cycle', () =>
    {
        const [ issue ] = issuesFor( {
            a: { type: 'toggle', showWhen: 'b' },
            b: { type: 'toggle', showWhen: 'a' },
        } );

        assert.ok( issue?.message.includes( 'a -> b -> a' ) || issue?.message.includes( 'b -> a -> b' ) );
    } );

    it( 'rejects a field whose visibility depends on itself', () =>
    {
        const [ issue ] = issuesFor( { a: { type: 'toggle', showWhen: '!a' } } );

        assert.ok( issue?.message.includes( 'Circular showWhen' ) );
    } );

    it( 'allows requiredWhen to reference fields without creating cycles', () =>
    {
        assert.doesNotThrow( () => normalizeFields( {
            a: { type: 'toggle', requiredWhen: 'b' },
            b: { type: 'toggle', requiredWhen: 'a' },
        } ) );
    } );
} );

describe( 'image alt declarations', () =>
{
    it( 'accepts "alt": "optional" on image fields only', () =>
    {
        const fields = normalizeFields( { divider: { type: 'image', alt: 'optional' } } );

        assert.equal( fields.divider?.decorativeAlt, true );

        const [ issue ] = issuesFor( { title: { type: 'text', alt: 'optional' } } );

        assert.ok( issue?.message.includes( 'Only image fields' ) );
    } );
} );

describe( 'issue aggregation', () =>
{
    it( 'collects every problem in one pass, each with its path', () =>
    {
        const issues = issuesFor( {
            body: 'markdwon',
            layout: 'select',
            scrim: { type: 'toggle', showWen: 'layout' },
        } );

        assert.equal( issues.length, 3 );
        assert.deepEqual(
            issues.map( ( issue ) => issue.path ).sort(),
            [ 'fields.body', 'fields.layout', 'fields.scrim.showWen' ],
        );
    } );
} );
