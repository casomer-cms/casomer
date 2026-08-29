import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    parseExpression,
    evaluateExpression,
    collectReferencedFieldKeys,
    ExpressionSyntaxError,
    type FieldValues,
} from './expressions.ts';

const evaluate = ( source: string, fields: FieldValues = {} ): boolean =>
    evaluateExpression( parseExpression( source ), fields );

describe( 'parseExpression', () =>
{
    it( 'parses the full operator set with correct precedence', () =>
    {
        // || binds loosest, so this is (a && !b) || (c == "x").
        const expression = parseExpression( 'a && !b || c == "x"' );

        assert.equal( expression.kind, 'or' );
    } );

    it( 'parses parenthesized expressions as operands', () =>
    {
        assert.equal( evaluate( '( a || b ) == true', { a: true } ), true );
    } );

    it( 'parses lists of mixed literals', () =>
    {
        assert.equal( evaluate( 'layout in [ "stacked", "split", 3, true ]', { layout: 'split' } ), true );
    } );

    it( 'rejects trailing input with a position', () =>
    {
        assert.throws(
            () => parseExpression( 'a == 1 b' ),
            ( error: unknown ) =>
                error instanceof ExpressionSyntaxError && error.position === 7,
        );
    } );

    it( 'rejects unknown characters with guidance', () =>
    {
        assert.throws(
            () => parseExpression( 'a + b' ),
            ( error: unknown ) =>
                error instanceof ExpressionSyntaxError && error.message.includes( 'field keys' ),
        );
    } );

    it( 'rejects unclosed strings', () =>
    {
        assert.throws( () => parseExpression( 'a == "open' ), ExpressionSyntaxError );
    } );

    it( 'rejects non-literal list members', () =>
    {
        assert.throws( () => parseExpression( 'a in [ b ]' ), ExpressionSyntaxError );
    } );

    it( 'rejects the empty expression', () =>
    {
        assert.throws( () => parseExpression( '' ), ExpressionSyntaxError );
    } );
} );

describe( 'evaluateExpression', () =>
{
    it( 'compares strings, numbers, and booleans strictly', () =>
    {
        assert.equal( evaluate( 'layout == "split"', { layout: 'split' } ), true );
        assert.equal( evaluate( 'count == 3', { count: 3 } ), true );
        assert.equal( evaluate( 'enabled == true', { enabled: true } ), true );
        assert.equal( evaluate( 'count == "3"', { count: 3 } ), false );
    } );

    it( 'evaluates negation and boolean connectives', () =>
    {
        assert.equal( evaluate( '!hidden && ready', { hidden: false, ready: true } ), true );
        assert.equal( evaluate( 'a || b', { a: false, b: false } ), false );
    } );

    it( 'treats bare fields by truthiness', () =>
    {
        assert.equal( evaluate( 'title', { title: 'hello' } ), true );
        assert.equal( evaluate( 'title', { title: '' } ), false );
        assert.equal( evaluate( 'count', { count: 0 } ), false );
    } );

    // SCHEMA section 3.2: an absent (hidden) field is falsy, "==" against
    // anything is false, "!=" against anything is true, "in" is false.
    it( 'implements absent-field semantics', () =>
    {
        assert.equal( evaluate( 'missing' ), false );
        assert.equal( evaluate( 'missing == "anything"' ), false );
        assert.equal( evaluate( 'missing != "anything"' ), true );
        assert.equal( evaluate( 'missing in [ "a", "b" ]' ), false );
        assert.equal( evaluate( '!missing' ), true );
    } );

    it( 'treats two absent fields as unequal', () =>
    {
        assert.equal( evaluate( 'gone == missing' ), false );
        assert.equal( evaluate( 'gone != missing' ), true );
    } );

    it( 'evaluates membership against present values', () =>
    {
        assert.equal( evaluate( 'size in [ 1, 2, 3 ]', { size: 2 } ), true );
        assert.equal( evaluate( 'size in [ 1, 2, 3 ]', { size: 4 } ), false );
    } );
} );

describe( 'collectReferencedFieldKeys', () =>
{
    it( 'collects every field key, including inside groups', () =>
    {
        const keys = collectReferencedFieldKeys(
            parseExpression( 'a && ( b == c ) || !d && e in [ "x" ]' ),
        );

        assert.deepEqual( [ ...keys ].sort(), [ 'a', 'b', 'c', 'd', 'e' ] );
    } );

    it( 'collects nothing from pure literals', () =>
    {
        assert.equal( collectReferencedFieldKeys( parseExpression( 'true' ) ).size, 0 );
    } );
} );
