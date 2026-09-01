// Presentation values (SCHEMA 13.5): the scope binds and inline
// interpolation see. Dates speak their field's format - never raw
// ISO in visitor-facing prose - and references speak their target's
// name. Ordering, filtering, and editing always use the raw stored
// values; presentation exists for rendering only.
//
// Formatting is hand-rolled and English on purpose: Intl output can
// vary with the host's ICU, and the empty-diff build invariant must
// never depend on the machine a site was built on. A site-level
// locale is a recorded door.

import { type NormalizedFields } from '../schema/fields.ts';
import { type LoadedCollection, type LoadedTaxonomy } from './contentDocuments.ts';

const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDateValue ( value: unknown, format: unknown ): unknown
{
    if ( typeof value !== 'string' || format === 'iso' ) { return value; }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( value );

    if ( match === null ) { return value; }

    const month = monthNames[ Number( match[ 2 ] ) - 1 ];
    const day = Number( match[ 3 ] );

    if ( month === undefined || day < 1 || day > 31 ) { return value; }

    return format === 'short'
        ? `${month.slice( 0, 3 )} ${day}, ${match[ 1 ]}`
        : `${month} ${day}, ${match[ 1 ]}`;
}

export interface PresentationDocs
{
    readonly collections?: readonly LoadedCollection[];
    readonly taxonomies?: readonly LoadedTaxonomy[];
}

// A reference presents as its target's name; a dangling or empty
// reference presents as nothing - the draft-omission spirit, in
// prose. BIND-THROUGH (Mikey: "at {{ $entry.location.address }}"):
// the presented value is a String OBJECT - coercion speaks the
// target's name, while the target's own presented values ride along
// as properties for deeper paths. The resolver unwraps to a
// primitive at the end of every lookup, so nothing downstream ever
// meets the object. Expansion goes ONE level: a reference inside
// the target presents as its plain name - the depth stop is what
// keeps A -> B -> A from recursing.
function wrapReference ( base: string, extras: Readonly<Record<string, unknown>> ): unknown
{
    const wrapped = new String( base ) as unknown as Record<string, unknown>;

    for ( const [ key, value ] of Object.entries( extras ) )
    {
        // String built-ins (length, indexes, methods) stay theirs.
        if ( !( key in wrapped ) ) { wrapped[ key ] = value; }
    }

    return wrapped;
}

function presentReference (
    value: unknown,
    rules: Readonly<Record<string, unknown>>,
    docs: PresentationDocs,
    depth: number,
): unknown
{
    // A multiple reference presents as its targets' names, joined -
    // readable in prose. BIND-THROUGH into a multiple joins the same
    // way: entry.venues.name speaks every venue's name, comma-joined,
    // because a path into a plural IS a list in prose. Non-scalar
    // target values (an image object) do not join and are omitted.
    if ( Array.isArray( value ) )
    {
        const targets = value
            .map( ( id ) => presentReference( id, rules, docs, depth ) )
            .filter( ( target ) => String( target ) !== '' );
        const joined = targets.map( ( target ) => String( target ) ).join( ', ' );

        if ( depth > 0 ) { return joined; }

        const extras: Record<string, unknown> = {};

        for ( const target of targets )
        {
            if ( typeof target !== 'object' || target === null ) { continue; }

            for ( const [ key, targetValue ] of Object.entries( target ) )
            {
                // A String object's own index properties are its
                // characters, not bind-through fields.
                if ( /^\d+$/.test( key ) ) { continue; }
                if ( typeof targetValue === 'object' && targetValue !== null && !( targetValue instanceof String ) ) { continue; }

                const piece = String( targetValue ?? '' );

                if ( piece === '' ) { continue; }

                extras[ key ] = extras[ key ] === undefined ? piece : `${String( extras[ key ] )}, ${piece}`;
            }
        }

        return wrapReference( joined, extras );
    }

    if ( typeof value !== 'string' || value === '' ) { return ''; }

    if ( typeof rules.taxonomy === 'string' )
    {
        const taxonomy = ( docs.taxonomies ?? [] ).find( ( candidate ) => candidate.file === `${rules.taxonomy as string}.json` );
        const term = taxonomy?.terms.find( ( candidate ) => candidate.id === value );

        if ( term === undefined ) { return ''; }
        if ( depth > 0 ) { return term.name; }

        return wrapReference( term.name, {
            id: term.id,
            name: term.name,
            description: term.description ?? '',
            ...( term.image === undefined ? {} : { image: term.image } ),
        } );
    }

    if ( typeof rules.type === 'string' )
    {
        const collection = ( docs.collections ?? [] ).find( ( candidate ) => candidate.file === `${rules.type as string}.json` );
        const entry = collection?.entries.find( ( candidate ) => candidate.id === value );

        if ( entry === undefined || collection === undefined ) { return ''; }

        const title = String( entry.values.title ?? '' );

        if ( depth > 0 ) { return title; }

        return wrapReference( title, {
            id: entry.id,
            ...presentEntryValues( entry.values, collection.fields, docs, depth + 1 ),
        } );
    }

    return '';
}

export function presentEntryValues (
    values: Readonly<Record<string, unknown>>,
    fields: NormalizedFields,
    docs: PresentationDocs,
    depth = 0,
): Record<string, unknown>
{
    const presented: Record<string, unknown> = { ...values };

    for ( const [ key, field ] of Object.entries( fields ) )
    {
        if ( field.type === 'date' ) { presented[ key ] = formatDateValue( values[ key ], field.rules.format ); }
        if ( field.type === 'reference' ) { presented[ key ] = presentReference( values[ key ], field.rules, docs, depth ); }
    }

    return presented;
}
