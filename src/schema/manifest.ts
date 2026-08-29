// Component and package manifests, from SCHEMA section 1: what a
// casomer.json declares, validated strictly. Manifests are data, never
// code; parsing them must be safe against anything the marketplace can
// contain, and unknown keys are rejected because silence hides typos.
// The reserved core/ id space (section 1.1) is enforced here: no package
// may occupy it.

import {
    normalizeFields,
    suggestNearest,
    titleCaseFromKey,
    FieldSchemaError,
    type NormalizedFields,
    type SchemaIssue,
} from './fields.ts';

export type { SchemaIssue } from './fields.ts';

export class ManifestSchemaError extends Error
{
    readonly issues: readonly SchemaIssue[];

    constructor ( issues: readonly SchemaIssue[] )
    {
        const summary = issues.map( ( issue ) => `${issue.path}: ${issue.message}` ).join( '\n' );
        super( `The manifest has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n${summary}` );
        this.name = 'ManifestSchemaError';
        this.issues = issues;
    }
}

// Component ids and anchor ids share a shape: lowercase, digits, and
// hyphens, as in "markdown" and "card-grid". Distinct from field keys,
// which must stay expression-addressable.
const componentIdShape = /^[a-z][a-z0-9-]*$/;

// The npm package-name shape, scoped or not.
const packageNameShape = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const reservedPackageName = 'core';

const componentManifestKeys = [ 'id', 'title', 'description', 'template', 'fields', 'anchors' ];
const anchorKeys = [ 'id', 'label', 'kind' ];
const packageManifestKeys = [ 'schema', 'name', 'components' ];

export interface ComponentAnchor
{
    readonly id: string;
    readonly label: string;
    readonly kind?: string;
}

export interface NormalizedComponentManifest
{
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly templatePath: string;
    readonly fields: NormalizedFields;
    readonly anchors: readonly ComponentAnchor[];
}

export interface NormalizedPackageManifest
{
    readonly schemaVersion: 1;
    readonly name: string;
    readonly componentPaths: readonly string[];
}

function rejectUnknownKeys (
    record: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: SchemaIssue[],
): void
{
    for ( const key of Object.keys( record ) )
    {
        if ( !allowed.includes( key ) )
        {
            issues.push( {
                path: `${path}.${key}`,
                message: `Unknown key "${key}".${suggestNearest( key, allowed )} Unknown keys are rejected, not ignored (SCHEMA section 10).`,
            } );
        }
    }
}

function requireString (
    record: Record<string, unknown>,
    key: string,
    path: string,
    issues: SchemaIssue[],
): string | undefined
{
    const value = record[ key ];

    if ( typeof value === 'string' && value.length > 0 ) { return value; }

    issues.push( { path: `${path}.${key}`, message: `"${key}" is a required, non-empty string.` } );
    return undefined;
}

function normalizeAnchors ( raw: unknown, path: string, issues: SchemaIssue[] ): ComponentAnchor[]
{
    if ( !Array.isArray( raw ) )
    {
        issues.push( { path, message: '"anchors" is an array of { id, label, kind } declarations.' } );
        return [];
    }

    const anchors: ComponentAnchor[] = [];
    const seenIds = new Set<string>();

    for ( const [ index, entry ] of raw.entries() )
    {
        const entryPath = `${path}[${index}]`;

        if ( entry === null || typeof entry !== 'object' || Array.isArray( entry ) )
        {
            issues.push( { path: entryPath, message: 'An anchor is an object with an "id" and optionally "label" and "kind".' } );
            continue;
        }

        const record = entry as Record<string, unknown>;

        rejectUnknownKeys( record, anchorKeys, entryPath, issues );

        const id = requireString( record, 'id', entryPath, issues );

        if ( id === undefined ) { continue; }

        if ( !componentIdShape.test( id ) )
        {
            issues.push( {
                path: `${entryPath}.id`,
                message: `Anchor ids are lowercase letters, digits, and hyphens ("${id}" is not). The id maps to a data-anchor attribute in the template.`,
            } );
            continue;
        }

        if ( seenIds.has( id ) )
        {
            issues.push( {
                path: `${entryPath}.id`,
                message: `Duplicate anchor id "${id}". Morph links attach to anchor ids, so each must be unique within the component.`,
            } );
            continue;
        }

        seenIds.add( id );

        if ( record.kind !== undefined && ( typeof record.kind !== 'string' || record.kind.length === 0 ) )
        {
            issues.push( { path: `${entryPath}.kind`, message: '"kind" is a non-empty string hint, like "image" or "text".' } );
        }

        anchors.push( {
            id,
            label: typeof record.label === 'string' && record.label.length > 0 ? record.label : titleCaseFromKey( id.replace( /-/g, '_' ) ),
            ...( typeof record.kind === 'string' && record.kind.length > 0 ? { kind: record.kind } : {} ),
        } );
    }

    return anchors;
}

export function normalizeComponentManifest ( raw: unknown ): NormalizedComponentManifest
{
    const issues: SchemaIssue[] = [];

    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        throw new ManifestSchemaError( [ { path: 'manifest', message: 'A component manifest is a JSON object.' } ] );
    }

    const record = raw as Record<string, unknown>;

    rejectUnknownKeys( record, componentManifestKeys, 'manifest', issues );

    const id = requireString( record, 'id', 'manifest', issues );

    if ( id !== undefined && !componentIdShape.test( id ) )
    {
        issues.push( {
            path: 'manifest.id',
            message: `Component ids are lowercase letters, digits, and hyphens ("${id}" is not), as in "markdown" or "card-grid".`,
        } );
    }

    const title = requireString( record, 'title', 'manifest', issues );
    const templatePath = requireString( record, 'template', 'manifest', issues );

    if ( templatePath !== undefined && !templatePath.startsWith( './' ) )
    {
        issues.push( {
            path: 'manifest.template',
            message: `"template" is a path relative to the component directory, starting with "./" (got "${templatePath}").`,
        } );
    }

    if ( record.description !== undefined && typeof record.description !== 'string' )
    {
        issues.push( { path: 'manifest.description', message: '"description" is a string.' } );
    }

    let fields: NormalizedFields = {};

    if ( record.fields === undefined )
    {
        issues.push( { path: 'manifest.fields', message: 'Every component declares "fields", even when the map is empty.' } );
    }
    else
    {
        try
        {
            fields = normalizeFields( record.fields );
        }
        catch ( error )
        {
            if ( error instanceof FieldSchemaError )
            {
                issues.push( ...error.issues.map( ( issue ) => ( { path: `manifest.${issue.path}`, message: issue.message } ) ) );
            }
            else { throw error; }
        }
    }

    const anchors = record.anchors === undefined ? [] : normalizeAnchors( record.anchors, 'manifest.anchors', issues );

    if ( issues.length > 0 ) { throw new ManifestSchemaError( issues ); }

    return {
        id: id as string,
        title: title as string,
        ...( typeof record.description === 'string' ? { description: record.description } : {} ),
        templatePath: templatePath as string,
        fields,
        anchors,
    };
}

export function normalizePackageManifest ( raw: unknown ): NormalizedPackageManifest
{
    const issues: SchemaIssue[] = [];

    if ( raw === null || typeof raw !== 'object' || Array.isArray( raw ) )
    {
        throw new ManifestSchemaError( [ { path: 'manifest', message: 'A package manifest is a JSON object.' } ] );
    }

    const record = raw as Record<string, unknown>;

    rejectUnknownKeys( record, packageManifestKeys, 'manifest', issues );

    if ( record.schema !== 1 )
    {
        issues.push( {
            path: 'manifest.schema',
            message: `This version of Casomer understands manifest schema 1; got ${JSON.stringify( record.schema )}. A newer schema needs a newer Casomer.`,
        } );
    }

    const name = requireString( record, 'name', 'manifest', issues );

    if ( name !== undefined )
    {
        if ( !packageNameShape.test( name ) )
        {
            issues.push( { path: 'manifest.name', message: `"${name}" is not a valid npm package name.` } );
        }
        else if ( name === reservedPackageName )
        {
            issues.push( {
                path: 'manifest.name',
                message: 'The "core" package name is reserved: core components ship inside Casomer itself, and no package may occupy the core/ id space (SCHEMA section 1.1).',
            } );
        }
    }

    const componentPaths: string[] = [];

    if ( !Array.isArray( record.components ) || record.components.length === 0 )
    {
        issues.push( { path: 'manifest.components', message: '"components" is a non-empty array of component directory paths.' } );
    }
    else
    {
        const seen = new Set<string>();

        for ( const [ index, entry ] of record.components.entries() )
        {
            const entryPath = `manifest.components[${index}]`;

            if ( typeof entry !== 'string' || !entry.startsWith( './' ) )
            {
                issues.push( { path: entryPath, message: 'A component path is a string relative to the package root, starting with "./".' } );
                continue;
            }

            if ( seen.has( entry ) )
            {
                issues.push( { path: entryPath, message: `Duplicate component path "${entry}".` } );
                continue;
            }

            seen.add( entry );
            componentPaths.push( entry );
        }
    }

    if ( issues.length > 0 ) { throw new ManifestSchemaError( issues ); }

    return { schemaVersion: 1, name: name as string, componentPaths };
}

// Sites reference components as "package/id": "core/markdown",
// "@casomer/components/hero", "somekit/card". The final segment is the
// component id; everything before it is the package name.
export class ComponentReferenceError extends Error
{
    constructor ( message: string )
    {
        super( message );
        this.name = 'ComponentReferenceError';
    }
}

export interface ComponentReference
{
    readonly packageName: string;
    readonly componentId: string;
}

export function parseComponentReference ( source: string ): ComponentReference
{
    const lastSlash = source.lastIndexOf( '/' );

    if ( lastSlash <= 0 || lastSlash === source.length - 1 )
    {
        throw new ComponentReferenceError(
            `"${source}" is not a component reference. References are "package/id", like "core/markdown" or "@casomer/components/hero".`,
        );
    }

    const packageName = source.slice( 0, lastSlash );
    const componentId = source.slice( lastSlash + 1 );

    if ( packageName !== reservedPackageName && !packageNameShape.test( packageName ) )
    {
        throw new ComponentReferenceError( `"${packageName}" is not a valid package name in the reference "${source}".` );
    }

    if ( !componentIdShape.test( componentId ) )
    {
        throw new ComponentReferenceError( `"${componentId}" is not a valid component id in the reference "${source}".` );
    }

    return { packageName, componentId };
}
