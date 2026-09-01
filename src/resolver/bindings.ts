// $bind resolution (SCHEMA section 13.5): the one binding mechanism.
// A prop value of { "$bind": "entry.title" } resolves against the
// scope the surrounding context supplies - a repeat item's entry, a
// template's sample or real entry. Plain values pass through, arrays
// and objects resolve recursively, and a path that resolves to
// nothing becomes undefined so the field-default machinery applies.
//
// Inline interpolation (Mikey's markdown feature) rides the same
// resolver: a STRING value may embed {{ $entry.title }} tokens -
// "{{ $" is the opening marker, deliberately distinctive so code
// samples about other template languages never collide - and each
// token substitutes the same scope paths $bind speaks. A path that
// resolves to nothing substitutes empty; a token that does not match
// the marker grammar is left exactly as written.

function lookup ( path: string, scope: Readonly<Record<string, unknown>> ): unknown
{
    let current: unknown = scope;

    for ( const segment of path.split( '.' ) )
    {
        if ( current === null || typeof current !== 'object' ) { return undefined; }

        current = ( current as Record<string, unknown> )[ segment ];
    }

    // A presented reference travels as a String object so deeper
    // segments can traverse it (bind-through); every caller receives
    // the primitive.
    return current instanceof String ? String( current ) : current;
}

const interpolationShape = /\{\{\s*\$((?:entry|term|page|site)(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\}\}/g;

export function interpolateBindings ( text: string, scope: Readonly<Record<string, unknown>> ): string
{
    return text.replace( interpolationShape, ( _match, path: string ) =>
    {
        const value = lookup( path, scope );

        return value === undefined || value === null ? '' : String( value );
    } );
}

export function resolveBindings ( value: unknown, scope: Readonly<Record<string, unknown>> ): unknown
{
    if ( Array.isArray( value ) ) { return value.map( ( item ) => resolveBindings( item, scope ) ); }

    if ( value !== null && typeof value === 'object' )
    {
        const record = value as Record<string, unknown>;

        if ( typeof record.$bind === 'string' && Object.keys( record ).length === 1 )
        {
            return lookup( record.$bind, scope );
        }

        return Object.fromEntries(
            Object.entries( record ).map( ( [ key, item ] ) => [ key, resolveBindings( item, scope ) ] ),
        );
    }

    if ( typeof value === 'string' && value.includes( '{{' ) )
    {
        return interpolateBindings( value, scope );
    }

    return value;
}
