// Loading a component package from disk: the root casomer.json names the
// component directories (SCHEMA section 1), each of which holds its own
// manifest and template. Everything is parsed as data; nothing from a
// package is ever executed. Issues carry the file they came from.

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    normalizeComponentManifest,
    normalizePackageManifest,
    ManifestSchemaError,
    type NormalizedComponentManifest,
    type NormalizedPackageManifest,
    type SchemaIssue,
} from './manifest.ts';

export interface LoadedComponent
{
    readonly manifest: NormalizedComponentManifest;
    readonly directory: string;
    readonly templateFile: string;
}

export interface LoadedPackage
{
    readonly manifest: NormalizedPackageManifest;
    readonly directory: string;
    readonly components: ReadonlyMap<string, LoadedComponent>;
}

export interface PackageLoadResult
{
    readonly loadedPackage?: LoadedPackage;
    readonly issues: readonly SchemaIssue[];
}

async function readJsonFile ( file: string, issues: SchemaIssue[] ): Promise<unknown>
{
    let text: string;

    try
    {
        text = await readFile( file, 'utf8' );
    }
    catch
    {
        issues.push( { path: file, message: 'The file is missing or unreadable.' } );
        return undefined;
    }

    try
    {
        return JSON.parse( text ) as unknown;
    }
    catch ( error )
    {
        issues.push( { path: file, message: `The file is not valid JSON: ${( error as Error ).message}.` } );
        return undefined;
    }
}

function mergeManifestIssues ( error: unknown, file: string, issues: SchemaIssue[] ): void
{
    if ( error instanceof ManifestSchemaError )
    {
        issues.push( ...error.issues.map( ( issue ) => ( { path: `${file}: ${issue.path}`, message: issue.message } ) ) );
        return;
    }

    throw error;
}

export async function loadPackageFromDirectory ( directory: string ): Promise<PackageLoadResult>
{
    const issues: SchemaIssue[] = [];
    const manifestFile = join( directory, 'casomer.json' );
    const rawManifest = await readJsonFile( manifestFile, issues );

    if ( rawManifest === undefined ) { return { issues }; }

    let packageManifest: NormalizedPackageManifest;

    try
    {
        packageManifest = normalizePackageManifest( rawManifest );
    }
    catch ( error )
    {
        mergeManifestIssues( error, manifestFile, issues );
        return { issues };
    }

    const components = new Map<string, LoadedComponent>();

    for ( const componentPath of packageManifest.componentPaths )
    {
        const componentDirectory = join( directory, componentPath );
        const componentManifestFile = join( componentDirectory, 'casomer.json' );
        const rawComponent = await readJsonFile( componentManifestFile, issues );

        if ( rawComponent === undefined ) { continue; }

        let componentManifest: NormalizedComponentManifest;

        try
        {
            componentManifest = normalizeComponentManifest( rawComponent );
        }
        catch ( error )
        {
            mergeManifestIssues( error, componentManifestFile, issues );
            continue;
        }

        if ( components.has( componentManifest.id ) )
        {
            issues.push( {
                path: `${componentManifestFile}: manifest.id`,
                message: `Duplicate component id "${componentManifest.id}" within the package. Ids must be unique so "${packageManifest.name}/${componentManifest.id}" stays unambiguous.`,
            } );
            continue;
        }

        const templateFile = join( componentDirectory, componentManifest.templatePath );

        try
        {
            await access( templateFile );
        }
        catch
        {
            issues.push( {
                path: `${componentManifestFile}: manifest.template`,
                message: `The template "${componentManifest.templatePath}" does not exist in the component directory.`,
            } );
            continue;
        }

        components.set( componentManifest.id, { manifest: componentManifest, directory: componentDirectory, templateFile } );
    }

    return {
        loadedPackage: { manifest: packageManifest, directory, components },
        issues,
    };
}
