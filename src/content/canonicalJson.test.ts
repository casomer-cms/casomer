import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    serializeCanonicalJson,
    parseJsonDocument,
    CanonicalJsonError,
} from './canonicalJson.ts';

describe( 'serializeCanonicalJson', () =>
{
    it( 'pretty-prints with four-space indent, LF, and a trailing newline', () =>
    {
        const text = serializeCanonicalJson( { title: 'Hello', tags: [ 'a', 'b' ] } );

        assert.equal(
            text,
            '{\n    "title": "Hello",\n    "tags": [\n        "a",\n        "b"\n    ]\n}\n',
        );
    } );

    it( 'preserves key order', () =>
    {
        const text = serializeCanonicalJson( { zebra: 1, apple: 2, mango: 3 } );
        const keyOrder = [ ...text.matchAll( /"(\w+)":/g ) ].map( ( match ) => match[ 1 ] );

        assert.deepEqual( keyOrder, [ 'zebra', 'apple', 'mango' ] );
    } );

    it( 'renders empty objects and arrays compactly', () =>
    {
        assert.equal( serializeCanonicalJson( { blocks: [], theme: {} } ), '{\n    "blocks": [],\n    "theme": {}\n}\n' );
    } );

    it( 'round-trips to an empty diff', () =>
    {
        const document = {
            id: 'b7e2c4d8',
            blocks: [
                { component: 'core/markdown', props: { content: '# Hello\n\nWorld' } },
                { section: { gap: 'md' }, blocks: [] },
            ],
            theme: { colors: { ink: '#1A1D28' } },
        };
        const first = serializeCanonicalJson( document );
        const second = serializeCanonicalJson( parseJsonDocument( first ) as typeof document );

        assert.equal( first, second );
    } );

    it( 'rejects non-finite numbers with the path', () =>
    {
        assert.throws(
            () => serializeCanonicalJson( { theme: { scale: Infinity } } ),
            ( error: unknown ) =>
                error instanceof CanonicalJsonError && error.path === 'document.theme.scale',
        );
    } );

    it( 'rejects undefined values instead of dropping them silently', () =>
    {
        assert.throws(
            () => serializeCanonicalJson( { title: undefined as never } ),
            CanonicalJsonError,
        );
    } );

    it( 'serializes scalars at the document root', () =>
    {
        assert.equal( serializeCanonicalJson( 'plain' ), '"plain"\n' );
        assert.equal( serializeCanonicalJson( 42 ), '42\n' );
        assert.equal( serializeCanonicalJson( null ), 'null\n' );
    } );
} );
