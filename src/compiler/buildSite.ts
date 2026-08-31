// caso build, as a function: a content directory and packages in, a
// dist/ directory out. Parameterizable by design (BUSINESS section 4.1):
// every input and the output target are explicit arguments, so building
// any git ref to any destination is plumbing for whoever checks the ref
// out, never a change here. The build validates first and refuses to
// write anything when validation fails: a broken site produces issues,
// not a broken dist/.

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type SchemaIssue } from '../schema/manifest.ts';
import { type LoadedPackage } from '../schema/loadPackage.ts';
import { loadSiteDirectory } from '../content/loadSiteDirectory.ts';
import { loadCoreComponents } from './coreComponents.ts';
import { assemblePage } from './assemblePage.ts';
import { generateThemeInputCss } from './themeCss.ts';
import { minifyHtml } from './minifyHtml.ts';
import { prettifyHtml } from './prettifyHtml.ts';

export interface BuildOptions
{
    readonly contentDirectory: string;
    readonly outputDirectory: string;
    readonly packages?: readonly LoadedPackage[];
    readonly generatorVersion?: string;
    readonly css?: boolean;
    readonly minify?: boolean;
}

export interface BuildResult
{
    readonly issues: readonly SchemaIssue[];
    readonly pagesWritten: readonly string[];
}

function resolveTailwindCssEntry (): string
{
    const require = createRequire( import.meta.url );

    return join( dirname( require.resolve( 'tailwindcss/package.json' ) ), 'index.css' ).replaceAll( '\\', '/' );
}

function resolveTailwindCli (): string
{
    const require = createRequire( import.meta.url );
    const packageFile = require.resolve( '@tailwindcss/cli/package.json' );
    const binField = ( require( '@tailwindcss/cli/package.json' ) as { bin: Record<string, string> | string } ).bin;
    const binPath = typeof binField === 'string' ? binField : Object.values( binField )[ 0 ] as string;

    return join( dirname( packageFile ), binPath );
}

export async function buildSite ( options: BuildOptions ): Promise<BuildResult>
{
    const packages = options.packages ?? [];
    const site = await loadSiteDirectory( options.contentDirectory, packages );

    if ( site.issues.length > 0 ) { return { issues: site.issues, pagesWritten: [] }; }

    const coreComponents = await loadCoreComponents();
    const issues: SchemaIssue[] = [];
    const pagesWritten: string[] = [];

    await rm( options.outputDirectory, { recursive: true, force: true } );
    await mkdir( options.outputDirectory, { recursive: true } );

    for ( const page of site.pages )
    {
        const assembled = await assemblePage( page, {
            config: site.config,
            packages,
            coreComponents,
            ...( options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion } ),
        } );

        issues.push( ...assembled.issues.map( ( issue ) => ( { path: `${page.slug}: ${issue.path}`, message: issue.message } ) ) );

        const relativeFile = page.slug === 'home' ? 'index.html' : `${page.slug}/index.html`;
        const file = join( options.outputDirectory, ...relativeFile.split( '/' ) );

        await mkdir( dirname( file ), { recursive: true } );
        await writeFile( file, options.minify === false ? prettifyHtml( assembled.html ) : minifyHtml( assembled.html ), 'utf8' );
        pagesWritten.push( relativeFile );
    }

    // The delivered-site scripts: vendored Alpine and the MIT runtime
    // (TRANSITIONS section 1; the tedxv2 vendoring precedent).
    const jsDirectory = join( options.outputDirectory, 'assets', 'js' );
    const require = createRequire( import.meta.url );

    await mkdir( jsDirectory, { recursive: true } );
    await copyFile(
        join( dirname( require.resolve( 'alpinejs/package.json' ) ), 'dist', 'cdn.min.js' ),
        join( jsDirectory, 'alpine.min.js' ),
    );
    await copyFile(
        fileURLToPath( new URL( '../../runtime/casomer-runtime.js', import.meta.url ) ),
        join( jsDirectory, 'casomer-runtime.js' ),
    );

    if ( options.css !== false )
    {
        const cssDirectory = join( options.outputDirectory, 'assets', 'css' );

        await mkdir( cssDirectory, { recursive: true } );

        const inputFile = join( cssDirectory, 'theme.css' );

        await writeFile( inputFile, generateThemeInputCss( site.config, resolveTailwindCssEntry() ), 'utf8' );
        execFileSync(
            process.execPath,
            [ resolveTailwindCli(), '-i', inputFile, '-o', join( cssDirectory, 'main.css' ) ],
            { cwd: options.outputDirectory, stdio: 'pipe' },
        );
    }

    return { issues, pagesWritten };
}
