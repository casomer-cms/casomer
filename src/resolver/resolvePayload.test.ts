import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRenderPayload } from './resolvePayload.ts';
import { normalizeFields } from '../schema/fields.ts';

describe( 'resolveRenderPayload', () =>
{
    it( 'omits hidden fields entirely, not as null', () =>
    {
        const fields = normalizeFields( {
            layout: { type: 'select', options: [ 'stacked', 'overlay' ] },
            scrim: { type: 'toggle', showWhen: 'layout == "overlay"' },
        } );
        const payload = resolveRenderPayload( fields, { layout: 'stacked', scrim: true } );

        assert.deepEqual( payload, { layout: 'stacked' } );
        assert.ok( !( 'scrim' in payload ) );
    } );

    it( 'cascades hiding: a hidden parent collapses its dependents', () =>
    {
        const fields = normalizeFields( {
            first: 'toggle',
            second: { type: 'toggle', showWhen: 'first' },
            third: { type: 'toggle', showWhen: 'second' },
        } );
        const payload = resolveRenderPayload( fields, { first: false, second: true, third: true } );

        assert.deepEqual( payload, { first: false } );
    } );

    it( 'fills defaults for absent props and drops orphans', () =>
    {
        const fields = normalizeFields( {
            width: { type: 'select', options: { fromTokens: 'widths' }, default: 'prose' },
        } );
        const payload = resolveRenderPayload( fields, { legacy: 'kept in the document, absent here' } );

        assert.deepEqual( payload, { width: 'prose' } );
    } );

    it( 'treats a present list as truthy only when it has items', () =>
    {
        const fields = normalizeFields( {
            faqs: { type: 'list', fields: { question: 'text!' } },
            heading: { type: 'text', showWhen: 'faqs' },
        } );

        const withItems = resolveRenderPayload( fields, { faqs: [ { question: 'Q' } ], heading: 'FAQs' } );
        const empty = resolveRenderPayload( fields, { faqs: [], heading: 'FAQs' } );

        assert.equal( withItems.heading, 'FAQs' );
        assert.ok( !( 'heading' in empty ) );
    } );

    it( 'resolves list items recursively, with item-scope conditions', () =>
    {
        const fields = normalizeFields( {
            faqs: {
                type: 'list',
                fields: {
                    question: 'text!',
                    pinned: 'toggle',
                    badge: { type: 'text', showWhen: 'pinned' },
                },
            },
        } );
        const payload = resolveRenderPayload( fields, {
            faqs: [
                { question: 'Q1', pinned: true, badge: 'Top' },
                { question: 'Q2', pinned: false, badge: 'Hidden' },
            ],
        } );

        assert.deepEqual( payload.faqs, [
            { question: 'Q1', pinned: true, badge: 'Top' },
            { question: 'Q2', pinned: false },
        ] );
    } );

    it( 'never emits null or undefined values', () =>
    {
        const fields = normalizeFields( { title: 'text' } );

        assert.deepEqual( resolveRenderPayload( fields, { title: null } ), {} );
        assert.deepEqual( resolveRenderPayload( fields, {} ), {} );
    } );
} );
