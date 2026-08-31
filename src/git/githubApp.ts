// GitHub connect, via the Casomer CMS GitHub App (DEVELOPMENT section 5:
// per-repository install, Contents read/write plus Metadata read, and
// nothing else). The CLI authenticates with the device flow, which needs
// only the public client id: a source-available CLI could not keep a
// secret, so the design never asks it to. Tokens are short-lived; the
// caso credential helper mints fresh ones for git on demand, so git
// never holds a long-lived secret either.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const githubClientId = 'lv23IiQXR6Im4sElf4b5';
export const githubAppSlug = 'casomer-cms';

export interface GitHubEndpoints
{
    readonly deviceUrl: string;
    readonly tokenUrl: string;
    readonly apiBase: string;
}

export const defaultEndpoints: GitHubEndpoints = {
    deviceUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    apiBase: 'https://api.github.com',
};

export interface DeviceAuthorization
{
    readonly deviceCode: string;
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete?: string;
    readonly intervalSeconds: number;
    readonly expiresInSeconds: number;
}

export interface TokenSet
{
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly expiresAt?: number;
}

function configDirectory (): string
{
    return process.env.CASOMER_CONFIG_DIR ?? join( homedir(), '.config', 'casomer' );
}

function tokensFile (): string
{
    return join( configDirectory(), 'github-tokens.json' );
}

export async function saveTokens ( tokens: TokenSet ): Promise<void>
{
    await mkdir( configDirectory(), { recursive: true } );
    await writeFile( tokensFile(), JSON.stringify( tokens ), { encoding: 'utf8', mode: 0o600 } );
}

export async function loadTokens (): Promise<TokenSet | undefined>
{
    try
    {
        return JSON.parse( await readFile( tokensFile(), 'utf8' ) ) as TokenSet;
    }
    catch
    {
        return undefined;
    }
}

async function postForm ( url: string, form: Record<string, string> ): Promise<Record<string, unknown>>
{
    const response = await fetch( url, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams( form ).toString(),
    } );

    return await response.json() as Record<string, unknown>;
}

export async function requestDeviceCode ( endpoints = defaultEndpoints ): Promise<DeviceAuthorization>
{
    const body = await postForm( endpoints.deviceUrl, { client_id: githubClientId } );

    if ( typeof body.device_code !== 'string' )
    {
        throw new Error(
            'GitHub did not start the device flow. If this app was just created, make sure Device Flow is enabled in its settings.',
        );
    }

    return {
        deviceCode: body.device_code,
        userCode: String( body.user_code ),
        verificationUri: String( body.verification_uri ),
        // GitHub does not send this today, but the device-flow spec
        // defines it as a prefilled link; use it the day it appears.
        ...( typeof body.verification_uri_complete === 'string'
            ? { verificationUriComplete: body.verification_uri_complete }
            : {} ),
        intervalSeconds: typeof body.interval === 'number' ? body.interval : 5,
        expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 900,
    };
}

function tokenSetFrom ( body: Record<string, unknown> ): TokenSet
{
    return {
        accessToken: String( body.access_token ),
        ...( typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {} ),
        ...( typeof body.expires_in === 'number' ? { expiresAt: Date.now() + body.expires_in * 1000 } : {} ),
    };
}

const defaultSleep = ( seconds: number ): Promise<void> =>
    new Promise( ( resolve ) => setTimeout( resolve, seconds * 1000 ) );

export async function pollForAccessToken (
    authorization: DeviceAuthorization,
    endpoints = defaultEndpoints,
    sleep = defaultSleep,
): Promise<TokenSet>
{
    const deadline = Date.now() + authorization.expiresInSeconds * 1000;
    let interval = authorization.intervalSeconds;

    while ( Date.now() < deadline )
    {
        await sleep( interval );

        const body = await postForm( endpoints.tokenUrl, {
            client_id: githubClientId,
            device_code: authorization.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        } );

        if ( typeof body.access_token === 'string' )
        {
            const tokens = tokenSetFrom( body );

            await saveTokens( tokens );
            return tokens;
        }

        if ( body.error === 'authorization_pending' ) { continue; }

        if ( body.error === 'slow_down' )
        {
            interval += 5;
            continue;
        }

        throw new Error( body.error === 'access_denied'
            ? 'the authorization was declined on GitHub'
            : `GitHub reported: ${String( body.error ?? 'an unknown problem' )}` );
    }

    throw new Error( 'the device code expired before it was authorized; run caso init again to get a new one' );
}

// A valid token, refreshing a stale one through the refresh grant when
// possible. Undefined means the user needs to authorize again.
export async function getValidAccessToken ( endpoints = defaultEndpoints ): Promise<TokenSet | undefined>
{
    const stored = await loadTokens();

    if ( stored === undefined ) { return undefined; }

    const fresh = stored.expiresAt === undefined || stored.expiresAt > Date.now() + 30_000;

    if ( fresh ) { return stored; }

    if ( stored.refreshToken === undefined ) { return undefined; }

    const body = await postForm( endpoints.tokenUrl, {
        client_id: githubClientId,
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
    } );

    if ( typeof body.access_token !== 'string' ) { return undefined; }

    const tokens = tokenSetFrom( body );

    await saveTokens( tokens );
    return tokens;
}

export interface AccessibleRepository
{
    readonly fullName: string;
    readonly isPrivate: boolean;
}

async function apiGet ( endpoints: GitHubEndpoints, token: string, path: string ): Promise<Record<string, unknown>>
{
    const response = await fetch( `${endpoints.apiBase}${path}`, {
        headers: {
            'accept': 'application/vnd.github+json',
            'authorization': `Bearer ${token}`,
            'user-agent': 'casomer',
            'x-github-api-version': '2022-11-28',
        },
    } );

    return await response.json() as Record<string, unknown>;
}

// The repositories the user granted at install time: the whole point of
// the GitHub App model is that this list is exactly what they chose.
export async function listAccessibleRepositories (
    token: string,
    endpoints = defaultEndpoints,
): Promise<AccessibleRepository[]>
{
    const installations = await apiGet( endpoints, token, '/user/installations?per_page=100' );
    const repositories: AccessibleRepository[] = [];

    for ( const installation of ( installations.installations ?? [] ) as { id: number }[] )
    {
        const body = await apiGet( endpoints, token, `/user/installations/${installation.id}/repositories?per_page=100` );

        for ( const repository of ( body.repositories ?? [] ) as { full_name: string; private: boolean }[] )
        {
            repositories.push( { fullName: repository.full_name, isPrivate: repository.private } );
        }
    }

    return repositories;
}
