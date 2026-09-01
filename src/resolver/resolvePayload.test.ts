import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { missingRequiredFields, resolveRenderPayload } from './resolvePayload.ts';
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

describe( 'the alt derivation chain (SCHEMA 13.4)', () =>
{
    const fields = normalizeFields( { photo: 'image' } );
    const altOf = ( value: Record<string, unknown> ): unknown =>
        ( resolveRenderPayload( fields, { photo: value } ).photo as Record<string, unknown> ).alt;

    it( 'keeps an explicit alt', () =>
    {
        assert.equal( altOf( { src: '/media/x.png', alt: 'A sunrise', caption: 'Morning' } ), 'A sunrise' );
    } );

    it( 'falls back to the caption', () =>
    {
        assert.equal( altOf( { src: '/media/x.png', caption: 'Morning at the bakery' } ), 'Morning at the bakery' );
    } );

    it( 'falls back to the humanized original filename', () =>
    {
        assert.equal( altOf( { src: '/media/x.png', name: 'sunrise-over_bakery.jpg' } ), 'sunrise over bakery' );
    } );

    it( 'ends at empty: UUID names and digit soup never humanize', () =>
    {
        assert.equal( altOf( { src: '/media/x.png', name: '2f5b8c1a-9d4e-4f6a-8b2c-1e5d7a9c3b4f.png' } ), '' );
        assert.equal( altOf( { src: '/media/x.png', name: '12345678.png' } ), '' );
        assert.equal( altOf( { src: '/media/x.png' } ), '' );
    } );
} );

describe( 'missingRequiredFields', () =>
{
    it( 'reports required fields that are absent, blank, or empty images', () =>
    {
        const fields = normalizeFields( { title: 'text!', photo: 'image!', note: 'text' } );

        assert.deepEqual(
            missingRequiredFields( fields, { title: '   ', photo: { src: '', alt: 'x' } } ).map( ( problem ) => problem.key ),
            [ 'title', 'photo' ],
        );
        assert.deepEqual( missingRequiredFields( fields, { title: 'Hi', photo: { src: '/a.jpg', alt: 'x' } } ), [] );
    } );

    it( 'a hidden field is never validated, and requiredWhen only binds when it holds', () =>
    {
        const fields = normalizeFields( {
            layout: { type: 'select', options: [ 'stacked', 'overlay' ] },
            scrim: { type: 'text', showWhen: 'layout == "overlay"', required: true },
            caption: { type: 'text', requiredWhen: 'layout == "overlay"' },
        } );

        // Stacked: scrim is hidden (never validated), caption optional.
        assert.deepEqual( missingRequiredFields( fields, { layout: 'stacked' } ), [] );

        // Overlay: both bite.
        assert.deepEqual(
            missingRequiredFields( fields, { layout: 'overlay' } ).map( ( problem ) => problem.key ),
            [ 'scrim', 'caption' ],
        );
    } );

    it( 'walks list items and names the offending item', () =>
    {
        const fields = normalizeFields( {
            faqs: { type: 'list', fields: { question: 'text!', answer: 'markdown' } },
        } );

        assert.deepEqual(
            missingRequiredFields( fields, { faqs: [ { question: 'Q1' }, { question: '' } ] } ).map( ( problem ) => problem.key ),
            [ 'faqs[1].question' ],
        );
    } );

    it( 'a toggle set to false and a number 0 are answers, not gaps', () =>
    {
        const fields = normalizeFields( {
            open: { type: 'toggle', required: true },
            count: { type: 'number', required: true },
        } );

        assert.deepEqual( missingRequiredFields( fields, { open: false, count: 0 } ), [] );
    } );
} );
