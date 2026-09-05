// The backup after a publish is never quiet (Mikey, 2026-09-03): the
// publish response says whether the push went, a publish with
// nothing new still sends the backup, the status reads "unpushed"
// while a remote lacks a commit, and a dead remote is reported with
// git's first line of why.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStudioServer, type StudioServer } from './server.ts';
import { runInit } from '../cli/commands.ts';
import { runGit } from '../git/repository.ts';
import { serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';

type PublishBody = { published?: boolean; changed?: boolean; backup?: string; backupError?: string };

describe( 'the backup after a publish', () =>
{
    let server: StudioServer;
    let base: string;
    let directory: string;
    let remote: string;

    const publish = async (): Promise<{ status: number; body: PublishBody }> =>
    {
        const response = await fetch( `${base}/api/publish?t=${server.token}`, { method: 'POST' } );

        return { status: response.status, body: await response.json() as PublishBody };
    };
    const status = async (): Promise<string> => ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { status: string } ).status;
    const touchPage = async ( n: number ): Promise<void> =>
    {
        const file = join( directory, 'pages.json' );
        const pages = JSON.parse( await readFile( file, 'utf8' ) ) as { pages: { title: string }[] };
        const home = pages.pages[ 0 ];

        if ( home === undefined ) { throw new Error( 'no home page' ); }

        home.title = `Home ${n}`;
        await writeFile( file, `${JSON.stringify( pages, null, 4 )}\n`, 'utf8' );
    };

    before( async () =>
    {
        directory = await mkdtemp( join( tmpdir(), 'casomer-studio-backup-' ) );
        remote = await mkdtemp( join( tmpdir(), 'casomer-remote-' ) );

        assert.equal( await runInit( [ '--personal' ], directory ), 0 );
        await runGit( directory, [ 'config', 'user.name', 'Test' ] );
        await runGit( directory, [ 'config', 'user.email', 'test@example.com' ] );
        assert.equal( ( await runGit( remote, [ 'init', '--bare' ] ) ).code, 0 );
        assert.equal( ( await runGit( directory, [ 'remote', 'add', 'origin', remote ] ) ).code, 0 );

        server = await startStudioServer( { contentDirectory: directory, assetsDirectory: join( directory, 'no-such-assets' ), packages: [] }, 0 );
        base = `http://127.0.0.1:${server.port}`;
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'a publish with a reachable remote backs up, and the status settles on published', async () =>
    {
        await touchPage( 1 );

        const { status: code, body } = await publish();

        assert.equal( code, 200 );
        assert.equal( body.changed, true );
        assert.equal( body.backup, 'pushed' );
        assert.equal( body.backupError, '' );
        assert.equal( await status(), 'published' );
    } );

    it( 'pulls the remote\'s latest before pushing, and a conflicting remote is said with nothing lost', async () =>
    {
        // Another machine published a note to the same remote.
        const other = await mkdtemp( join( tmpdir(), 'casomer-publish-other-' ) );

        const branch = ( await runGit( directory, [ 'rev-parse', '--abbrev-ref', 'HEAD' ] ) ).stdout.trim();

        assert.equal( ( await runGit( other, [ 'clone', '-q', '-b', branch, remote, '.' ] ) ).code, 0 );
        await runGit( other, [ 'config', 'user.name', 'Other' ] );
        await runGit( other, [ 'config', 'user.email', 'other@example.com' ] );
        await writeFile( join( other, 'NOTES.md' ), 'from the other machine\n' );
        assert.equal( ( await runGit( other, [ 'add', 'NOTES.md' ] ) ).code, 0 );
        assert.equal( ( await runGit( other, [ 'commit', '-q', '-m', 'notes' ] ) ).code, 0 );
        assert.equal( ( await runGit( other, [ 'push', '-q', 'origin', 'HEAD' ] ) ).code, 0 );

        await touchPage( 7 );

        const pulled = await publish();

        assert.equal( pulled.body.backup, 'pushed' );
        assert.equal( ( await runGit( directory, [ 'log', '--oneline', '--grep', '^notes$' ] ) ).stdout.trim() !== '', true, 'the other machine\'s commit is here now' );
        assert.equal( await status(), 'published' );

        // The other machine changes the same page: the replay conflicts,
        // is abandoned whole, and the publish says so.
        assert.equal( ( await runGit( other, [ 'pull', '-q', '--rebase', 'origin', branch ] ) ).code, 0 );

        const file = join( other, 'pages.json' );
        const pages = JSON.parse( await readFile( file, 'utf8' ) ) as { pages: { title: string }[] };

        if ( pages.pages[ 0 ] === undefined ) { throw new Error( 'no home page' ); }

        pages.pages[ 0 ].title = 'Home from the other machine';
        await writeFile( file, JSON.stringify( pages, null, 4 ) );
        assert.equal( ( await runGit( other, [ 'commit', '-q', '-am', 'other title' ] ) ).code, 0 );
        assert.equal( ( await runGit( other, [ 'push', '-q', 'origin', 'HEAD' ] ) ).code, 0 );

        await touchPage( 8 );

        const before = ( await runGit( directory, [ 'rev-parse', 'HEAD' ] ) ).stdout.trim();
        const conflicted = await publish();

        assert.equal( conflicted.body.backup, 'conflict' );
        assert.equal( ( await runGit( directory, [ 'status', '--porcelain' ] ) ).stdout.trim(), '', 'no rebase left half-done' );
        assert.notEqual( ( await runGit( directory, [ 'rev-parse', 'HEAD' ] ) ).stdout.trim(), before, 'the publish commit itself stands' );

        // Resolved by hand (the other machine wins), the next publish
        // goes through.
        assert.equal( ( await runGit( directory, [ 'fetch', '-q', 'origin' ] ) ).code, 0 );
        assert.equal( ( await runGit( directory, [ 'reset', '-q', '--hard', 'origin/HEAD' ] ) ).code === 0 || ( await runGit( directory, [ 'reset', '-q', '--hard', 'FETCH_HEAD' ] ) ).code === 0, true );
        await touchPage( 9 );
        assert.equal( ( await publish() ).body.backup, 'pushed' );
    } );

    it( 'pull & push off keeps the publish on this machine and the status quiet', async () =>
    {
        const site = join( directory, 'site.json' );
        const raw = JSON.parse( await readFile( site, 'utf8' ) ) as Record<string, unknown>;

        raw.deploy = { git: { enabled: false } };
        await writeFile( site, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
        await touchPage( 10 );

        const off = await publish();

        assert.equal( off.body.backup, 'off', JSON.stringify( off.body ) );
        assert.equal( await status(), 'published' );

        delete raw.deploy;
        await writeFile( site, serializeCanonicalJson( raw as JsonValue ), 'utf8' );
        await touchPage( 11 );
        assert.equal( ( await publish() ).body.backup, 'pushed' );
    } );

    it( 'a dead remote is reported, the status reads unpushed, and a publish with nothing new retries the backup', async () =>
    {
        assert.equal( ( await runGit( directory, [ 'remote', 'set-url', 'origin', join( remote, 'no-such-repo' ) ] ) ).code, 0 );
        await touchPage( 2 );

        const failed = await publish();

        assert.equal( failed.status, 200 );
        assert.equal( failed.body.changed, true );
        assert.equal( failed.body.backup, 'failed' );
        assert.notEqual( failed.body.backupError, '' );
        assert.equal( await status(), 'unpushed' );

        assert.equal( ( await runGit( directory, [ 'remote', 'set-url', 'origin', remote ] ) ).code, 0 );

        const retried = await publish();

        assert.equal( retried.status, 200 );
        assert.equal( retried.body.changed, false );
        assert.equal( retried.body.backup, 'pushed' );
        assert.equal( await status(), 'published' );
    } );
} );
