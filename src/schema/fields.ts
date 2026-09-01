// Field definitions, from SCHEMA sections 2 through 5: the shorthand
// grammar ( "text! | max:80" ), the object form it is sugar for, the
// per-type validation rule catalog, and the condition wiring. Manifests
// are strict: unknown keys are rejected, not ignored, because silence
// hides typos and typos hide fields. All problems for a fields map are
// collected and reported together, each naming its path.

import {
    parseExpression,
    collectReferencedFieldKeys,
    ExpressionSyntaxError,
    type ExpressionNode,
} from './expressions.ts';

export type FieldType
    = | 'text'
        | 'textarea'
        | 'markdown'
        | 'number'
        | 'toggle'
        | 'select'
        | 'multiselect'
        | 'url'
        | 'email'
        | 'date'
        | 'color'
        | 'image'
        | 'file'
        | 'reference'
        | 'list'
        | 'group';

const fieldTypes: readonly FieldType[] = [
    'text', 'textarea', 'markdown', 'number', 'toggle', 'select', 'multiselect',
    'url', 'email', 'date', 'color', 'image', 'file', 'reference', 'list', 'group',
];

// The rule catalog of SCHEMA section 5, plus the reference type's
// "type" rule from section 2.3. A rule not listed for a type is an
// authoring error, reported with the type's actual vocabulary.
const rulesByType: Readonly<Partial<Record<FieldType, readonly string[]>>> = {
    text: [ 'min', 'max', 'pattern' ],
    textarea: [ 'min', 'max', 'pattern' ],
    markdown: [ 'min', 'max' ],
    url: [ 'min', 'max', 'pattern' ],
    email: [ 'min', 'max', 'pattern' ],
    // "format" picks the date's spoken form wherever it lands in
    // text: long (September 5, 2026 - the default), short (Sep 5,
    // 2026), or iso (as stored). Presentation only; ordering and the
    // editor always use the stored ISO value.
    date: [ 'min', 'max', 'format' ],
    number: [ 'min', 'max', 'step', 'integer' ],
    list: [ 'min', 'max', 'unique' ],

    // A reference targets another id space: "type" for generic entry
    // references, "taxonomy" for term assignment (SCHEMA section 13.3
    // - on collections, never in component manifests). "multiple"
    // makes the value an ARRAY of ids - an event with three speakers.
    reference: [ 'type', 'taxonomy', 'multiple' ],
};

const numericRules = [ 'min', 'max', 'step' ];

const objectFormKeys = [
    'type', 'required', 'label', 'help', 'placeholder', 'default',
    'rules', 'messages', 'showWhen', 'requiredWhen', 'options', 'fields',
    'min', 'max', 'unique', 'alt',
];

// Field keys share the expression language's identifier shape, so every
// field is always addressable from a sibling condition.
const fieldKeyShape = /^[A-Za-z_][A-Za-z0-9_]*$/;

const maximumListDepth = 2;

export interface SchemaIssue
{
    readonly path: string;
    readonly message: string;
}

export class FieldSchemaError extends Error
{
    readonly issues: readonly SchemaIssue[];

    constructor ( issues: readonly SchemaIssue[] )
    {
        const summary = issues.map( ( issue ) => `${issue.path}: ${issue.message}` ).join( '\n' );
        super( `The field schema has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n${summary}` );
        this.name = 'FieldSchemaError';
        this.issues = issues;
    }
}

export type RuleValue = string | number | boolean;

export type FieldOptions
    = | { source: 'static'; values: { value: string; label: string }[] }
        | { source: 'byField'; byField: string; map: Record<string, string[]> }
        | { source: 'fromTokens'; tokenFamily: string };

export interface NormalizedField
{
    readonly type: FieldType;
    readonly required: boolean;
    readonly label: string;
    readonly help?: string;
    readonly placeholder?: string;
    readonly defaultValue?: unknown;
    readonly rules: Readonly<Record<string, RuleValue>>;
    readonly messages: Readonly<Record<string, string>>;
    readonly showWhen?: { source: string; expression: ExpressionNode };
    readonly requiredWhen?: { source: string; expression: ExpressionNode };
    readonly options?: FieldOptions;
    readonly fields?: NormalizedFields;
    readonly decorativeAlt?: boolean;
}

export type NormalizedFields = Readonly<Record<string, NormalizedField>>;

export function titleCaseFromKey ( key: string ): string
{
    return key
        .replace( /_/g, ' ' )
        .replace( /([a-z0-9])([A-Z])/g, '$1 $2' )
        .replace( /\b[a-z]/g, ( letter ) => letter.toUpperCase() )
        .trim();
}

function levenshteinDistance ( a: string, b: string ): number
{
    const distances = Array.from(
        { length: a.length + 1 },
        ( unused, row ) => [ row, ...Array( b.length ).fill( 0 ) as number[] ],
    );

    for ( let column = 1; column <= b.length; column += 1 ) { ( distances[ 0 ] as number[] )[ column ] = column; }

    for ( let row = 1; row <= a.length; row += 1 )
    {
        for ( let column = 1; column <= b.length; column += 1 )
        {
            const substitutionCost = a[ row - 1 ] === b[ column - 1 ] ? 0 : 1;
            const above = distances[ row - 1 ] as number[];
            const current = distances[ row ] as number[];

            current[ column ] = Math.min(
                ( current[ column - 1 ] as number ) + 1,
                ( above[ column ] as number ) + 1,
                ( above[ column - 1 ] as number ) + substitutionCost,
            );
        }
    }

    return ( distances[ a.length ] as number[] )[ b.length ] as number;
}

export function suggestNearest ( unknown: string, known: readonly string[] ): string
{
    let best: string | undefined;
    let bestDistance = 3;

    for ( const candidate of known )
    {
        const distance = levenshteinDistance( unknown.toLowerCase(), candidate.toLowerCase() );

        if ( distance < bestDistance )
        {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best === undefined ? '' : ` Did you mean "${best}"?`;
}

interface ParsedShorthand
{
    type: FieldType;
    required: boolean;
    rules: Record<string, RuleValue>;
}

function parseShorthand ( source: string, path: string, issues: SchemaIssue[] ): ParsedShorthand | undefined
{
    const segments = source.split( '|' ).map( ( segment ) => segment.trim() );
    const head = segments[ 0 ] as string;
    const required = head.endsWith( '!' );
    const typeName = required ? head.slice( 0, -1 ).trim() : head;

    if ( !( fieldTypes as readonly string[] ).includes( typeName ) )
    {
        issues.push( {
            path,
            message: `Unknown field type "${typeName}".${suggestNearest( typeName, fieldTypes )}`,
        } );
        return undefined;
    }

    const type = typeName as FieldType;
    const rules: Record<string, RuleValue> = {};

    for ( const segment of segments.slice( 1 ) )
    {
        if ( segment === '' )
        {
            issues.push( { path, message: 'Empty rule segment. Remove the stray "|".' } );
            continue;
        }

        const separatorIndex = segment.indexOf( ':' );
        const ruleName = ( separatorIndex === -1 ? segment : segment.slice( 0, separatorIndex ) ).trim();
        const rawArgument = separatorIndex === -1 ? undefined : segment.slice( separatorIndex + 1 ).trim();

        appendRule( type, ruleName, rawArgument, rules, path, issues );
    }

    return { type, required, rules };
}

function appendRule (
    type: FieldType,
    ruleName: string,
    rawArgument: string | undefined,
    rules: Record<string, RuleValue>,
    path: string,
    issues: SchemaIssue[],
): void
{
    const allowed = rulesByType[ type ] ?? [];

    if ( !allowed.includes( ruleName ) )
    {
        const vocabulary = allowed.length === 0
            ? `The "${type}" type takes no rules.`
            : `The "${type}" type takes: ${allowed.join( ', ' )}.`;

        issues.push( {
            path,
            message: `The rule "${ruleName}" does not apply to the "${type}" type. ${vocabulary}${suggestNearest( ruleName, allowed )}`,
        } );
        return;
    }

    if ( ruleName === 'integer' || ruleName === 'multiple' )
    {
        rules[ ruleName ] = true;
        return;
    }

    if ( ruleName === 'format' )
    {
        if ( rawArgument !== 'long' && rawArgument !== 'short' && rawArgument !== 'iso' )
        {
            issues.push( { path, message: `The rule "format" takes long, short, or iso; got "${rawArgument ?? ''}".` } );
            return;
        }

        rules[ ruleName ] = rawArgument;
        return;
    }

    if ( rawArgument === undefined || rawArgument === '' )
    {
        issues.push( { path, message: `The rule "${ruleName}" needs a value, like "${ruleName}:10".` } );
        return;
    }

    if ( numericRules.includes( ruleName ) && type !== 'date' )
    {
        const numeric = Number( rawArgument );

        if ( Number.isNaN( numeric ) )
        {
            issues.push( { path, message: `The rule "${ruleName}" needs a number, but got "${rawArgument}".` } );
            return;
        }

        rules[ ruleName ] = numeric;
        return;
    }

    rules[ ruleName ] = rawArgument;
}

function normalizeOptions ( raw: unknown, path: string, issues: SchemaIssue[] ): FieldOptions | undefined
{
    if ( Array.isArray( raw ) )
    {
        const values: { value: string; label: string }[] = [];

        for ( const [ index, entry ] of raw.entries() )
        {
            if ( typeof entry === 'string' )
            {
                values.push( { value: entry, label: entry } );
            }
            else if ( entry !== null && typeof entry === 'object' && typeof ( entry as { value?: unknown } ).value === 'string' )
            {
                const record = entry as { value: string; label?: unknown };
                values.push( { value: record.value, label: typeof record.label === 'string' ? record.label : record.value } );
            }
            else
            {
                issues.push( {
                    path: `${path}.options[${index}]`,
                    message: 'Options are strings or { value, label } objects.',
                } );
            }
        }

        return { source: 'static', values };
    }

    if ( raw !== null && typeof raw === 'object' )
    {
        const record = raw as Record<string, unknown>;

        if ( typeof record.fromTokens === 'string' )
        {
            return { source: 'fromTokens', tokenFamily: record.fromTokens };
        }

        if ( typeof record.byField === 'string' && record.map !== null && typeof record.map === 'object' )
        {
            const map: Record<string, string[]> = {};

            for ( const [ key, list ] of Object.entries( record.map as Record<string, unknown> ) )
            {
                if ( Array.isArray( list ) && list.every( ( item ) => typeof item === 'string' ) )
                {
                    map[ key ] = list as string[];
                }
                else
                {
                    issues.push( {
                        path: `${path}.options.map.${key}`,
                        message: 'Each map entry is an array of option strings.',
                    } );
                }
            }

            return { source: 'byField', byField: record.byField, map };
        }
    }

    issues.push( {
        path: `${path}.options`,
        message: 'Options are an array, { "byField", "map" }, or { "fromTokens" }.',
    } );
    return undefined;
}

function normalizeField (
    key: string,
    raw: unknown,
    path: string,
    listDepth: number,
    issues: SchemaIssue[],
): NormalizedField | undefined
{
    if ( typeof raw === 'string' )
    {
        const shorthand = parseShorthand( raw, path, issues );

        if ( shorthand === undefined ) { return undefined; }

        return {
            type: shorthand.type,
            required: shorthand.required,
            label: titleCaseFromKey( key ),
            rules: shorthand.rules,
            messages: {},
            ...requireOptionsIssue( shorthand.type, undefined, path, issues ),
        };
    }

    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: 'A field is a shorthand string or an object with a "type".' } );
        return undefined;
    }

    const record = raw as Record<string, unknown>;

    for ( const presentKey of Object.keys( record ) )
    {
        if ( !objectFormKeys.includes( presentKey ) )
        {
            issues.push( {
                path: `${path}.${presentKey}`,
                message: `Unknown key "${presentKey}".${suggestNearest( presentKey, objectFormKeys )} Unknown keys are rejected because a typo here silently hides a field.`,
            } );
        }
    }

    if ( typeof record.type !== 'string' || !( fieldTypes as readonly string[] ).includes( record.type ) )
    {
        issues.push( {
            path,
            message: `Every field needs a "type" from: ${fieldTypes.join( ', ' )}.${typeof record.type === 'string' ? suggestNearest( record.type, fieldTypes ) : ''}`,
        } );
        return undefined;
    }

    const type = record.type as FieldType;
    const rules: Record<string, RuleValue> = {};

    if ( record.rules !== undefined )
    {
        if ( record.rules === null || typeof record.rules !== 'object' || Array.isArray( record.rules ) )
        {
            issues.push( { path: `${path}.rules`, message: '"rules" is an object of rule names to values.' } );
        }
        else
        {
            for ( const [ ruleName, ruleValue ] of Object.entries( record.rules as Record<string, unknown> ) )
            {
                appendRule( type, ruleName, String( ruleValue ), rules, `${path}.rules`, issues );
            }
        }
    }

    // A list's top-level min/max (SCHEMA section 2.4) are sugar for rules.
    for ( const listRule of [ 'min', 'max', 'unique' ] as const )
    {
        if ( record[ listRule ] !== undefined )
        {
            if ( type === 'list' )
            {
                appendRule( type, listRule, String( record[ listRule ] ), rules, path, issues );
            }
            else
            {
                issues.push( {
                    path: `${path}.${listRule}`,
                    message: `Top-level "${listRule}" belongs to list fields; for other types put it under "rules".`,
                } );
            }
        }
    }

    const messages: Record<string, string> = {};

    if ( record.messages !== undefined && record.messages !== null && typeof record.messages === 'object' )
    {
        for ( const [ ruleName, message ] of Object.entries( record.messages as Record<string, unknown> ) )
        {
            if ( rules[ ruleName ] === undefined )
            {
                issues.push( {
                    path: `${path}.messages.${ruleName}`,
                    message: `There is a message for "${ruleName}", but no such rule on this field.`,
                } );
            }
            else if ( typeof message === 'string' )
            {
                messages[ ruleName ] = message;
            }
        }
    }

    let fields: NormalizedFields | undefined;

    if ( type === 'list' || type === 'group' )
    {
        const nextListDepth = type === 'list' ? listDepth + 1 : listDepth;

        if ( type === 'list' && nextListDepth > maximumListDepth )
        {
            issues.push( {
                path,
                message: `Lists nest to a maximum depth of ${maximumListDepth}. Deeper structure belongs in the relational layer: a post type, referenced from here.`,
            } );
        }
        else if ( record.fields === undefined )
        {
            issues.push( { path, message: `A ${type} declares its item shape under "fields".` } );
        }
        else
        {
            fields = normalizeFieldsScope( record.fields, `${path}.fields`, nextListDepth, issues );
        }
    }
    else if ( record.fields !== undefined )
    {
        issues.push( { path: `${path}.fields`, message: `Only list and group fields contain "fields", not "${type}".` } );
    }

    let decorativeAlt: boolean | undefined;

    if ( record.alt !== undefined )
    {
        if ( type === 'image' && record.alt === 'optional' )
        {
            decorativeAlt = true;
        }
        else
        {
            issues.push( {
                path: `${path}.alt`,
                message: 'Only image fields may declare "alt": "optional", and only for decorative images (they compile to alt="").',
            } );
        }
    }

    const conditions: { showWhen?: { source: string; expression: ExpressionNode }; requiredWhen?: { source: string; expression: ExpressionNode } } = {};

    for ( const conditionKey of [ 'showWhen', 'requiredWhen' ] as const )
    {
        const source = record[ conditionKey ];

        if ( source === undefined ) { continue; }

        if ( typeof source !== 'string' )
        {
            issues.push( { path: `${path}.${conditionKey}`, message: `"${conditionKey}" is an expression string.` } );
            continue;
        }

        try
        {
            conditions[ conditionKey ] = { source, expression: parseExpression( source ) };
        }
        catch ( error )
        {
            if ( error instanceof ExpressionSyntaxError )
            {
                issues.push( { path: `${path}.${conditionKey}`, message: error.message } );
                continue;
            }

            throw error;
        }
    }

    return {
        type,
        required: record.required === true,
        label: typeof record.label === 'string' ? record.label : titleCaseFromKey( key ),
        ...( typeof record.help === 'string' ? { help: record.help } : {} ),
        ...( typeof record.placeholder === 'string' ? { placeholder: record.placeholder } : {} ),
        ...( record.default !== undefined ? { defaultValue: record.default } : {} ),
        rules,
        messages,
        ...conditions,
        ...( fields !== undefined ? { fields } : {} ),
        ...( decorativeAlt !== undefined ? { decorativeAlt } : {} ),
        ...requireOptionsIssue( type, record.options, path, issues ),
    };
}

function requireOptionsIssue (
    type: FieldType,
    rawOptions: unknown,
    path: string,
    issues: SchemaIssue[],
): Pick<NormalizedField, 'options'>
{
    const needsOptions = type === 'select' || type === 'multiselect';

    if ( rawOptions === undefined )
    {
        if ( needsOptions )
        {
            issues.push( { path, message: `A ${type} field needs "options" (SCHEMA section 4), so shorthand cannot express it alone.` } );
        }

        return {};
    }

    if ( !needsOptions )
    {
        issues.push( { path: `${path}.options`, message: `Only select and multiselect fields take "options", not "${type}".` } );
        return {};
    }

    const options = normalizeOptions( rawOptions, path, issues );
    return options === undefined ? {} : { options };
}

// Conditions see siblings only (SCHEMA section 3.1), so each fields map is
// its own scope: unknown keys and circular showWhen chains are judged
// against the scope's own keys, and a list item's conditions see the item's
// siblings, not the page's.
function analyzeConditionScope ( fields: NormalizedFields, path: string, issues: SchemaIssue[] ): void
{
    const siblingKeys = Object.keys( fields );
    const visibilityDependencies = new Map<string, string[]>();

    for ( const [ key, field ] of Object.entries( fields ) )
    {
        for ( const conditionKey of [ 'showWhen', 'requiredWhen' ] as const )
        {
            const condition = field[ conditionKey ];

            if ( condition === undefined ) { continue; }

            const referenced = [ ...collectReferencedFieldKeys( condition.expression ) ];

            for ( const referencedKey of referenced )
            {
                if ( !siblingKeys.includes( referencedKey ) )
                {
                    issues.push( {
                        path: `${path}.${key}.${conditionKey}`,
                        message: `The condition refers to "${referencedKey}", but no sibling field has that key.${suggestNearest( referencedKey, siblingKeys )}`,
                    } );
                }
            }

            if ( conditionKey === 'showWhen' ) { visibilityDependencies.set( key, referenced ); }
        }

        if ( field.options?.source === 'byField' && !siblingKeys.includes( field.options.byField ) )
        {
            issues.push( {
                path: `${path}.${key}.options.byField`,
                message: `"byField" refers to "${field.options.byField}", but no sibling field has that key.${suggestNearest( field.options.byField, siblingKeys )}`,
            } );
        }
    }

    const settled = new Set<string>();

    const findCycle = ( key: string, trail: string[] ): void =>
    {
        const cycleStart = trail.indexOf( key );

        if ( cycleStart !== -1 )
        {
            const cycle = [ ...trail.slice( cycleStart ), key ].join( ' -> ' );
            issues.push( {
                path: `${path}.${key}.showWhen`,
                message: `Circular showWhen chain: ${cycle}. Visibility must settle without loops (SCHEMA section 3.1).`,
            } );
            return;
        }

        if ( settled.has( key ) ) { return; }

        for ( const dependency of visibilityDependencies.get( key ) ?? [] )
        {
            findCycle( dependency, [ ...trail, key ] );
        }

        settled.add( key );
    };

    for ( const key of visibilityDependencies.keys() ) { findCycle( key, [] ); }
}

function normalizeFieldsScope (
    raw: unknown,
    path: string,
    listDepth: number,
    issues: SchemaIssue[],
): NormalizedFields
{
    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        issues.push( { path, message: '"fields" is an ordered map of field keys to definitions.' } );
        return {};
    }

    const normalized: Record<string, NormalizedField> = {};

    for ( const [ key, definition ] of Object.entries( raw as Record<string, unknown> ) )
    {
        if ( !fieldKeyShape.test( key ) )
        {
            issues.push( {
                path: `${path}.${key}`,
                message: 'Field keys are letters, digits, and underscores, starting with a letter or underscore, so conditions can always refer to them.',
            } );
            continue;
        }

        const field = normalizeField( key, definition, `${path}.${key}`, listDepth, issues );

        if ( field !== undefined ) { normalized[ key ] = field; }
    }

    analyzeConditionScope( normalized, path, issues );
    return normalized;
}

export function normalizeFields ( raw: unknown ): NormalizedFields
{
    const issues: SchemaIssue[] = [];
    const fields = normalizeFieldsScope( raw, 'fields', 0, issues );

    if ( issues.length > 0 ) { throw new FieldSchemaError( issues ); }

    return fields;
}
