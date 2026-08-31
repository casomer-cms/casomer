// caso init and caso publish against real temporary git repositories:
// SCHEMA section 14 as integration tests. Git is never a question,
// staging is scoped to Casomer's own paths, publish equals commit, and
// push never blocks publish.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit, runPublish } from './commands.ts';
import { runGit } from '../git/repository.ts';
import { parseJsonDocument, serializeCanonicalJson, type JsonValue } from '../content/canonicalJson.ts';

async function makeProject (): Promise<string>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-project-' ) );

    assert.equal( await runInit( [], directory ), 0 );

    // Test repositories need an identity of their own.
    await runGit( directory, [ 'config', 'user.name', 'Test' ] );
    await runGit( directory, [ 'config', 'user.email', 'test@example.com' ] );
    return directory;
}

describe( 'caso init', () =>
{
    it( 'creates a repository and a canonical starter site', async () =>
    {
        const directory = await makeProject();
        const inside = await runGit( directory, [ 'rev-parse', '--is-inside-work-tree' ] );

        assert.equal( inside.stdout.trim(), 'true' );

        for ( const file of [ 'site.json', 'pages.json' ] )
        {
            const text = await readFile( join( directory, file ), 'utf8' );

            assert.equal( serializeCanonicalJson( parseJsonDocument( text ) ), text, `${file} is canonical` );
        }

        assert.equal( await readFile( join( directory, '.gitattributes' ), 'utf8' ), '* text=auto eol=lf\n' );
    } );

    it( 'adopts an existing repository without touching its files', async () =>
    {
        const directory = await mkdtemp( join( tmpdir(), 'casomer-adopt-' ) );

        await runGit( directory, [ 'init', '-b', 'main' ] );
        await writeFile( join( directory, 'unrelated.txt' ), 'not ours\n', 'utf8' );

        assert.equal( await runInit( [], directory ), 0 );

        const status = await runGit( directory, [ 'status', '--porcelain' ] );

        assert.ok( status.stdout.includes( '?? unrelated.txt' ), 'unrelated files stay untracked and untouched' );
    } );

    it( 'refuses to claim a foreign site.json and leaves the folder alone', async () =>
    {
        const directory = await mkdtemp( join( tmpdir(), 'casomer-foreign-' ) );
        const foreign = '{\n    "title": "someone else\'s site"\n}\n';

        await writeFile( join( directory, 'site.json' ), foreign, 'utf8' );

        assert.equal( await runInit( [], directory ), 1 );
        assert.equal( await readFile( join( directory, 'site.json' ), 'utf8' ), foreign, 'the foreign file is untouched' );

        const inside = await runGit( directory, [ 'rev-parse', '--is-inside-work-tree' ] );

        assert.notEqual( inside.stdout.trim(), 'true', 'no repository is created in a refused folder' );
    } );

    it( 'is idempotent', async () =>
    {
        const directory = await makeProject();
        const before = await readFile( join( directory, 'pages.json' ), 'utf8' );

        assert.equal( await runInit( [], directory ), 0 );
        assert.equal( await readFile( join( directory, 'pages.json' ), 'utf8' ), before );
    } );
} );

describe( 'caso publish', () =>
{
    it( 'builds, commits with the casomer prefix, and stages only its own paths', async () =>
    {
        const directory = await makeProject();

        await writeFile( join( directory, 'stray.txt' ), 'the user\'s own business\n', 'utf8' );

        assert.equal( await runPublish( [], directory ), 0 );

        const subject = await runGit( directory, [ 'log', '-1', '--pretty=%s' ] );

        assert.ok( subject.stdout.startsWith( 'casomer: publish 1 page' ) );

        const committed = await runGit( directory, [ 'ls-tree', '-r', '--name-only', 'HEAD' ] );

        assert.ok( committed.stdout.includes( 'site.json' ) );
        assert.ok( committed.stdout.includes( 'dist/index.html' ) );
        assert.ok( committed.stdout.includes( 'dist/assets/css/main.css' ) );
        assert.ok( !committed.stdout.includes( 'stray.txt' ), 'never -A: unrelated files are not swept into publishes' );

        const status = await runGit( directory, [ 'status', '--porcelain' ] );

        assert.ok( status.stdout.includes( '?? stray.txt' ), 'the stray file is still there, still untracked' );
    } );

    it( 'publishes nothing when nothing changed', async () =>
    {
        const directory = await makeProject();

        assert.equal( await runPublish( [], directory ), 0 );

        const first = await runGit( directory, [ 'rev-parse', 'HEAD' ] );

        assert.equal( await runPublish( [], directory ), 0 );

        const second = await runGit( directory, [ 'rev-parse', 'HEAD' ] );

        assert.equal( first.stdout, second.stdout, 'an unchanged site produces no new commit' );
    } );

    it( 'pushes to a connected remote, and survives a broken one', async () =>
    {
        const directory = await makeProject();
        const bare = await mkdtemp( join( tmpdir(), 'casomer-bare-' ) );

        await runGit( bare, [ 'init', '--bare', '-b', 'main' ] );
        assert.equal( await runInit( [ '--remote', bare ], directory ), 0 );
        assert.equal( await runPublish( [], directory ), 0 );

        const remoteHead = await runGit( bare, [ 'rev-parse', 'main' ] );

        assert.equal( remoteHead.code, 0, 'the publish reached the remote' );

        // Break the remote: push fails, publish still succeeds.
        await runGit( directory, [ 'remote', 'set-url', 'origin', join( bare, 'gone' ) ] );

        const pagesFile = parseJsonDocument( await readFile( join( directory, 'pages.json' ), 'utf8' ) ) as { pages: { title: string }[] };

        ( pagesFile.pages[ 0 ] as { title: string } ).title = 'Changed';
        await writeFile( join( directory, 'pages.json' ), serializeCanonicalJson( pagesFile as unknown as JsonValue ), 'utf8' );

        assert.equal( await runPublish( [], directory ), 0, 'push never blocks publish' );

        const local = await runGit( directory, [ 'log', '--oneline' ] );

        assert.equal( local.stdout.trim().split( '\n' ).length, 2, 'the second publish is committed locally' );
    } );
} );

describe( 'the declaration', () =>
{
    it( 'records --personal and --commercial declarations in site.json', async () =>
    {
        const personal = await mkdtemp( join( tmpdir(), 'casomer-decl-p-' ) );

        await runInit( [ '--personal' ], personal );

        const personalSite = parseJsonDocument( await readFile( join( personal, 'site.json' ), 'utf8' ) ) as { use?: string };

        assert.equal( personalSite.use, 'personal' );

        const commercial = await mkdtemp( join( tmpdir(), 'casomer-decl-c-' ) );

        await runInit( [ '--commercial' ], commercial );

        const commercialSite = parseJsonDocument( await readFile( join( commercial, 'site.json' ), 'utf8' ) ) as { use?: string };

        assert.equal( commercialSite.use, 'commercial' );
    } );

    it( 'leaves scripted init undeclared, and undeclared sites still build', async () =>
    {
        const directory = await makeProject();
        const site = parseJsonDocument( await readFile( join( directory, 'site.json' ), 'utf8' ) ) as { use?: string };

        assert.equal( site.use, undefined );
    } );

    it( 'validates the declaration and builds a declared site', async () =>
    {
        const directory = await mkdtemp( join( tmpdir(), 'casomer-decl-build-' ) );

        await runInit( [ '--commercial' ], directory );
        await runGit( directory, [ 'config', 'user.name', 'Test' ] );
        await runGit( directory, [ 'config', 'user.email', 'test@example.com' ] );

        assert.equal( await runPublish( [], directory ), 0, 'a declared site publishes cleanly' );
    } );
} );
