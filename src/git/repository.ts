// The git module, from SCHEMA section 14: git is never a question, only
// the remote is. Publish equals commit, so every Casomer project has a
// repository, found or created silently. Monorepo manners throughout:
// Casomer stages only its own paths, never -A, and never touches
// unrelated files or history. The platform git binary does the work;
// a dependency would be weight without benefit.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify( execFile );

// The .gitignore lines Casomer manages for the media-tracking choice
// (SCHEMA 13.4): added when the user declines tracking, removed when
// they turn it back on. Only these EXACT lines are ever touched -
// the rest of a .gitignore belongs to the user.
export async function appendIgnoreLines ( directory: string, lines: readonly string[] ): Promise<void>
{
    let current = '';

    try
    {
        current = await readFile( join( directory, '.gitignore' ), 'utf8' );
    }
    catch { /* no .gitignore yet */ }

    const present = new Set( current.split( /\r?\n/ ).map( ( line ) => line.trim() ) );
    const missing = lines.filter( ( line ) => !present.has( line ) );

    if ( missing.length === 0 ) { return; }

    const glue = current === '' || current.endsWith( '\n' ) ? '' : '\n';

    await writeFile( join( directory, '.gitignore' ), `${current}${glue}${missing.join( '\n' )}\n`, 'utf8' );
}

export async function removeIgnoreLines ( directory: string, lines: readonly string[] ): Promise<void>
{
    let current: string;

    try
    {
        current = await readFile( join( directory, '.gitignore' ), 'utf8' );
    }
    catch
    {
        return;
    }

    const kept = current.split( /\r?\n/ ).filter( ( line ) => !lines.includes( line.trim() ) );
    const text = kept.join( '\n' ).replace( /\n+$/, '' );

    await writeFile( join( directory, '.gitignore' ), text === '' ? '' : `${text}\n`, 'utf8' );
}

export interface GitResult
{
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export async function runGit ( directory: string, arguments_: readonly string[], environment?: Readonly<Record<string, string>> ): Promise<GitResult>
{
    try
    {
        const { stdout, stderr } = await execFileAsync( 'git', [ ...arguments_ ], {
            cwd: directory,
            ...environment === undefined ? {} : { env: { ...process.env, ...environment } },
        } );

        return { code: 0, stdout, stderr };
    }
    catch ( error )
    {
        const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };

        if ( failure.code === 'ENOENT' )
        {
            throw new Error( 'git is not installed or not on the PATH. Casomer publishes are git commits, so git is required.' );
        }

        return {
            code: typeof failure.code === 'number' ? failure.code : 1,
            stdout: failure.stdout ?? '',
            stderr: failure.stderr ?? '',
        };
    }
}

export async function isInsideRepository ( directory: string ): Promise<boolean>
{
    const result = await runGit( directory, [ 'rev-parse', '--is-inside-work-tree' ] );

    return result.code === 0 && result.stdout.trim() === 'true';
}

// A .git exists: adopt it. No .git: create one locally, no ceremony.
// History and restore work from minute one, offline, forever.
export async function findOrCreateRepository ( directory: string ): Promise<{ created: boolean }>
{
    if ( await isInsideRepository( directory ) ) { return { created: false }; }

    const result = await runGit( directory, [ 'init', '-b', 'main' ] );

    if ( result.code !== 0 )
    {
        throw new Error( `git init failed: ${result.stderr.trim()}` );
    }

    return { created: true };
}

// The one active check from section 14: a pre-existing .gitignore that
// ignores dist/ conflicts with the commit-dist doctrine.
export async function isPathIgnored ( directory: string, path: string ): Promise<boolean>
{
    const result = await runGit( directory, [ 'check-ignore', '-q', path ] );

    return result.code === 0;
}

export async function stagePaths ( directory: string, paths: readonly string[] ): Promise<GitResult>
{
    return runGit( directory, [ 'add', '--', ...paths ] );
}

export async function hasStagedChanges ( directory: string ): Promise<boolean>
{
    const result = await runGit( directory, [ 'diff', '--cached', '--quiet' ] );

    return result.code !== 0;
}

export async function commit ( directory: string, message: string ): Promise<GitResult>
{
    return runGit( directory, [ 'commit', '-m', message ] );
}

export async function hasRemote ( directory: string ): Promise<boolean>
{
    const result = await runGit( directory, [ 'remote' ] );

    return result.code === 0 && result.stdout.trim() !== '';
}

export async function addOriginRemote ( directory: string, url: string ): Promise<GitResult>
{
    return runGit( directory, [ 'remote', 'add', 'origin', url ] );
}

export async function pushCurrentBranch ( directory: string ): Promise<GitResult>
{
    return runGit( directory, [ 'push', '-u', 'origin', 'HEAD' ] );
}
