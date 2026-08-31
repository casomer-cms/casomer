// The caso verbs (SCHEMA section 15): each names its outcome, each is
// also a Studio action, and each stays thin over the modules it calls.
// This module is importable so the verbs are testable; bin/caso.js
// dispatches through main.ts. The vocabulary stays translated: users
// see publish, backup, and restore language; the word git appears only
// where a user has gone looking for it.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { buildSite } from '../compiler/buildSite.ts';
import { loadPackageFromDirectory, type LoadedPackage } from '../schema/loadPackage.ts';
import { type SchemaIssue } from '../schema/manifest.ts';
import { serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';
import { startPreviewServer } from './previewServer.ts';
import {
    addOriginRemote,
    commit,
    findOrCreateRepository,
    hasRemote,
    hasStagedChanges,
    isPathIgnored,
    pushCurrentBranch,
    runGit,
    stagePaths,
} from '../git/repository.ts';
import {
    getValidAccessToken,
    githubAppSlug,
    listAccessibleRepositories,
    pollForAccessToken,
    requestDeviceCode,
} from '../git/githubApp.ts';

const { version } = createRequire( import.meta.url )( '../../package.json' ) as { version: string };

// The paths Casomer owns in a project: scoped staging, never -A.
const ownPaths = [ 'site.json', 'pages.json', '.gitattributes', 'dist' ];

function printIssues ( issues: readonly SchemaIssue[] ): void
{
    for ( const issue of issues )
    {
        console.error( `  ${issue.path}: ${issue.message}` );
    }
}

async function exists ( path: string ): Promise<boolean>
{
    try
    {
        await access( path );
        return true;
    }
    catch
    {
        return false;
    }
}

interface BuildArguments
{
    contentDirectory: string;
    outputDirectory: string;
    packageDirectories: string[];
    pretty: boolean;
}

function parseBuildArguments ( argv: readonly string[], cwd: string ): BuildArguments
{
    const parsed: BuildArguments = {
        contentDirectory: cwd,
        outputDirectory: resolve( cwd, 'dist' ),
        packageDirectories: [],
        pretty: false,
    };

    let index = 0;

    while ( index < argv.length )
    {
        const flag = argv[ index ];

        if ( flag === '--pretty' )
        {
            parsed.pretty = true;
            index += 1;
            continue;
        }

        const value = argv[ index + 1 ];

        if ( value === undefined )
        {
            throw new Error( `The ${flag} flag needs a value.` );
        }

        switch ( flag )
        {
            case '--content': parsed.contentDirectory = resolve( cwd, value ); break;
            case '--out': parsed.outputDirectory = resolve( cwd, value ); break;
            case '--package': parsed.packageDirectories.push( resolve( cwd, value ) ); break;
            default: throw new Error( `Unknown flag "${flag}". caso build takes --content, --out, --package, and --pretty.` );
        }

        index += 2;
    }

    return parsed;
}

async function loadPackages ( directories: readonly string[] ): Promise<LoadedPackage[] | undefined>
{
    const packages: LoadedPackage[] = [];

    for ( const directory of directories )
    {
        const result = await loadPackageFromDirectory( directory );

        if ( result.issues.length > 0 )
        {
            console.error( `The package at ${directory} has problems:` );
            printIssues( result.issues );
            return undefined;
        }

        if ( result.loadedPackage !== undefined ) { packages.push( result.loadedPackage ); }
    }

    return packages;
}

export async function runBuild ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    const buildArguments = parseBuildArguments( argv, cwd );
    const packages = await loadPackages( buildArguments.packageDirectories );

    if ( packages === undefined ) { return 1; }

    const result = await buildSite( {
        contentDirectory: buildArguments.contentDirectory,
        outputDirectory: buildArguments.outputDirectory,
        packages,
        generatorVersion: version,
        minify: !buildArguments.pretty,
    } );

    if ( result.issues.length > 0 )
    {
        console.error( 'The site did not build:' );
        printIssues( result.issues );
        return 1;
    }

    console.log( `built ${result.pagesWritten.length} page${result.pagesWritten.length === 1 ? '' : 's'} to ${buildArguments.outputDirectory}` );
    return 0;
}

export async function runPreview ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    let directory = resolve( cwd, 'dist' );
    let port: number | undefined;

    for ( let index = 0; index < argv.length; index += 2 )
    {
        const flag = argv[ index ];
        const value = argv[ index + 1 ];

        if ( value === undefined ) { throw new Error( `The ${flag} flag needs a value.` ); }

        switch ( flag )
        {
            case '--dir': directory = resolve( cwd, value ); break;
            case '--port': port = Number( value ); break;
            default: throw new Error( `Unknown flag "${flag}". caso preview takes --dir and --port.` );
        }
    }

    const defaultPort = 2277;
    let server;

    try
    {
        server = await startPreviewServer( directory, port ?? defaultPort );
    }
    catch ( error )
    {
        if ( port === undefined && ( error as NodeJS.ErrnoException ).code === 'EADDRINUSE' )
        {
            server = await startPreviewServer( directory, 0 );
            console.log( `port ${defaultPort} is busy; using a free port instead` );
        }
        else { throw error; }
    }

    console.log( `previewing ${directory}` );
    console.log( `  ${server.url}` );
    return 0;
}

// Ownership check per SCHEMA section 13.1: identity lives in the data,
// not the filename. Unreadable or unparsable also means "not ours".
async function isCasomerFile ( file: string ): Promise<boolean>
{
    try
    {
        const value = JSON.parse( await readFile( file, 'utf8' ) ) as unknown;

        return value !== null && typeof value === 'object' && !Array.isArray( value )
            && ( value as Record<string, unknown> ).casomerSchema === 1;
    }
    catch
    {
        return false;
    }
}

function starterSite ( declaredUse?: string ): JsonValue
{
    return {
        casomerSchema: 1,
        ...( declaredUse === undefined ? {} : { use: declaredUse } ),
        theme: {
            colors: { primary: '#1A1D28', secondary: '#F7F5F0', tertiary: '#E8A13D' },
            widths: { narrow: '42rem', prose: '65ch', wide: '80rem' },
            spacing: { xs: '0.5rem', sm: '1rem', md: '2rem', lg: '4rem' },
            radius: { none: '0', sm: '0.25rem', md: '0.75rem', full: '9999px' },
            shadows: { none: 'none', low: '0 1px 2px rgba(0,0,0,0.08)' },
            typography: { sans: 'system-ui, sans-serif' },
            breakpoints: { sm: 640, md: 768, lg: 1024 },
            allowCustomColors: false,
            rhythm: 'lg',
        },
    };
}

function starterPages (): JsonValue
{
    return {
        casomerSchema: 1,
        pages: [
            {
                id: randomUUID(),
                title: 'Home',
                slug: 'home',
                blocks: [
                    {
                        component: 'core/markdown',
                        props: {
                            content: '# Welcome\n\nThis site is powered by Casomer. Edit pages.json to make it yours; caso build compiles it, caso publish saves a version.',
                        },
                    },
                ],
            },
        ],
    };
}

async function connectRemote ( cwd: string, url: string ): Promise<void>
{
    const added = await addOriginRemote( cwd, url );

    if ( added.code !== 0 )
    {
        console.log( `could not add the remote: ${added.stderr.trim()}` );
        return;
    }

    const reachable = await runGit( cwd, [ 'ls-remote', '--exit-code', 'origin', 'HEAD' ] );

    if ( reachable.code === 0 || reachable.code === 2 )
    {
        console.log( 'connected and reachable; publishes will back up there' );
        return;
    }

    // The remote is saved anyway: revisitable, never fatal. Casomer uses
    // your git's own credentials and never stores any of its own.
    console.log( 'the remote was saved, but could not be reached just now.' );
    console.log( 'if it is private, make sure git itself can access it - SSH keys or' );
    console.log( 'the GitHub CLI (gh auth login) both work. Casomer uses your git\'s' );
    console.log( 'own credentials and never stores any of its own. The next publish' );
    console.log( 'will try again.' );
}

// The device flow needs only the public client id, and the repo list is
// exactly what the user granted at install time: the GitHub App model
// doing its job. The credential helper keeps git supplied with fresh
// short-lived tokens from then on.
// Best-effort clipboard copy so the device code is a paste, not a
// transcription. Silent on failure: the code is printed either way.
function copyToClipboard ( text: string ): boolean
{
    const command = process.platform === 'win32'
        ? { file: 'clip', arguments_: [] }
        : ( process.platform === 'darwin'
                ? { file: 'pbcopy', arguments_: [] }
                : { file: 'xclip', arguments_: [ '-selection', 'clipboard' ] } );

    try
    {
        const result = spawnSync( command.file, command.arguments_, { input: text } );

        return result.status === 0;
    }
    catch
    {
        return false;
    }
}

async function connectGitHub ( cwd: string ): Promise<void>
{
    let tokens = await getValidAccessToken();

    if ( tokens === undefined )
    {
        const authorization = await requestDeviceCode();
        const copied = copyToClipboard( authorization.userCode );
        const url = authorization.verificationUriComplete ?? authorization.verificationUri;

        console.log( `to connect GitHub, open ${url} and enter the code ${authorization.userCode}${copied ? ' (already on your clipboard)' : ''}` );
        console.log( 'waiting for you to authorize...' );
        tokens = await pollForAccessToken( authorization );
        console.log( 'connected to GitHub' );
    }

    let repositories = await listAccessibleRepositories( tokens.accessToken );

    while ( repositories.length === 0 )
    {
        console.log( 'the Casomer CMS app is not installed on any repository yet.' );
        console.log( `create a repository if you need one (https://github.com/new), then install the app on it:` );
        console.log( `  https://github.com/apps/${githubAppSlug}/installations/new` );
        await ask( 'press Enter here once that is done: ' );
        repositories = await listAccessibleRepositories( tokens.accessToken );
    }

    console.log( 'repositories the app can reach:' );

    for ( const [ index, repository ] of repositories.slice( 0, 30 ).entries() )
    {
        console.log( `  ${index + 1}. ${repository.fullName}${repository.isPrivate ? ' (private)' : ''}` );
    }

    const choice = await ask( 'pick a number, or type owner/repo: ' );
    const fullName = /^[0-9]+$/.test( choice )
        ? repositories[ Number( choice ) - 1 ]?.fullName
        : ( /^[^\/\s]+\/[^\/\s]+$/.test( choice ) ? choice : undefined );

    if ( fullName === undefined )
    {
        console.log( 'that did not match a repository; run caso init again to retry' );
        return;
    }

    await addOriginRemote( cwd, `https://github.com/${fullName}.git` );
    await runGit( cwd, [ 'config', '--local', 'credential.https://github.com.helper', '!caso credential' ] );
    console.log( `connected ${fullName}; publishes will back up there` );
}

// The git credential helper: on "get" for github.com, answer with a
// fresh short-lived token. Git never stores it; we mint on demand.
export async function runCredential ( argv: readonly string[] ): Promise<number>
{
    if ( argv[ 0 ] !== 'get' ) { return 0; }

    let input = '';

    for await ( const chunk of process.stdin ) { input += String( chunk ); }

    const host = /^host=(.+)$/m.exec( input )?.[ 1 ]?.trim();

    if ( host !== 'github.com' ) { return 0; }

    const tokens = await getValidAccessToken();

    if ( tokens === undefined )
    {
        console.error( 'the GitHub connection has expired; run caso init and choose github to reconnect' );
        return 1;
    }

    console.log( 'username=x-access-token' );
    console.log( `password=${tokens.accessToken}` );
    return 0;
}

async function ask ( prompt: string ): Promise<string>
{
    const readline = createInterface( { input: process.stdin, output: process.stdout } );
    const answer = await readline.question( prompt );

    readline.close();
    return answer.trim();
}

export async function runInit ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    let remote: string | undefined;
    let declared: 'personal' | 'commercial' | undefined;
    let index = 0;

    while ( index < argv.length )
    {
        const flag = argv[ index ];

        if ( flag === '--personal' || flag === '--commercial' )
        {
            declared = flag === '--personal' ? 'personal' : 'commercial';
            index += 1;
            continue;
        }

        const value = argv[ index + 1 ];

        if ( value === undefined ) { throw new Error( `The ${flag} flag needs a value.` ); }

        if ( flag === '--remote' ) { remote = value; }
        else { throw new Error( `Unknown flag "${flag}". caso init takes --remote, --personal, and --commercial.` ); }

        index += 2;
    }

    const siteFile = join( cwd, 'site.json' );
    const siteExists = await exists( siteFile );

    // A site.json is only ours if its data says so (SCHEMA section 13.1).
    // A foreign one is never adopted and never overwritten - and the
    // refusal comes before any repository work touches the folder.
    if ( siteExists && !( await isCasomerFile( siteFile ) ) )
    {
        console.log( 'site.json here belongs to something else (no "casomerSchema" key), so it stays untouched.' );
        console.log( 'start in an empty folder, or keep the Casomer site in a subdirectory and build with --content.' );
        return 1;
    }

    const { created } = await findOrCreateRepository( cwd );

    console.log( created
        ? 'created a local repository; history and restore work from minute one'
        : 'adopted the existing repository; Casomer will only ever touch its own files' );

    if ( !siteExists )
    {
        const promptable = process.stdin.isTTY === true && process.stdout.isTTY === true;

        if ( declared === undefined && promptable )
        {
            const choice = ( await ask( 'is this site for personal use, or commercial? [personal/commercial] (Enter for personal): ' ) ).toLowerCase();

            if ( choice === 'commercial' )
            {
                // Active micro-assent at the moment of relevance
                // (BUSINESS section 5.4): choosing commercial includes
                // an explicit confirmation.
                const confirmed = ( await ask( 'commercial production use requires a license once the site goes live; a 14 day evaluation is included. Type yes to confirm: ' ) ).toLowerCase();

                declared = confirmed === 'yes' ? 'commercial' : undefined;

                if ( declared === undefined ) { console.log( 'left undeclared; run caso init again any time to declare' ); }
            }
            else if ( choice === '' || choice === 'personal' )
            {
                declared = 'personal';
            }
        }

        await writeFile( join( cwd, 'site.json' ), serializeCanonicalJson( starterSite( declared ) ), 'utf8' );
        await writeFile( join( cwd, 'pages.json' ), serializeCanonicalJson( starterPages() ), 'utf8' );
        console.log( 'created site.json and pages.json with a starter home page' );

        if ( declared !== undefined ) { console.log( `declared as a ${declared} site` ); }
    }

    if ( !( await exists( join( cwd, '.gitattributes' ) ) ) )
    {
        await writeFile( join( cwd, '.gitattributes' ), '* text=auto eol=lf\n', 'utf8' );
    }

    if ( await isPathIgnored( cwd, 'dist/probe' ) )
    {
        console.warn( 'warning: your .gitignore ignores dist/, but Casomer publishes commit the compiled site' );
        console.warn( '  so a publish can be reviewed and reverted as one unit. Remove the dist/ line to fix this.' );
    }

    if ( remote !== undefined )
    {
        if ( remote.toLowerCase() === 'github' )
        {
            if ( process.stdin.isTTY !== true )
            {
                throw new Error( 'connecting GitHub needs an interactive terminal for the device code.' );
            }

            await connectGitHub( cwd );
        }
        else
        {
            await connectRemote( cwd, remote );
        }
    }
    else if ( !( await hasRemote( cwd ) ) )
    {
        // The remote is the only prompt: optional, skippable,
        // revisitable (SCHEMA section 14). Never in a script.
        const promptable = process.stdin.isTTY === true && process.stdout.isTTY === true;

        if ( promptable )
        {
            console.log( 'back up this site to a remote?' );
            console.log( '  1. connect GitHub' );
            console.log( '  2. use another git remote (paste a URL)' );
            console.log( '  3. skip for now' );

            const choice = await ask( 'pick a number (Enter for 3): ' );

            if ( choice === '1' )
            {
                await connectGitHub( cwd );
            }
            else if ( choice === '2' )
            {
                const url = await ask( 'git remote URL: ' );

                if ( url !== '' )
                {
                    await connectRemote( cwd, url );
                }
                else
                {
                    console.log( 'no URL given; skipped. Add one any time: caso init --remote <url>' );
                }
            }
            else
            {
                console.log( 'skipped; publishes stay local. Add one any time: caso init --remote <url>' );
            }
        }
        else
        {
            console.log( 'no remote configured; publishes stay local. Add one any time: caso init --remote <url>' );
        }
    }

    const identity = await runGit( cwd, [ 'config', 'user.name' ] );

    if ( identity.code !== 0 || identity.stdout.trim() === '' )
    {
        console.log( 'one-time setup before your first publish, so versions carry your name:' );
        console.log( '  git config --global user.name "Your Name"' );
        console.log( '  git config --global user.email "you@example.com"' );
    }

    console.log( 'ready. next steps:' );
    console.log( '  caso build      compile the site to dist/' );
    console.log( '  caso preview    open the built site in your browser' );
    console.log( '  caso publish    save a version (build + commit, push if a remote is set)' );
    return 0;
}

export async function runPublish ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    if ( argv.length > 0 )
    {
        throw new Error( 'caso publish takes no flags; it builds the project in the current directory and saves a version.' );
    }

    await findOrCreateRepository( cwd );

    const result = await buildSite( {
        contentDirectory: cwd,
        outputDirectory: join( cwd, 'dist' ),
        generatorVersion: version,
    } );

    if ( result.issues.length > 0 )
    {
        console.error( 'The site did not build, so nothing was published:' );
        printIssues( result.issues );
        return 1;
    }

    const stageable: string[] = [];

    for ( const path of ownPaths )
    {
        if ( await exists( join( cwd, path ) ) ) { stageable.push( path ); }
    }

    await stagePaths( cwd, stageable );

    if ( !( await hasStagedChanges( cwd ) ) )
    {
        console.log( 'nothing to publish; the last publish is already current' );
        return 0;
    }

    const pageCount = result.pagesWritten.length;
    const commitResult = await commit( cwd, `casomer: publish ${pageCount} page${pageCount === 1 ? '' : 's'}` );

    if ( commitResult.code !== 0 )
    {
        if ( /user\.name|user\.email|tell me who you are/i.test( commitResult.stderr + commitResult.stdout ) )
        {
            console.error( 'git needs to know who you are before it can save a version. One-time setup:' );
            console.error( '  git config --global user.name "Your Name"' );
            console.error( '  git config --global user.email "you@example.com"' );
            return 1;
        }

        console.error( `the publish could not be saved: ${commitResult.stderr.trim()}` );
        return 1;
    }

    console.log( `published ${pageCount} page${pageCount === 1 ? '' : 's'}` );

    // Push never blocks publish: the local repository is the source of
    // truth, and a failed push queues quietly for next time.
    if ( await hasRemote( cwd ) )
    {
        const pushResult = await pushCurrentBranch( cwd );

        console.log( pushResult.code === 0
            ? 'backed up to the remote'
            : 'local only for now; the remote could not be reached, and the next publish will try again' );
    }
    else
    {
        console.log( 'local only; add a remote to back up publishes (caso init --remote <url>)' );
    }

    return 0;
}
