// The resolver: props plus field definitions in, render payload out.
// This is the shared module of DEVELOPMENT section 5: the compiler and
// Studio both import it, which is what makes preview parity structural.
// Semantics are SCHEMA section 3.2, exactly: the document persists
// everything, the payload omits hidden fields entirely (absent, not null),
// hiding a parent collapses its dependents, and orphaned props (section
// 10.1) never reach a template. Defaults fill absent props.

import { evaluateExpression, type FieldValues } from '../schema/expressions.ts';
import { type NormalizedField, type NormalizedFields } from '../schema/fields.ts';

export type PayloadValue
    = | string
        | number
        | boolean
        | Readonly<Record<string, unknown>>
        | readonly unknown[];

export type RenderPayload = Readonly<Record<string, PayloadValue>>;

// Expressions compare scalars, but fields can hold objects and lists.
// For condition evaluation, a present non-scalar reads as its natural
// truthiness: a list is truthy when it has items, an object is truthy
// by existing. Absent stays absent.
function scalarViewOf ( value: unknown ): FieldValues[ string ]
{
    if ( value === undefined || value === null ) { return undefined; }
    if ( typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ) { return value; }
    if ( Array.isArray( value ) ) { return value.length > 0; }

    return true;
}

function rawValueOf ( field: NormalizedField, props: Readonly<Record<string, unknown>>, key: string ): unknown
{
    const value = props[ key ];

    return value === undefined ? field.defaultValue : value;
}

export function resolveRenderPayload (
    fields: NormalizedFields,
    props: Readonly<Record<string, unknown>>,
): RenderPayload
{
    const entries = Object.entries( fields );
    const rawValues = new Map<string, unknown>();

    for ( const [ key, field ] of entries )
    {
        rawValues.set( key, rawValueOf( field, props, key ) );
    }

    // Visibility settles by fixpoint: a hidden field evaluates as absent
    // in downstream conditions, so hiding cascades. The field validator
    // rejected circular showWhen chains, so this always converges.
    const hidden = new Set<string>();
    let changed = true;

    while ( changed )
    {
        changed = false;

        const conditionView: Record<string, FieldValues[ string ]> = {};

        for ( const [ key ] of entries )
        {
            conditionView[ key ] = hidden.has( key ) ? undefined : scalarViewOf( rawValues.get( key ) );
        }

        for ( const [ key, field ] of entries )
        {
            if ( field.showWhen === undefined || hidden.has( key ) ) { continue; }

            if ( !evaluateExpression( field.showWhen.expression, conditionView ) )
            {
                hidden.add( key );
                changed = true;
            }
        }
    }

    const payload: Record<string, PayloadValue> = {};

    for ( const [ key, field ] of entries )
    {
        if ( hidden.has( key ) ) { continue; }

        const raw = rawValues.get( key );

        if ( raw === undefined || raw === null ) { continue; }

        if ( field.type === 'list' && Array.isArray( raw ) )
        {
            payload[ key ] = raw
                .filter( ( item ) => item !== null && typeof item === 'object' && !Array.isArray( item ) )
                .map( ( item ) => resolveRenderPayload( field.fields ?? {}, item as Record<string, unknown> ) );
            continue;
        }

        if ( field.type === 'group' && typeof raw === 'object' && !Array.isArray( raw ) )
        {
            payload[ key ] = resolveRenderPayload( field.fields ?? {}, raw as Record<string, unknown> );
            continue;
        }

        payload[ key ] = raw as PayloadValue;
    }

    return payload;
}
