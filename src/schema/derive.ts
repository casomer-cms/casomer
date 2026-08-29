// Derived artifacts, from SCHEMA section 9: authors write one manifest,
// and the toolchain derives everything else. Here: the JSON Schema for
// validation engines and IDE autocomplete, the TypeScript props type for
// component authors, and the docs stub for a component README. Editor UI
// generation is the same idea at M4, live instead of emitted.

import { type JsonValue } from '../content/canonicalJson.ts';
import { type NormalizedComponentManifest } from './manifest.ts';
import { type NormalizedField, type NormalizedFields } from './fields.ts';

type SchemaObject = { [ key: string ]: JsonValue };

function staticOptionValues ( field: NormalizedField ): string[] | undefined
{
    if ( field.options?.source !== 'static' ) { return undefined; }

    return field.options.values.map( ( option ) => option.value );
}

function describeConditions ( field: NormalizedField ): string
{
    const notes: string[] = [];

    if ( field.showWhen !== undefined ) { notes.push( `shown when: ${field.showWhen.source}` ); }
    if ( field.requiredWhen !== undefined ) { notes.push( `required when: ${field.requiredWhen.source}` ); }

    return notes.length === 0 ? '' : ` (${notes.join( '; ' )})`;
}

function fieldToJsonSchema ( field: NormalizedField ): SchemaObject
{
    const base: SchemaObject = { title: field.label };
    const description = `${field.help ?? ''}${describeConditions( field )}`.trim();

    if ( description !== '' ) { base.description = description; }

    switch ( field.type )
    {
        case 'text':
        case 'textarea':
        case 'markdown':
        case 'color':
        {
            const schema: SchemaObject = { ...base, type: 'string' };

            if ( typeof field.rules.min === 'number' ) { schema.minLength = field.rules.min; }
            if ( typeof field.rules.max === 'number' ) { schema.maxLength = field.rules.max; }
            if ( typeof field.rules.pattern === 'string' ) { schema.pattern = field.rules.pattern; }

            return schema;
        }

        case 'url': return { ...base, type: 'string', format: 'uri' };
        case 'email': return { ...base, type: 'string', format: 'email' };
        case 'date': return { ...base, type: 'string', format: 'date' };

        case 'number':
        {
            const schema: SchemaObject = { ...base, type: field.rules.integer === true ? 'integer' : 'number' };

            if ( typeof field.rules.min === 'number' ) { schema.minimum = field.rules.min; }
            if ( typeof field.rules.max === 'number' ) { schema.maximum = field.rules.max; }
            if ( typeof field.rules.step === 'number' ) { schema.multipleOf = field.rules.step; }

            return schema;
        }

        case 'toggle': return { ...base, type: 'boolean' };

        case 'select':
        {
            const values = staticOptionValues( field );

            return values === undefined ? { ...base, type: 'string' } : { ...base, type: 'string', enum: values };
        }

        case 'multiselect':
        {
            const values = staticOptionValues( field );
            const items: SchemaObject = values === undefined ? { type: 'string' } : { type: 'string', enum: values };

            return { ...base, type: 'array', items };
        }

        case 'image':
            return {
                ...base,
                type: 'object',
                properties: {
                    src: { type: 'string' },
                    alt: { type: 'string' },
                    width: { type: 'integer' },
                    height: { type: 'integer' },
                },
                required: field.decorativeAlt === true ? [ 'src' ] : [ 'src', 'alt' ],
                additionalProperties: true,
            };

        case 'file':
            return {
                ...base,
                type: 'object',
                properties: {
                    src: { type: 'string' },
                    name: { type: 'string' },
                    size: { type: 'integer' },
                },
                required: [ 'src' ],
                additionalProperties: true,
            };

        case 'reference': return { ...base, type: 'string' };

        case 'list':
        {
            const schema: SchemaObject = { ...base, type: 'array', items: fieldsToObjectSchema( field.fields ?? {} ) };

            if ( typeof field.rules.min === 'number' ) { schema.minItems = field.rules.min; }
            if ( typeof field.rules.max === 'number' ) { schema.maxItems = field.rules.max; }

            return schema;
        }

        case 'group': return { ...base, ...fieldsToObjectSchema( field.fields ?? {} ) };
    }
}

function fieldsToObjectSchema ( fields: NormalizedFields ): SchemaObject
{
    const properties: SchemaObject = {};
    const required: string[] = [];

    for ( const [ key, field ] of Object.entries( fields ) )
    {
        properties[ key ] = fieldToJsonSchema( field );

        // A field behind showWhen may legitimately be absent (hidden
        // fields are omitted, SCHEMA section 3.2), and requiredWhen is
        // conditional, so only unconditional requiredness lands here.
        if ( field.required && field.showWhen === undefined ) { required.push( key ); }
    }

    return {
        type: 'object',
        properties,
        ...( required.length > 0 ? { required } : {} ),
        // Content is lenient where users' work lives: orphaned props
        // persist (SCHEMA section 10.1), so documents never fail for
        // carrying data a schema no longer names.
        additionalProperties: true,
    };
}

export function deriveJsonSchema ( manifest: NormalizedComponentManifest ): JsonValue
{
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: manifest.title,
        ...( manifest.description === undefined ? {} : { description: manifest.description } ),
        ...fieldsToObjectSchema( manifest.fields ),
    };
}

function pascalCaseFromId ( id: string ): string
{
    return id.split( '-' ).map( ( part ) => part.charAt( 0 ).toUpperCase() + part.slice( 1 ) ).join( '' );
}

function fieldToTypeScript ( field: NormalizedField, indent: string ): string
{
    switch ( field.type )
    {
        case 'text':
        case 'textarea':
        case 'markdown':
        case 'color':
        case 'url':
        case 'email':
        case 'date':
        case 'reference':
            return 'string';

        case 'number': return 'number';
        case 'toggle': return 'boolean';

        case 'select':
        {
            const values = staticOptionValues( field );

            return values === undefined ? 'string' : values.map( ( value ) => `'${value}'` ).join( ' | ' );
        }

        case 'multiselect':
        {
            const values = staticOptionValues( field );

            return values === undefined ? 'string[]' : `( ${values.map( ( value ) => `'${value}'` ).join( ' | ' )} )[]`;
        }

        case 'image':
            return field.decorativeAlt === true
                ? '{ src: string; alt?: string; width?: number; height?: number }'
                : '{ src: string; alt: string; width?: number; height?: number }';

        case 'file': return '{ src: string; name?: string; size?: number }';

        case 'list': return `${fieldsToTypeScriptObject( field.fields ?? {}, indent )}[]`;
        case 'group': return fieldsToTypeScriptObject( field.fields ?? {}, indent );
    }
}

function fieldsToTypeScriptObject ( fields: NormalizedFields, indent: string ): string
{
    const memberIndent = `${indent}    `;
    const members = Object.entries( fields ).map( ( [ key, field ] ) =>
    {
        const optional = field.required && field.showWhen === undefined ? '' : '?';
        const documentation = field.help === undefined ? '' : `${memberIndent}/** ${field.help} */\n`;

        return `${documentation}${memberIndent}${key}${optional}: ${fieldToTypeScript( field, memberIndent )};`;
    } );

    return `{\n${members.join( '\n' )}\n${indent}}`;
}

export function derivePropsInterface ( manifest: NormalizedComponentManifest ): string
{
    const name = `${pascalCaseFromId( manifest.id )}Props`;
    const header = `// Derived from the "${manifest.id}" component manifest. Do not edit;\n`
        + '// regenerate from casomer.json.\n';

    return `${header}export interface ${name}\n${fieldsToTypeScriptObject( manifest.fields, '' )}\n`;
}

function summarizeRules ( field: NormalizedField ): string
{
    const parts = Object.entries( field.rules ).map(
        ( [ name, value ] ) => ( value === true ? name : `${name}: ${String( value )}` ),
    );

    return parts.join( ', ' );
}

export function deriveDocsStub ( manifest: NormalizedComponentManifest ): string
{
    const lines: string[] = [ `# ${manifest.title}`, '' ];

    if ( manifest.description !== undefined ) { lines.push( manifest.description, '' ); }

    lines.push( '## Fields', '', '| Field | Type | Required | Notes |', '|---|---|---|---|' );

    for ( const [ key, field ] of Object.entries( manifest.fields ) )
    {
        const required = field.required ? ( field.showWhen === undefined ? 'yes' : 'when shown' ) : 'no';
        const notes = [ field.help, summarizeRules( field ), describeConditions( field ).trim() ]
            .filter( ( part ) => part !== undefined && part !== '' )
            .join( ' ' );

        lines.push( `| \`${key}\` | ${field.type} | ${required} | ${notes} |` );
    }

    if ( manifest.anchors.length > 0 )
    {
        lines.push( '', '## Anchors', '', '| Anchor | Kind |', '|---|---|' );

        for ( const anchor of manifest.anchors )
        {
            lines.push( `| \`${anchor.id}\` (${anchor.label}) | ${anchor.kind ?? ''} |` );
        }
    }

    lines.push( '' );
    return lines.join( '\n' );
}
