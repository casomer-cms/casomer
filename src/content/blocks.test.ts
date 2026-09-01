import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeBlocks } from './blocks.ts';
import { type SchemaIssue } from '../schema/manifest.ts';

const analyze = ( raw: unknown ): { issues: SchemaIssue[]; references: string[] } =>
{
    const issues: SchemaIssue[] = [];
    const analysis = analyzeBlocks( raw, 'blocks', issues );

    return { issues, references: analysis.references.map( ( entry ) => entry.reference ) };
};

describe( 'analyzeBlocks', () =>
{
    it( 'accepts the section 11 example shape and collects references', () =>
    {
        const { issues, references } = analyze( [
            { component: 'core/markdown', props: { content: '# Hello' } },
            {
                section: { gap: 'md', align: 'center', wrap: true, padding: 'lg' },
                blocks: [
                    { component: 'core/image', size: '1/3', props: {} },
                    { component: 'core/markdown', props: {} },
                ],
            },
        ] );

        assert.deepEqual( issues, [] );
        assert.deepEqual( references, [ 'core/markdown', 'core/image', 'core/markdown' ] );
    } );

    it( 'requires a block to be exactly one of component or section', () =>
    {
        const both = analyze( [ { component: 'core/markdown', section: {} } ] );
        const neither = analyze( [ {} ] );

        assert.ok( both.issues[ 0 ]?.message.includes( 'exactly one' ) );
        assert.ok( neither.issues[ 0 ]?.message.includes( 'exactly one' ) );
    } );

    it( 'rejects unknown wrapper keys, teaching where layout lives', () =>
    {
        const { issues } = analyze( [ { component: 'core/markdown', gap: 'md' } ] );

        assert.ok( issues[ 0 ]?.message.includes( 'Layout lives on wrappers and sections' ) );
    } );

    it( 'rejects margin as a section property, because margin does not exist', () =>
    {
        const { issues } = analyze( [ { section: { margin: 'md' }, blocks: [] } ] );

        assert.ok( issues[ 0 ]?.message.includes( 'Margin does not exist in Casomer' ) );
    } );

    it( 'validates size as a fraction or flex-grow number', () =>
    {
        assert.deepEqual( analyze( [ { component: 'core/markdown', size: '2/3' } ] ).issues, [] );
        assert.deepEqual( analyze( [ { component: 'core/markdown', size: 2 } ] ).issues, [] );
        assert.ok( analyze( [ { component: 'core/markdown', size: '66%' } ] ).issues[ 0 ]?.message.includes( 'fraction' ) );
    } );

    it( 'rejects duplicate slugs across a page, naming both locations', () =>
    {
        const { issues } = analyze( [
            { component: 'core/markdown', slug: 'hero' },
            { section: {}, slug: 'hero', blocks: [] },
        ] );

        assert.ok( issues[ 0 ]?.message.includes( 'Duplicate slug "hero"' ) );
        assert.ok( issues[ 0 ]?.message.includes( 'blocks[0]' ) );
    } );

    it( 'constrains direction and minHeight to their named values', () =>
    {
        const direction = analyze( [ { section: { direction: 'diagonal' }, blocks: [] } ] );
        const minHeight = analyze( [ { section: { minHeight: 'full' }, blocks: [] } ] );

        assert.ok( direction.issues[ 0 ]?.message.includes( 'row, column, layer' ) );
        assert.ok( minHeight.issues[ 0 ]?.message.includes( 'no spacer component' ) );
    } );

    it( 'rejects raw CSS where a token or breakpoint map belongs', () =>
    {
        const { issues } = analyze( [ { section: { gap: 12 }, blocks: [] } ] );

        assert.ok( issues[ 0 ]?.message.includes( 'never raw CSS' ) );
    } );

    it( 'accepts breakpoint maps and layered sections with pull', () =>
    {
        const { issues } = analyze( [
            {
                section: { direction: 'layer', gap: { base: 'sm', md: 'lg' } },
                pull: 'md',
                blocks: [ { component: 'core/image', props: {} } ],
            },
        ] );

        assert.deepEqual( issues, [] );
    } );

    it( 'reports malformed component references in place', () =>
    {
        const { issues } = analyze( [ { component: 'markdown' } ] );

        assert.equal( issues[ 0 ]?.path, 'blocks[0].component' );
        assert.ok( issues[ 0 ]?.message.includes( 'package/id' ) );
    } );

    it( 'accepts a repeat block and collects its component reference', () =>
    {
        const { issues, references } = analyze( [ {
            repeat: {
                source: { collection: 'events', order: '-entry.eventDate', limit: 3 },
                component: 'core/markdown',
                props: { content: { $bind: 'entry.title' } },
            },
        } ] );

        assert.deepEqual( issues, [] );
        assert.deepEqual( references, [ 'core/markdown' ] );
    } );

    it( 'accepts a curated repeat source and rejects a doubled one', () =>
    {
        const curated = analyze( [ {
            repeat: {
                source: { entries: [ 'aa11bb22-cc33-4d44-8e55-ff6677889900' ] },
                component: 'core/markdown',
            },
        } ] );
        const doubled = analyze( [ {
            repeat: {
                source: { collection: 'events', entries: [] },
                component: 'core/markdown',
            },
        } ] );

        assert.deepEqual( curated.issues, [] );
        assert.ok( doubled.issues[ 0 ]?.message.includes( 'exactly one' ) );
    } );

    it( 'rejects a malformed order path and a malformed bind', () =>
    {
        const badOrder = analyze( [ {
            repeat: { source: { collection: 'events', order: 'eventDate' }, component: 'core/markdown' },
        } ] );
        const badBind = analyze( [ {
            repeat: { source: { collection: 'events' }, component: 'core/markdown', props: { content: { $bind: 'title' } } },
        } ] );

        assert.ok( badOrder.issues[ 0 ]?.message.includes( 'signed entry path' ) );
        assert.ok( badBind.issues[ 0 ]?.message.includes( 'entry path' ) );
    } );

    it( 'refuses a block claiming to be both a section and a repeat', () =>
    {
        const { issues } = analyze( [ { section: {}, blocks: [], repeat: {} } ] );

        assert.ok( issues[ 0 ]?.message.includes( 'exactly one' ) );
    } );
} );
