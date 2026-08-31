import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkMarkupBalance } from './htmlWellFormed.ts';

describe( 'checkMarkupBalance', () =>
{
    it( 'accepts balanced markup with voids, self-closing tags, and comments', () =>
    {
        const html = '<article><img src="/a.jpg" alt="A"><br><path d="M0,0"/><!-- <div> in a comment --><p>fine</p></article>';

        assert.deepEqual( checkMarkupBalance( html ), [] );
    } );

    it( 'reports unclosed tags, innermost last', () =>
    {
        assert.deepEqual( checkMarkupBalance( '<div><span>text' ), [
            '<span> is never closed.',
            '<div> is never closed.',
        ] );
    } );

    it( 'reports stray and misordered closers', () =>
    {
        assert.deepEqual( checkMarkupBalance( '</div>' ), [ '</div> closes nothing; there is no open tag.' ] );
        assert.deepEqual(
            checkMarkupBalance( '<b><i>text</b></i>' ),
            [ '</b> closes <i>; tags must close in the order they open.', '</i> closes <b>; tags must close in the order they open.' ],
        );
    } );

    it( 'is not fooled by ">" inside quoted attribute values', () =>
    {
        assert.deepEqual( checkMarkupBalance( '<div x-show="open > 1" title=\'a > b\'>x</div>' ), [] );
    } );
} );
