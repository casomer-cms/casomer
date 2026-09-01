// The lane's window onto the shared manifest, typed to the real
// NormalizedFields shape (mirrored here so the lane stays standalone;
// the real inspector imports the schema module's types directly).

export interface FieldOptionsStatic
{
    readonly source: 'static';
    readonly values: readonly { readonly value: string; readonly label: string }[];
}

export interface FieldOptionsByField
{
    readonly source: 'byField';
    readonly byField: string;
    readonly map: Readonly<Record<string, readonly string[]>>;
}

export interface FieldOptionsFromTokens
{
    readonly source: 'fromTokens';
    readonly tokenFamily: string;
}

export type FieldOptions = FieldOptionsStatic | FieldOptionsByField | FieldOptionsFromTokens;

export interface NormalizedField
{
    readonly type: string;
    readonly required: boolean;
    readonly label: string;
    readonly help?: string;
    readonly placeholder?: string;
    readonly defaultValue?: unknown;
    readonly showWhen?: { readonly source: string };
    readonly options?: FieldOptions;
    readonly fields?: Readonly<Record<string, NormalizedField>>;
}

export interface InspectorManifest
{
    readonly id: string;
    readonly title: string;
    readonly packageName: string;
    readonly fields: Readonly<Record<string, NormalizedField>>;
    readonly initialProps: Record<string, unknown>;
    readonly tokens: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type PropsRecord = Record<string, unknown>;

// The same minimal showWhen stand-in the Alpine lane carries.
export function evalCondition ( source: string, values: PropsRecord ): boolean
{
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*"([^"]*)"$/.exec( source.trim() );

    if ( match === null ) { return true; }

    const [ , key, operator, literal ] = match;

    return operator === '==' ? values[ key ?? '' ] === literal : values[ key ?? '' ] !== literal;
}

export function emptyValueFor ( field: NormalizedField ): unknown
{
    if ( field.defaultValue !== undefined ) { return structuredClone( field.defaultValue ); }

    switch ( field.type )
    {
        case 'toggle': return false;
        case 'list': return [];
        case 'image': return null;
        default: return '';
    }
}

export function selectOptionsFor ( field: NormalizedField, target: PropsRecord, manifest: InspectorManifest ): readonly string[]
{
    const options = field.options;

    if ( options === undefined ) { return []; }
    if ( options.source === 'static' ) { return options.values.map( ( entry ) => entry.value ); }
    if ( options.source === 'byField' ) { return options.map[ String( target[ options.byField ] ) ] ?? []; }

    return Object.keys( manifest.tokens[ options.tokenFamily ] ?? {} );
}

export async function loadManifest (): Promise<InspectorManifest>
{
    const response = await fetch( '../../manifest.json' );

    return await response.json() as InspectorManifest;
}
