// Canonical serialization, from SCHEMA appendix B: Casomer owns the format
// of its content files, and there is one form, always. Pretty-printed,
// four-space indent, LF line endings, preserved key order, trailing
// newline. The editor and the CLI write identically, so a save that
// changes nothing produces an empty diff, which is what makes publish
// history reviewable.

export type JsonValue
    = | string
        | number
        | boolean
        | null
        | JsonValue[]
        | { [ key: string ]: JsonValue };

const indentUnit = '    ';

export class CanonicalJsonError extends Error
{
    readonly path: string;

    constructor ( message: string, path: string )
    {
        super( message );
        this.name = 'CanonicalJsonError';
        this.path = path;
    }
}

function serializeValue ( value: JsonValue, indent: string, path: string ): string
{
    if ( value === null ) { return 'null'; }

    if ( typeof value === 'string' || typeof value === 'boolean' )
    {
        return JSON.stringify( value );
    }

    if ( typeof value === 'number' )
    {
        if ( !Number.isFinite( value ) )
        {
            throw new CanonicalJsonError(
                `The number at ${path} is ${value}, which JSON cannot represent. Store a finite number or a string.`,
                path,
            );
        }

        return JSON.stringify( value );
    }

    if ( Array.isArray( value ) )
    {
        if ( value.length === 0 ) { return '[]'; }

        const innerIndent = indent + indentUnit;
        const items = value.map(
            ( item, index ) => innerIndent + serializeValue( requireDefined( item, `${path}[${index}]` ), innerIndent, `${path}[${index}]` ),
        );

        return `[\n${items.join( ',\n' )}\n${indent}]`;
    }

    if ( typeof value === 'object' )
    {
        const entries = Object.entries( value );

        if ( entries.length === 0 ) { return '{}'; }

        const innerIndent = indent + indentUnit;
        const lines = entries.map(
            ( [ key, entryValue ] ) =>
                `${innerIndent}${JSON.stringify( key )}: `
                + serializeValue( requireDefined( entryValue, `${path}.${key}` ), innerIndent, `${path}.${key}` ),
        );

        return `{\n${lines.join( ',\n' )}\n${indent}}`;
    }

    throw new CanonicalJsonError(
        `The value at ${path} is a ${typeof value}, which JSON cannot represent.`,
        path,
    );
}

function requireDefined ( value: JsonValue | undefined, path: string ): JsonValue
{
    if ( value === undefined )
    {
        throw new CanonicalJsonError(
            `The value at ${path} is undefined. Canonical documents have one representation for every value; omit the key instead.`,
            path,
        );
    }

    return value;
}

export function serializeCanonicalJson ( value: JsonValue ): string
{
    return serializeValue( requireDefined( value, 'document' ), '', 'document' ) + '\n';
}

export function parseJsonDocument ( text: string ): JsonValue
{
    return JSON.parse( text ) as JsonValue;
}
