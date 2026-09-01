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

// Visibility settles by fixpoint: a hidden field evaluates as absent
// in downstream conditions, so hiding cascades. The field validator
// rejected circular showWhen chains, so this always converges.
function hiddenSetFor (
    entries: readonly ( readonly [ string, NormalizedField ] )[],
    rawValues: ReadonlyMap<string, unknown>,
): { hidden: Set<string>; conditionView: Record<string, FieldValues[ string ]> }
{
    const hidden = new Set<string>();
    let changed = true;
    let conditionView: Record<string, FieldValues[ string ]> = {};

    while ( changed )
    {
        changed = false;
        conditionView = {};

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

    return { hidden, conditionView };
}

// What "empty" means for a required check, per type: absent, an empty
// string, an empty list, or an image/file with no src. A toggle is
// never empty (false is an answer), and 0 is a number.
function isEmptyValue ( field: NormalizedField, value: unknown ): boolean
{
    if ( value === undefined || value === null ) { return true; }
    if ( typeof value === 'string' ) { return value.trim() === ''; }
    if ( Array.isArray( value ) ) { return value.length === 0; }

    if ( ( field.type === 'image' || field.type === 'file' ) && typeof value === 'object' )
    {
        const src = ( value as Record<string, unknown> ).src;

        return typeof src !== 'string' || src.trim() === '';
    }

    return false;
}

// The required check (SCHEMA sections 2 and 3): a visible field that
// is required - unconditionally, or because its requiredWhen holds -
// and empty. A hidden field is never validated, regardless. Returns
// the offending fields with their labels; list items are walked so a
// required sub-field inside a repeater reports its item.
export function missingRequiredFields (
    fields: NormalizedFields,
    props: Readonly<Record<string, unknown>>,
): { key: string; label: string }[]
{
    const entries = Object.entries( fields );
    const rawValues = new Map<string, unknown>();

    for ( const [ key, field ] of entries )
    {
        rawValues.set( key, rawValueOf( field, props, key ) );
    }

    const { hidden, conditionView } = hiddenSetFor( entries, rawValues );
    const missing: { key: string; label: string }[] = [];

    for ( const [ key, field ] of entries )
    {
        if ( hidden.has( key ) ) { continue; }

        const raw = rawValues.get( key );
        const required = field.required
            || ( field.requiredWhen !== undefined && evaluateExpression( field.requiredWhen.expression, conditionView ) );

        if ( required && isEmptyValue( field, raw ) )
        {
            missing.push( { key, label: field.label } );
        }

        if ( field.type === 'list' && Array.isArray( raw ) )
        {
            for ( const [ index, item ] of raw.entries() )
            {
                if ( item === null || typeof item !== 'object' || Array.isArray( item ) ) { continue; }

                for ( const problem of missingRequiredFields( field.fields ?? {}, item as Record<string, unknown> ) )
                {
                    missing.push( { key: `${key}[${index}].${problem.key}`, label: problem.label } );
                }
            }
        }
    }

    return missing;
}

// "sunrise-over-bakery.jpg" reads as "sunrise over bakery"; a
// UUID-shaped name never humanizes (uploads are UUID-renamed, which
// is exactly why the original name is retained on the value).
function humanizedFilename ( name: unknown ): string
{
    if ( typeof name !== 'string' ) { return ''; }

    const base = name.replace( /\.[A-Za-z0-9]+$/, '' );

    if ( /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test( base ) ) { return ''; }

    const spoken = base.replace( /[-_]+/g, ' ' ).trim();

    return /[a-zA-Z]/.test( spoken ) ? spoken : '';
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

    const { hidden } = hiddenSetFor( entries, rawValues );
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

        // The alt derivation chain (SCHEMA 13.4): the document keeps
        // only what the user said; render time fills alt from the
        // caption, then the humanized original filename, and ends at
        // "" deliberately - silence beats junk in a screen reader.
        if ( field.type === 'image' && typeof raw === 'object' && !Array.isArray( raw ) )
        {
            const image = raw as Record<string, unknown>;
            const alt = typeof image.alt === 'string' && image.alt.trim() !== ''
                ? image.alt
                : ( typeof image.caption === 'string' && image.caption.trim() !== ''
                        ? image.caption
                        : humanizedFilename( image.name ) );

            payload[ key ] = { ...image, alt } as PayloadValue;
            continue;
        }

        payload[ key ] = raw as PayloadValue;
    }

    return payload;
}
