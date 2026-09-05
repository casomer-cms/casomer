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
import { fileURLToPath } from 'node:url';

import { buildSite } from '../compiler/buildSite.ts';
import { loadPackageFromDirectory, type LoadedPackage } from '../schema/loadPackage.ts';
import { type SchemaIssue } from '../schema/manifest.ts';
import { serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';
import { normalizeOrigin } from '../content/siteConfig.ts';
import { GRACE_DAYS, claimSupporterMoment, licenseKeyVerdict, licensePageUrl, licenseState, looksLikeLicenseKey, publishCount, recordGraceStart, siteKeyFor, storeLicenseKey } from '../licensing/gate.ts';
import { cleanKey } from '../licensing/keys.ts';
import { deployTargetOf, hasCredential, normalizeRemotePath, readDeployRecord, runDeploy, testConnection, updateDeployRecord, type SftpTarget } from '../deploy/sftp.ts';
import { createInterface as createClassicInterface } from 'node:readline';
import { recheckKeysAtPublish } from '../licensing/recheck.ts';
import { activateLicenseOnline, checkKeyOnline, onlineProblem } from '../licensing/relay.ts';
import { startPreviewServer } from './previewServer.ts';
import { startStudioServer } from '../studio/server.ts';
import {
    addOriginRemote,
    appendIgnoreLines,
    commit,
    findOrCreateRepository,
    hasRemote,
    hasStagedChanges,
    isPathIgnored,
    pullCurrentBranch,
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
    usesGitHubApp,
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

export async function runStudio ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    let contentDirectory = cwd;
    let port: number | undefined;
    let host: string | undefined;
    let token: string | undefined;
    let open = false;
    const packageDirectories: string[] = [];

    for ( let index = 0; index < argv.length; )
    {
        const flag = argv[ index ];

        if ( flag === '--open' )
        {
            open = true;
            index += 1;
            continue;
        }

        const value = argv[ index + 1 ];

        if ( value === undefined ) { throw new Error( `The ${flag} flag needs a value.` ); }

        switch ( flag )
        {
            case '--content': contentDirectory = resolve( cwd, value ); break;
            case '--port': port = Number( value ); break;
            case '--host': host = value; break;
            case '--token': token = value; break;
            case '--package': packageDirectories.push( resolve( cwd, value ) ); break;
            default: throw new Error( `Unknown flag "${flag}". caso studio takes --content, --port, --host, --token, --package, and --open.` );
        }

        index += 2;
    }

    // A folder that is not a site yet runs init inline first (SCHEMA
    // section 15): the same prompts, in the terminal the user is
    // already in, then Studio opens. An invalid site.json is the
    // opposite case and never re-inits: Studio opens and surfaces the
    // validation errors.
    if ( !await exists( join( contentDirectory, 'site.json' ) ) )
    {
        if ( contentDirectory !== cwd )
        {
            console.error( `There is no site.json in ${contentDirectory}.` );
            return 1;
        }

        console.log( `this folder isn't a casomer site yet` );

        const initResult = await runInit( [], cwd );

        if ( initResult !== 0 ) { return initResult; }
    }

    const packages = await loadPackages( packageDirectories );

    if ( packages === undefined ) { return 1; }

    const assetsDirectory = fileURLToPath( new URL( '../../studio/app/', import.meta.url ) );
    const options = {
        contentDirectory,
        assetsDirectory,
        packages,
        generatorVersion: version,
        ...host === undefined ? {} : { host },
        ...token === undefined ? {} : { token },
    };
    const defaultPort = 2276;
    let server;

    try
    {
        server = await startStudioServer( options, port ?? defaultPort );
    }
    catch ( error )
    {
        if ( port === undefined && ( error as NodeJS.ErrnoException ).code === 'EADDRINUSE' )
        {
            server = await startStudioServer( options, 0 );
            console.log( `port ${defaultPort} is busy; using a free port instead` );
        }
        else { throw error; }
    }

    console.log( `studio is running for ${contentDirectory}` );
    console.log( `  ${server.url}` );

    if ( open )
    {
        const opener = process.platform === 'win32'
            ? { command: 'cmd', prefix: [ '/c', 'start', '' ] }
            : process.platform === 'darwin' ? { command: 'open', prefix: [] } : { command: 'xdg-open', prefix: [] };

        spawnSync( opener.command, [ ...opener.prefix, server.url ], { stdio: 'ignore' } );
    }

    return 0;
}

// caso save (SCHEMA section 15): a version exists. Commits the content
// documents, never dist; Studio's Save button performs the same act.
export async function runSave ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    if ( argv.length > 0 )
    {
        throw new Error( 'caso save takes no flags; it records a version of the site in the current directory.' );
    }

    const top = await runGit( cwd, [ 'rev-parse', '--show-toplevel' ] );
    const sameRoot = top.code === 0
        && resolve( top.stdout.trim() ).toLowerCase() === resolve( cwd ).toLowerCase();

    if ( !sameRoot )
    {
        console.error( `this folder isn't its own repository, so versions can't be saved here. Run caso init first.` );
        return 1;
    }

    await stagePaths( cwd, [ 'site.json', 'pages.json' ] );

    if ( !await hasStagedChanges( cwd ) )
    {
        console.log( 'nothing new since the last save' );
        return 0;
    }

    const result = await commit( cwd, 'casomer: save' );

    if ( result.code !== 0 )
    {
        console.error( 'the save did not complete:' );
        console.error( result.stderr.trim() );
        return 1;
    }

    console.log( 'saved. History keeps this version; publish releases it.' );
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

function starterSite ( declaredUse?: string, trackMedia = true, origin?: string ): JsonValue
{
    return {
        casomerSchema: 1,
        ...( declaredUse === undefined ? {} : { use: declaredUse } ),
        ...( origin === undefined ? {} : { origin } ),
        ...( trackMedia ? {} : { media: { track: false } } ),
        theme: {
            colors: { primary: '#1A1D28', secondary: '#F7F5F0', accent: '#E8A13D' },
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
        console.error( 'the GitHub connection has expired; reconnect in Studio (Site settings, Go live, Pull & push) or run caso init and choose github' );
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
    let origin: string | undefined;
    let declared: 'personal' | 'commercial' | undefined;
    let trackMedia: boolean | undefined;
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

        if ( flag === '--track-media' || flag === '--no-track-media' )
        {
            trackMedia = flag === '--track-media';
            index += 1;
            continue;
        }

        const value = argv[ index + 1 ];

        if ( value === undefined ) { throw new Error( `The ${flag} flag needs a value.` ); }

        if ( flag === '--remote' ) { remote = value; }
        else if ( flag === '--origin' )
        {
            const normalized = normalizeOrigin( value );

            if ( normalized === null || normalized === '' ) { throw new Error( `--origin is the site's public address, a scheme and host such as https://example.com (got "${value}").` ); }

            origin = normalized;
        }
        else { throw new Error( `Unknown flag "${flag}". caso init takes --remote, --origin, --personal, --commercial, --track-media, and --no-track-media.` ); }

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

        // The public address (SCHEMA 12.3), asked at the door and
        // editable later in Site settings: the licensing clock and
        // key bind to its host, so a commercial site wants it early.
        if ( origin === undefined && promptable )
        {
            while ( true )
            {
                const answer = await ask( 'where will this site live? its public address, like https://example.com (Enter to decide later): ' );
                const normalized = normalizeOrigin( answer );

                if ( normalized === '' ) { break; }
                if ( normalized !== null )
                {
                    origin = normalized;
                    break;
                }

                console.log( 'that is not an address; a scheme and host, with no path' );
            }
        }

        // Media tracking is a choice at the door (Mikey, 2026-09-01):
        // most sites version their media with everything else; tech
        // users can keep binaries out of the repo entirely. Declining
        // WRITES the .gitignore immediately - anything less and the
        // files would get tracked, which is exactly what was refused.
        if ( trackMedia === undefined && promptable )
        {
            const choice = ( await ask( 'version media files (images, uploads) in git along with content? [Y/n] (Enter for yes): ' ) ).toLowerCase();

            trackMedia = choice !== 'n' && choice !== 'no';
        }

        await writeFile( join( cwd, 'site.json' ), serializeCanonicalJson( starterSite( declared, trackMedia !== false, origin ) ), 'utf8' );
        await writeFile( join( cwd, 'pages.json' ), serializeCanonicalJson( starterPages() ), 'utf8' );
        console.log( 'created site.json and pages.json with a starter home page' );

        if ( declared !== undefined ) { console.log( `declared as a ${declared} site` ); }

        if ( trackMedia === false )
        {
            await appendIgnoreLines( cwd, [ 'media/', 'dist/media/' ] );
            console.log( 'media stays untracked (.gitignore covers media/ and dist/media/); labels and metadata still version.' );
            console.log( 'your published site will need media delivered by other means - a CDN, object storage, or a copy step.' );
        }
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
    console.log( '  caso studio     open the editor' );
    console.log( '  caso save       record a version you can return to' );
    console.log( '  caso build      compile the site to dist/' );
    console.log( '  caso preview    open the built site in your browser' );
    console.log( '  caso publish    save a version (build + commit, push if a remote is set)' );
    return 0;
}

// The declaration and address, raw from site.json, for the gate.
async function siteMetaFor ( cwd: string ): Promise<{ declaredUse: 'personal' | 'commercial'; origin: string }>
{
    try
    {
        const raw = JSON.parse( await readFile( join( cwd, 'site.json' ), 'utf8' ) ) as { use?: unknown; origin?: unknown } | null;

        return {
            declaredUse: raw?.use === 'commercial' ? 'commercial' : 'personal',
            origin: typeof raw?.origin === 'string' ? ( normalizeOrigin( raw.origin ) ?? '' ) : '',
        };
    }
    catch
    {
        return { declaredUse: 'personal', origin: '' };
    }
}

// caso license <key>: the key for the site in the current folder,
// kept in the user config under the site's key (its origin host, else
// the folder), never in the repository. Signed-key verification is
// owed before go-live; today any non-empty key is taken at its word.
export async function runLicense ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    // The key as pasted: a shell may have split a folded one into
    // several words, and cleanKey drops quotes and brackets.
    const key = cleanKey( argv.join( '' ) );

    if ( argv.length === 0 || !looksLikeLicenseKey( key ) )
    {
        throw new Error( 'caso license takes the license key from your email: caso license CSMR.…' );
    }

    const meta = await siteMetaFor( cwd );
    const siteKey = siteKeyFor( meta.origin, cwd );
    const verdict = licenseKeyVerdict( key, siteKey );

    if ( !verdict.ok )
    {
        console.error( verdict.problem );
        return 1;
    }

    const online = await checkKeyOnline( key, siteKey );

    if ( online !== null && !online.valid )
    {
        console.error( onlineProblem( online, 'license' ) );
        return 1;
    }

    await storeLicenseKey( siteKey, key );
    console.log( `licensed ${siteKey}; the key stays in your user config, never in the site folder` );

    if ( online === null ) { console.log( 'casomer.com could not be reached; the key verified here and will be confirmed later' ); }
    else { await activateLicenseOnline( key, siteKey ); }

    if ( meta.declaredUse !== 'commercial' ) { console.log( 'note: this site is not declared commercial, so the key is kept but not needed' ); }

    return 0;
}

export async function runPublish ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    if ( argv.length > 0 )
    {
        throw new Error( 'caso publish takes no flags; it builds the project in the current directory and saves a version.' );
    }

    await findOrCreateRepository( cwd );

    // The grace gate (BUSINESS 5.3), the same one Studio runs: an
    // ended evaluation needs the key before anything builds.
    const meta = await siteMetaFor( cwd );

    // Revocation reaches this computer here (Mikey, 2026-09-04): the
    // stored keys are asked about once a day at most, a revoked one is
    // cleared and said, and no answer is no news.
    for ( const notice of await recheckKeysAtPublish( siteKeyFor( meta.origin, cwd ) ) ) { console.error( notice.problem ); }

    const gate = await licenseState( { directory: cwd, declaredUse: meta.declaredUse, origin: meta.origin } );

    if ( gate.phase === 'expired' )
    {
        console.error( 'the evaluation has ended; publishing this site needs its license key.' );
        console.error( `  get one at ${licensePageUrl( meta.origin )}, then: caso license <key>` );
        console.error( '  (or re-declare the site with caso init --personal if it is genuinely personal)' );
        return 1;
    }

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
        console.log( 'nothing new to publish; the last publish is already current' );

        // A publish with nothing new still pulls and pushes (Mikey,
        // 2026-09-03): the way to retry after an offline publish.
        await pullAndPush( cwd );
        await deployAfterPublish( cwd, gate.siteKey );

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

    // The moments after a publish (BUSINESS 5.3, 5.5): the first
    // commercial publish opens the window and writes its witness; a
    // running window says how long is left; a personal site's fifth
    // and fortieth publish offer support, once each.
    if ( gate.declaredUse === 'commercial' )
    {
        if ( gate.anchor === null )
        {
            await recordGraceStart( gate.siteKey, new Date().toISOString() );
            console.log( `this site's ${GRACE_DAYS} day evaluation starts now; license it at ${licensePageUrl( meta.origin )}` );
        }
        else if ( gate.phase === 'grace' )
        {
            console.log( `${gate.daysLeft} day${gate.daysLeft === 1 ? '' : 's'} left to license this site: ${licensePageUrl( meta.origin )}` );
        }
    }
    else
    {
        const moment = await claimSupporterMoment( await publishCount( cwd ) );

        if ( moment === 5 ) { console.log( 'five publishes in; glad it is working for you. Personal sites are free forever; if Casomer has earned it, you can support development at https://casomer.com/supporters' ); }
        if ( moment === 40 ) { console.log( 'forty publishes in; this site has come a long way. Personal sites stay free forever; if Casomer has earned its keep, you can support development at https://casomer.com/supporters' ); }
    }

    await pullAndPush( cwd );
    await deployAfterPublish( cwd, gate.siteKey );

    return 0;
}

// Pull & push (Go live, EDITOR): never blocks publish; the local
// repository is the source of truth. The remote's latest is pulled
// first; a conflict or a dead remote is said loudly (Mikey,
// 2026-09-03: a live site still showing the previous version must not
// read as a bug), and the next publish tries again.
async function pullAndPush ( cwd: string ): Promise<void>
{
    if ( !await hasRemote( cwd ) )
    {
        console.log( 'local only; add a remote to pull & push on publish (caso init --remote <url>)' );
        return;
    }

    if ( !await gitDeployEnabledIn( cwd ) )
    {
        console.log( 'pull & push is off; the publish stays on this machine (caso deploy git on)' );
        return;
    }

    // A GitHub App remote whose tokens have died (six months unused)
    // is said before git fails on it, with where to reconnect.
    const remote = await runGit( cwd, [ 'remote', 'get-url', 'origin' ] );
    const helper = await runGit( cwd, [ 'config', '--local', 'credential.https://github.com.helper' ] );

    if ( remote.code === 0 && usesGitHubApp( remote.stdout, helper.code === 0 ? helper.stdout : '' ) && await getValidAccessToken() === undefined )
    {
        console.warn( 'warning: saved here, not pushed: your GitHub connection has expired.' );
        console.warn( '  reconnect in Studio (Site settings, Go live, Pull & push) or with caso init and choose github; the next publish pushes.' );
        return;
    }

    const pulled = await pullCurrentBranch( cwd );

    if ( pulled.kind === 'conflict' )
    {
        console.warn( 'warning: saved here, not pushed: your remote has changes that conflict with this publish.' );
        console.warn( '  nothing was lost. Pull and resolve them in git, then publish again.' );
        if ( pulled.detail !== '' ) { console.warn( `  (${pulled.detail})` ); }
        return;
    }

    if ( pulled.kind === 'failed' )
    {
        console.warn( 'warning: saved here, but the remote could not be reached, so nothing left this computer.' );
        console.warn( '  the next publish sends everything once you are connected.' );
        if ( pulled.detail !== '' ) { console.warn( `  (${pulled.detail})` ); }
        return;
    }

    const pushResult = await pushCurrentBranch( cwd );

    if ( pushResult.code === 0 ) { console.log( pulled.kind === 'pulled' ? 'pulled the remote\'s latest and pushed' : 'pushed to the remote' ); }
    else
    {
        console.warn( 'warning: saved here, but the remote could not be reached, so nothing left this computer.' );
        console.warn( '  the next publish sends everything once you are connected.' );

        const reason = pushResult.stderr.trim().split( '\n' ).find( ( line ) => line.trim() !== '' );

        if ( reason !== undefined ) { console.warn( `  (${reason.trim()})` ); }
    }
}

async function gitDeployEnabledIn ( cwd: string ): Promise<boolean>
{
    try
    {
        const raw = JSON.parse( await readFile( join( cwd, 'site.json' ), 'utf8' ) ) as { deploy?: { git?: { enabled?: unknown } } } | null;

        return raw?.deploy?.git?.enabled !== false;
    }
    catch
    {
        return true;
    }
}

// Go live (SCHEMA 12.4): the upload rides after the commit and the
// backup, never blocks either, and says what it did. A failed one is
// carried again by the next publish, or by caso deploy.
async function deployTargetIn ( cwd: string ): Promise<SftpTarget | null>
{
    try
    {
        const raw = JSON.parse( await readFile( join( cwd, 'site.json' ), 'utf8' ) ) as { deploy?: unknown } | null;

        return deployTargetOf( raw?.deploy );
    }
    catch
    {
        return null;
    }
}

async function deployAfterPublish ( cwd: string, siteKey: string ): Promise<void>
{
    const target = await deployTargetIn( cwd );

    if ( target === null ) { return; }
    if ( !target.enabled )
    {
        console.log( 'go live is off; nothing was uploaded (caso deploy on)' );
        return;
    }

    const outcome = await runDeploy( cwd, siteKey, target );

    if ( outcome.ok )
    {
        const moved = outcome.uploaded + outcome.deleted;

        console.log( moved === 0 ? `your host is already current (${target.host})` : `uploaded ${outcome.uploaded} file${outcome.uploaded === 1 ? '' : 's'}${outcome.deleted > 0 ? `, removed ${outcome.deleted}` : ''} to ${target.host}:${target.path}${outcome.full ? ' (everything, first time)' : ''}` );
    }
    else
    {
        console.warn( `warning: saved and backed up, but not uploaded: ${outcome.error}` );
        console.warn( '  your host still shows the previous version. The next publish carries it, or: caso deploy' );
    }
}

async function promptSecret ( question: string ): Promise<string>
{
    return new Promise( ( resolve ) =>
    {
        const readline = createClassicInterface( { input: process.stdin, output: process.stdout, terminal: true } );
        const muted = readline as unknown as { _writeToOutput: ( text: string ) => void };

        process.stdout.write( question );
        muted._writeToOutput = () => {};
        readline.question( '', ( answer ) =>
        {
            readline.close();
            process.stdout.write( '\n' );
            resolve( answer );
        } );
    } );
}

// caso deploy: the Go live card from the terminal.
//   caso deploy                         upload what changed since the last upload
//   caso deploy --all                   upload everything under dist
//   caso deploy test                    log in and look at the folder
//   caso deploy set <host> <user> <folder> [--port N]
//   caso deploy password                prompt for the password (kept in your user config)
//   caso deploy key <file>              use a private key file instead
//   caso deploy on | off                keep the details, switch the upload
//   caso deploy git on | off            switch pull & push on publish
export async function runDeployCommand ( argv: readonly string[], cwd = process.cwd() ): Promise<number>
{
    const meta = await siteMetaFor( cwd );
    const siteKey = siteKeyFor( meta.origin, cwd );
    const verb = argv[ 0 ] ?? '';
    const siteFile = join( cwd, 'site.json' );
    const writeTarget = async ( target: SftpTarget ): Promise<void> =>
    {
        const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;

        raw.deploy = { ...( raw.deploy !== null && typeof raw.deploy === 'object' ? raw.deploy as Record<string, unknown> : {} ), sftp: { host: target.host, port: target.port, user: target.user, path: target.path, enabled: target.enabled } };
        await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
    };

    if ( verb === 'git' )
    {
        const state = argv[ 1 ];

        if ( state !== 'on' && state !== 'off' ) { throw new Error( 'caso deploy git on | off' ); }

        const raw = JSON.parse( await readFile( siteFile, 'utf8' ) ) as Record<string, unknown>;
        const deploy = raw.deploy !== null && typeof raw.deploy === 'object' ? raw.deploy as Record<string, unknown> : {};

        if ( state === 'on' ) { delete deploy.git; }
        else { deploy.git = { enabled: false }; }

        if ( Object.keys( deploy ).length === 0 ) { delete raw.deploy; }
        else { raw.deploy = deploy; }

        await writeFile( siteFile, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
        console.log( state === 'on' ? 'pull & push is on; each publish pulls the remote\'s latest and pushes' : 'pull & push is off; publishes stay on this machine until it is on again' );
        return 0;
    }

    if ( verb === 'set' )
    {
        const [ , host = '', user = '', folder = '' ] = argv;
        const portFlag = argv.indexOf( '--port' );
        const port = portFlag === -1 ? 22 : Number( argv[ portFlag + 1 ] );

        if ( host === '' || user === '' || /[\s/]/.test( host ) || !Number.isInteger( port ) || port < 1 || port > 65535 )
        {
            throw new Error( 'caso deploy set <host> <user> <folder> [--port N]' );
        }

        const current = await deployTargetIn( cwd );

        await writeTarget( { host, port, user, path: normalizeRemotePath( folder ), enabled: true } );

        if ( current !== null && ( current.host !== host || current.path !== normalizeRemotePath( folder ) ) ) { await updateDeployRecord( siteKey, { hostKey: undefined, commit: undefined, manifest: undefined } ); }

        console.log( `go live: ${user}@${host}${port === 22 ? '' : `:${port}`}:${normalizeRemotePath( folder )}; next: caso deploy password (or caso deploy key <file>), then caso deploy test` );
        return 0;
    }

    if ( verb === 'password' )
    {
        const password = await promptSecret( 'Password (kept in your user config, never in the site folder): ' );

        if ( password === '' )
        {
            console.error( 'no password entered' );
            return 1;
        }

        await updateDeployRecord( siteKey, { password, keyFile: undefined, passphrase: undefined } );
        console.log( 'password saved for this site on this computer; now: caso deploy test' );
        return 0;
    }

    if ( verb === 'key' )
    {
        const file = argv[ 1 ] ?? '';

        if ( file === '' || !( await exists( file ) ) ) { throw new Error( 'caso deploy key <path to a private key file>' ); }

        const passphrase = await promptSecret( 'Passphrase (blank if the key has none): ' );

        await updateDeployRecord( siteKey, { keyFile: resolve( cwd, file ), password: undefined, passphrase: passphrase === '' ? undefined : passphrase } );
        console.log( 'key file saved for this site on this computer; now: caso deploy test' );
        return 0;
    }

    const target = await deployTargetIn( cwd );

    if ( target === null )
    {
        console.error( 'no host is set for this site. First: caso deploy set <host> <user> <folder>' );
        return 1;
    }

    if ( verb === 'on' || verb === 'off' )
    {
        await writeTarget( { ...target, enabled: verb === 'on' } );
        console.log( verb === 'on' ? 'go live is on; each publish uploads what changed' : 'go live is off; the details are kept, nothing is uploaded' );
        return 0;
    }

    const record = await readDeployRecord( siteKey );

    if ( !hasCredential( record ) )
    {
        console.error( 'no password or key file is set for the host. First: caso deploy password (or caso deploy key <file>)' );
        return 1;
    }

    if ( verb === 'test' )
    {
        const outcome = await testConnection( target, record );

        if ( !outcome.ok )
        {
            console.error( outcome.error );
            return 1;
        }

        if ( outcome.trusted === 'new' ) { await updateDeployRecord( siteKey, { hostKey: outcome.hostKey } ); }

        console.log( `connected to ${target.user}@${target.host}; ${target.path} holds ${outcome.entries} item${outcome.entries === 1 ? '' : 's'}${outcome.trusted === 'new' ? '; the host\'s key is now trusted' : ''}` );
        return 0;
    }

    if ( verb !== '' && verb !== '--all' ) { throw new Error( 'caso deploy takes: (nothing), --all, test, set, password, key, on, off' ); }
    if ( verb === '--all' ) { await updateDeployRecord( siteKey, { commit: undefined, manifest: undefined } ); }

    const outcome = await runDeploy( cwd, siteKey, target );

    if ( !outcome.ok )
    {
        console.error( outcome.error );
        return 1;
    }

    const moved = outcome.uploaded + outcome.deleted;

    console.log( moved === 0 ? `your host is already current (${target.host})` : `uploaded ${outcome.uploaded} file${outcome.uploaded === 1 ? '' : 's'}${outcome.deleted > 0 ? `, removed ${outcome.deleted}` : ''} to ${target.host}:${target.path}${outcome.full ? ' (everything)' : ''}` );
    return 0;
}
