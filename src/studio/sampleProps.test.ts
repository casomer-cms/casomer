// A component with no example still earns a real-render ghost: props
// stand in from its fields, typed by field type, nested for lists and
// groups, honouring a declared default.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sampleProps } from './preview.ts';
import type { NormalizedField, NormalizedFields } from '../schema/fields.ts';

const field = ( type: NormalizedField[ 'type' ], extra: Partial<NormalizedField> = {} ): NormalizedField => ( {
    type,
    required: false,
    label: `${type} label`,
    rules: {},
    messages: {},
    ...extra,
} );

describe( 'sample props for a ghost', () =>
{
    it( 'stands a value in for every field type', () =>
    {
        const fields: NormalizedFields = {
            title: field( 'text' ),
            blurb: field( 'text', { placeholder: 'Say something' } ),
            body: field( 'markdown' ),
            count: field( 'number' ),
            featured: field( 'toggle' ),
            style: field( 'select', { options: { source: 'static', values: [ { value: 'plain', label: 'Plain' }, { value: 'bold', label: 'Bold' } ] } } ),
            tags: field( 'multiselect', { options: { source: 'static', values: [ { value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' } ] } } ),
            link: field( 'url' ),
            photo: field( 'image' ),
            when: field( 'date' ),
            tint: field( 'color' ),
            related: field( 'reference' ),
            items: field( 'list', { fields: { name: field( 'text' ) } } ),
            meta: field( 'group', { fields: { note: field( 'textarea' ) } } ),
            size: field( 'text', { defaultValue: 'lg' } ),
        };
        const props = sampleProps( fields );

        assert.equal( props.title, 'A sample heading' );
        assert.equal( props.blurb, 'Say something' );
        assert.match( String( props.body ), /^# markdown label/ );
        assert.equal( props.count, 3 );
        assert.equal( props.featured, false );
        assert.equal( props.style, 'plain' );
        assert.deepEqual( props.tags, [ 'a', 'b' ] );
        assert.equal( props.link, '#' );
        assert.match( ( props.photo as { src: string } ).src, /^data:image\/svg\+xml/ );
        assert.equal( props.when, '2026-09-03' );
        assert.equal( props.tint, '#E8A13D' );
        assert.equal( props.related, '' );
        assert.equal( ( props.items as unknown[] ).length, 2 );
        assert.equal( ( props.meta as { note: string } ).note.length > 20, true );
        assert.equal( props.size, 'lg' );
    } );
} );
