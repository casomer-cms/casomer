// The edit journal (EDITOR section 9): undo that survives closing the
// browser. Every content write snapshots the OWNED content documents -
// the reserved names plus every self-describing casomerSchema file
// (SCHEMA section 13.1) - to a hidden ref, refs/casomer/journal,
// through a scratch index, so the user's real index, branches,
// history, and publishes never see it. Undo walks the chain back and
// restores the working tree - including deleting an owned file that
// did not exist in the restored state, so creating a collection is as
// undoable as editing one. Foreign files are never touched.
// Deliberately JSON-only (Mikey, 2026-09-01: "we don't want to track
// media - just media meta-data"): media binaries never enter the
// journal - labels and references are the journaled truth, and the
// chrome speaks honestly about what a media delete can and cannot
// bring back.

import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { runGit } from './repository.ts';

const journalRef = 'refs/casomer/journal';
const cursorRef = 'refs/casomer/journal-cursor';

export async function ownedContentFiles ( directory: string ): Promise<string[]>
{
    let names: string[];

    try
    {
        names = ( await readdir( directory, { withFileTypes: true } ) )
            .filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.json' ) )
            .map( ( entry ) => entry.name )
            .sort();
    }
    catch
    {
        return [];
    }

    const owned: string[] = [];

    for ( const name of names )
    {
        if ( name === 'site.json' || name === 'pages.json' )
        {
            owned.push( name );
            continue;
        }

        try
        {
            const value = JSON.parse( await readFile( join( directory, name ), 'utf8' ) ) as Record<string, unknown> | null;

            if ( value !== null && typeof value === 'object' && !Array.isArray( value ) && value.casomerSchema === 1 )
            {
                owned.push( name );
            }
        }
        catch { /* unparsable is not ours */ }
    }

    return owned;
}

async function refSha ( directory: string, ref: string ): Promise<string | undefined>
{
    const result = await runGit( directory, [ 'rev-parse', '-q', '--verify', ref ] );

    return result.code === 0 ? result.stdout.trim() : undefined;
}

async function scratchEnvironment ( directory: string ): Promise<Readonly<Record<string, string>> | undefined>
{
    const gitDirectory = await runGit( directory, [ 'rev-parse', '--absolute-git-dir' ] );

    if ( gitDirectory.code !== 0 ) { return undefined; }

    return { GIT_INDEX_FILE: join( gitDirectory.stdout.trim(), 'casomer-journal-index' ) };
}

export async function journalSnapshot ( directory: string ): Promise<{ recorded: boolean }>
{
    const environment = await scratchEnvironment( directory );

    if ( environment === undefined ) { return { recorded: false }; }

    const owned = await ownedContentFiles( directory );

    if ( owned.length === 0 ) { return { recorded: false }; }

    await runGit( directory, [ 'read-tree', '--empty' ], environment );
    await runGit( directory, [ 'add', '--', ...owned ], environment );

    const tree = ( await runGit( directory, [ 'write-tree' ], environment ) ).stdout.trim();
    const cursor = await refSha( directory, cursorRef ) ?? await refSha( directory, journalRef );

    if ( cursor !== undefined )
    {
        const cursorTree = ( await runGit( directory, [ 'rev-parse', `${cursor}^{tree}` ] ) ).stdout.trim();

        if ( cursorTree === tree ) { return { recorded: false }; }
    }

    const committed = await runGit(
        directory,
        [ 'commit-tree', tree, ...cursor === undefined ? [] : [ '-p', cursor ], '-m', 'casomer journal' ],
    );

    if ( committed.code !== 0 ) { return { recorded: false }; }

    const snapshot = committed.stdout.trim();

    await runGit( directory, [ 'update-ref', journalRef, snapshot ] );
    await runGit( directory, [ 'update-ref', cursorRef, snapshot ] );
    return { recorded: true };
}

async function restoreTo ( directory: string, snapshot: string ): Promise<boolean>
{
    const listed = await runGit( directory, [ 'ls-tree', '--name-only', '-r', snapshot ] );

    if ( listed.code !== 0 ) { return false; }

    const snapshotFiles = listed.stdout.trim().split( '\n' ).filter( ( name ) => name !== '' );

    if ( snapshotFiles.length > 0 )
    {
        const restored = await runGit( directory, [ 'restore', '--worktree', '--source', snapshot, '--', ...snapshotFiles ] );

        if ( restored.code !== 0 ) { return false; }
    }

    // An owned file the snapshot does not know was created after it:
    // stepping back means it goes. Foreign files are never candidates.
    for ( const name of await ownedContentFiles( directory ) )
    {
        if ( !snapshotFiles.includes( name ) )
        {
            try
            {
                await unlink( join( directory, name ) );
            }
            catch { /* already gone */ }
        }
    }

    return true;
}

export async function journalUndo ( directory: string ): Promise<{ stepped: boolean }>
{
    const cursor = await refSha( directory, cursorRef ) ?? await refSha( directory, journalRef );

    if ( cursor === undefined ) { return { stepped: false }; }

    const parent = await refSha( directory, `${cursor}^` );

    if ( parent === undefined ) { return { stepped: false }; }
    if ( !await restoreTo( directory, parent ) ) { return { stepped: false }; }

    await runGit( directory, [ 'update-ref', cursorRef, parent ] );
    return { stepped: true };
}

export async function journalRedo ( directory: string ): Promise<{ stepped: boolean }>
{
    const tip = await refSha( directory, journalRef );
    const cursor = await refSha( directory, cursorRef );

    if ( tip === undefined || cursor === undefined || cursor === tip ) { return { stepped: false }; }

    const forward = await runGit( directory, [ 'rev-list', '--reverse', '--ancestry-path', `${cursor}..${tip}` ] );
    const next = forward.stdout.trim().split( '\n' )[ 0 ];

    if ( next === undefined || next === '' ) { return { stepped: false }; }
    if ( !await restoreTo( directory, next ) ) { return { stepped: false }; }

    await runGit( directory, [ 'update-ref', cursorRef, next ] );
    return { stepped: true };
}
