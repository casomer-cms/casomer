// Connect GitHub from Studio (EDITOR: Go live, Pull & push): the
// device flow caso init runs, held by the server and asked about by
// the chrome, against a local mock of GitHub's endpoints; the chosen
// repository becomes the remote with caso as git's credential helper.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { runGit } from '../git/repository.ts';
import type { GitHubEndpoints } from '../git/githubApp.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'connect GitHub from Studio', () =>
{
    let github: Server;
    let studio: StudioServer;
    let base: string;
    let contentDirectory: string;
    let configDirectory: string;
    let previousConfigDirectory: string | undefined;
    let tokenResponses: Record<string, unknown>[] = [];

    const call = async ( method: string, path: string, body?: unknown ): Promise<{ status: number; body: Record<string, unknown> }> =>
    {
        const response = await fetch( `${base}${path}?t=${studio.token}`, { method, headers: { 'content-type': 'application/json' }, ...( body === undefined ? {} : { body: JSON.stringify( body ) } ) } );

        return { status: response.status, body: await response.json() as Record<string, unknown> };
    };

    before( async () =>
    {
        configDirectory = await mkdtemp( join( tmpdir(), 'casomer-github-config-' ) );
        previousConfigDirectory = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_CONFIG_DIR = configDirectory;
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-github-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );
        assert.equal( ( await runGit( contentDirectory, [ 'init', '-q' ] ) ).code, 0 );

        github = createServer( ( request, response ) =>
        {
            const reply = ( body: unknown ): void =>
            {
                response.writeHead( 200, { 'content-type': 'application/json' } );
                response.end( JSON.stringify( body ) );
            };

            if ( request.url === '/login/device/code' )
            {
                reply( { device_code: 'device-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 } );
                return;
            }

            if ( request.url === '/login/oauth/access_token' )
            {
                reply( tokenResponses.shift() ?? { error: 'authorization_pending' } );
                return;
            }

            if ( request.url === '/user/installations?per_page=100' )
            {
                reply( { installations: [ { id: 7 } ] } );
                return;
            }

            if ( request.url === '/user/installations/7/repositories?per_page=100' )
            {
                reply( { repositories: [ { full_name: 'mikey/site', private: true }, { full_name: 'mikey/notes', private: false } ] } );
                return;
            }

            reply( { error: 'not_found' } );
        } );
        await new Promise<void>( ( resolve ) => github.listen( 0, '127.0.0.1', resolve ) );

        const address = github.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const endpoints: GitHubEndpoints = {
            deviceUrl: `http://127.0.0.1:${port}/login/device/code`,
            tokenUrl: `http://127.0.0.1:${port}/login/oauth/access_token`,
            apiBase: `http://127.0.0.1:${port}`,
        };
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        studio = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            githubEndpoints: endpoints,
        }, 0 );
        base = `http://127.0.0.1:${studio.port}`;
    } );

    after( async () =>
    {
        await studio.close();
        await new Promise<void>( ( resolve ) => github.close( () => resolve() ) );

        if ( previousConfigDirectory === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousConfigDirectory; }

        await rm( configDirectory, { recursive: true, force: true } );
    } );

    it( 'starts disconnected, and the repository list says so', async () =>
    {
        const state = await call( 'GET', '/api/github' );

        assert.equal( state.body.connected, false );
        assert.equal( state.body.pending, null );
        assert.match( String( state.body.installUrl ), /apps\/casomer-cms\/installations\/new/ );
        assert.equal( ( await call( 'GET', '/api/github/repositories' ) ).status, 401 );
    } );

    it( 'shows the device code, waits for the authorization, then lists the repositories', async () =>
    {
        tokenResponses = [ { error: 'authorization_pending' }, { access_token: 'token-1', refresh_token: 'refresh-1', expires_in: 28800 } ];

        const started = await call( 'POST', '/api/github/connect' );

        assert.equal( started.body.connected, false );
        assert.equal( started.body.userCode, 'ABCD-1234' );
        assert.equal( started.body.verificationUri, 'https://github.com/login/device' );

        // Asking again while the code is live hands back the same code.
        assert.equal( ( await call( 'POST', '/api/github/connect' ) ).body.userCode, 'ABCD-1234' );

        let state = await call( 'GET', '/api/github' );

        for ( let attempt = 0; attempt < 50 && state.body.connected !== true; attempt += 1 )
        {
            await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
            state = await call( 'GET', '/api/github' );
        }

        assert.equal( state.body.connected, true );
        assert.equal( state.body.error, '' );

        const repositories = await call( 'GET', '/api/github/repositories' );

        assert.equal( repositories.status, 200 );
        assert.deepEqual( repositories.body.repositories, [ { fullName: 'mikey/site', isPrivate: true }, { fullName: 'mikey/notes', isPrivate: false } ] );
        assert.equal( ( await call( 'POST', '/api/github/connect' ) ).body.connected, true, 'connected already: no new code' );
    } );

    it( 'makes the chosen repository the remote, with caso as the credential helper', async () =>
    {
        assert.equal( ( await call( 'PUT', '/api/github/remote', { fullName: 'not a repo' } ) ).status, 400 );

        const set = await call( 'PUT', '/api/github/remote', { fullName: 'mikey/site' } );

        assert.equal( set.status, 200 );
        assert.equal( ( await runGit( contentDirectory, [ 'remote', 'get-url', 'origin' ] ) ).stdout.trim(), 'https://github.com/mikey/site.git' );
        assert.equal( ( await runGit( contentDirectory, [ 'config', '--local', 'credential.https://github.com.helper' ] ) ).stdout.trim(), '!caso credential' );

        // A second choice replaces the first.
        assert.equal( ( await call( 'PUT', '/api/github/remote', { fullName: 'mikey/notes' } ) ).status, 200 );
        assert.equal( ( await runGit( contentDirectory, [ 'remote', 'get-url', 'origin' ] ) ).stdout.trim(), 'https://github.com/mikey/notes.git' );
        assert.equal( ( ( await call( 'GET', '/api/site' ) ).body as { remoteUrl: string } ).remoteUrl, 'https://github.com/mikey/notes.git' );
        assert.equal( ( ( await call( 'GET', '/api/site' ) ).body as { deploy: { git: { github: string } } } ).deploy.git.github, 'ok' );
    } );

    it( 'seven months later: the tokens are dead, the row says reconnect, and a publish says so instead of failing on the push', async () =>
    {
        // Both tokens expired, and GitHub refuses the refresh.
        await writeFile( join( configDirectory, 'github-tokens.json' ), JSON.stringify( { accessToken: 'old', refreshToken: 'older', expiresAt: Date.now() - 1000 } ) );
        tokenResponses = [ { error: 'bad_refresh_token' } ];

        assert.equal( ( ( await call( 'GET', '/api/site' ) ).body as { deploy: { git: { github: string } } } ).deploy.git.github, 'expired' );

        // A publish: the commit happens, the push is not attempted.
        await runGit( contentDirectory, [ 'config', 'user.name', 'Test' ] );
        await runGit( contentDirectory, [ 'config', 'user.email', 'test@example.com' ] );

        const published = await call( 'POST', '/api/publish' );

        assert.equal( published.status, 200, JSON.stringify( published.body ) );
        assert.equal( published.body.backup, 'expired' );
        assert.equal( ( await runGit( contentDirectory, [ 'log', '--oneline' ] ) ).stdout.includes( 'casomer: publish' ), true );

        // Connecting again is the same three steps; step one is not done.
        assert.equal( ( await call( 'GET', '/api/github' ) ).body.connected, false );

        // Reconnected: a publish with nothing new still pushes what stayed
        // local (Mikey: "if I publish again without any changes").
        tokenResponses = [ { access_token: 'token-2', refresh_token: 'refresh-2', expires_in: 28800 } ];
        await call( 'POST', '/api/github/connect' );

        let state = await call( 'GET', '/api/github' );

        for ( let attempt = 0; attempt < 50 && state.body.connected !== true; attempt += 1 )
        {
            await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
            state = await call( 'GET', '/api/github' );
        }

        assert.equal( state.body.connected, true );

        const again = await call( 'POST', '/api/publish' );

        assert.equal( again.body.changed, false, 'nothing new' );
        assert.notEqual( again.body.backup, 'expired', 'the push is attempted (the mock remote does not exist, so it fails at git, not at the token)' );
        assert.notEqual( again.body.backup, 'off' );
    } );
} );
