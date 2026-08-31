// The GitHub App device flow against a local mock of GitHub's endpoints:
// no secret anywhere, tokens stored in the user-level config directory,
// stale tokens refreshed through the refresh grant.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    getValidAccessToken,
    listAccessibleRepositories,
    loadTokens,
    pollForAccessToken,
    requestDeviceCode,
    saveTokens,
    type GitHubEndpoints,
} from './githubApp.ts';

let server: Server;
let endpoints: GitHubEndpoints;
let tokenResponses: Record<string, unknown>[] = [];

before( async () =>
{
    process.env.CASOMER_CONFIG_DIR = await mkdtemp( join( tmpdir(), 'casomer-config-' ) );

    server = createServer( ( request, response ) =>
    {
        const reply = ( body: unknown ): void =>
        {
            response.writeHead( 200, { 'content-type': 'application/json' } );
            response.end( JSON.stringify( body ) );
        };

        if ( request.url === '/login/device/code' )
        {
            reply( {
                device_code: 'device-123',
                user_code: 'ABCD-1234',
                verification_uri: 'https://github.com/login/device',
                interval: 0,
                expires_in: 900,
            } );
            return;
        }

        if ( request.url === '/login/oauth/access_token' )
        {
            reply( tokenResponses.shift() ?? { error: 'unexpected_call' } );
            return;
        }

        if ( request.url === '/user/installations?per_page=100' )
        {
            reply( { installations: [ { id: 7 } ] } );
            return;
        }

        if ( request.url === '/user/installations/7/repositories?per_page=100' )
        {
            reply( { repositories: [ { full_name: 'mikey/site', private: true } ] } );
            return;
        }

        reply( { error: 'not_found' } );
    } );

    await new Promise<void>( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    endpoints = {
        deviceUrl: `${base}/login/device/code`,
        tokenUrl: `${base}/login/oauth/access_token`,
        apiBase: base,
    };
} );

after( () => new Promise<void>( ( resolve ) => server.close( () => resolve() ) ) );

beforeEach( async () =>
{
    tokenResponses = [];
    await rm( join( process.env.CASOMER_CONFIG_DIR as string, 'github-tokens.json' ), { force: true } );
} );

const instantSleep = (): Promise<void> => Promise.resolve();

describe( 'the device flow', () =>
{
    it( 'requests a device code and polls until authorized', async () =>
    {
        tokenResponses = [
            { error: 'authorization_pending' },
            { access_token: 'token-1', refresh_token: 'refresh-1', expires_in: 28800 },
        ];

        const authorization = await requestDeviceCode( endpoints );

        assert.equal( authorization.userCode, 'ABCD-1234' );

        const tokens = await pollForAccessToken( authorization, endpoints, instantSleep );

        assert.equal( tokens.accessToken, 'token-1' );
        assert.equal( ( await loadTokens() )?.accessToken, 'token-1', 'the token set is persisted' );
    } );

    it( 'surfaces a declined authorization as a sentence', async () =>
    {
        tokenResponses = [ { error: 'access_denied' } ];

        const authorization = await requestDeviceCode( endpoints );

        await assert.rejects(
            () => pollForAccessToken( authorization, endpoints, instantSleep ),
            /declined on GitHub/,
        );
    } );
} );

describe( 'token freshness', () =>
{
    it( 'returns a fresh token untouched', async () =>
    {
        await saveTokens( { accessToken: 'fresh', expiresAt: Date.now() + 3_600_000 } );
        assert.equal( ( await getValidAccessToken( endpoints ) )?.accessToken, 'fresh' );
    } );

    it( 'refreshes a stale token through the refresh grant', async () =>
    {
        tokenResponses = [ { access_token: 'renewed', refresh_token: 'refresh-2', expires_in: 28800 } ];
        await saveTokens( { accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 } );

        assert.equal( ( await getValidAccessToken( endpoints ) )?.accessToken, 'renewed' );
        assert.equal( ( await loadTokens() )?.accessToken, 'renewed', 'the renewed set replaces the stale one' );
    } );

    it( 'reports needing reauthorization when nothing can be refreshed', async () =>
    {
        assert.equal( await getValidAccessToken( endpoints ), undefined );

        await saveTokens( { accessToken: 'stale', expiresAt: Date.now() - 1000 } );
        assert.equal( await getValidAccessToken( endpoints ), undefined );
    } );
} );

describe( 'the installation repository list', () =>
{
    it( 'lists exactly what the user granted at install time', async () =>
    {
        assert.deepEqual(
            await listAccessibleRepositories( 'token-1', endpoints ),
            [ { fullName: 'mikey/site', isPrivate: true } ],
        );
    } );
} );
