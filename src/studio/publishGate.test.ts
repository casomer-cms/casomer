// The publish moments through Studio (BUSINESS 5.3, 5.5): a personal
// site's fifth publish returns the supporter moment once; declaring
// commercial makes the next publish open the window and record its
// witness; an ended window refuses to publish with 402 until the key
// route stores a key. The user config is a temp folder.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStudioServer, type StudioServer } from './server.ts';
import { runInit } from '../cli/commands.ts';
import { runGit } from '../git/repository.ts';
import { readUserConfig, updateUserConfig } from '../licensing/userConfig.ts';
import { issueTestKey } from '../licensing/testKeys.ts';
import { startTestRelay } from '../licensing/testRelay.ts';

type PublishBody = { published?: boolean; pages?: number; publishCount?: number; supporterMoment?: number | null; error?: string; notices?: string[]; licensing?: { phase: string; anchor: string | null; siteKey: string } };

describe( 'the publish moments', () =>
{
    let server: StudioServer;
    let base: string;
    let directory: string;
    let previousOverride: string | undefined;

    const publish = async (): Promise<{ status: number; body: PublishBody }> =>
    {
        const response = await fetch( `${base}/api/publish?t=${server.token}`, { method: 'POST' } );

        return { status: response.status, body: await response.json() as PublishBody };
    };
    const touchPage = async ( n: number ): Promise<void> =>
    {
        const file = join( directory, 'pages.json' );
        const pages = JSON.parse( await readFile( file, 'utf8' ) ) as { pages: { title: string }[] };

        const home = pages.pages[ 0 ];

        if ( home === undefined ) { throw new Error( 'no home page' ); }

        home.title = `Home ${n}`;
        await writeFile( file, `${JSON.stringify( pages, null, 4 )}\n`, 'utf8' );
    };
    const meta = async ( body: Record<string, unknown> ): Promise<number> => ( await fetch( `${base}/api/site-meta?t=${server.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( body ),
    } ) ).status;
    const snapshot = async (): Promise<{ licensing: { phase: string; daysLeft: number }; publishCount: number }> => await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { licensing: { phase: string; daysLeft: number }; publishCount: number };

    before( async () =>
    {
        previousOverride = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_CONFIG_DIR = await mkdtemp( join( tmpdir(), 'casomer-gate-config-' ) );
        directory = await mkdtemp( join( tmpdir(), 'casomer-studio-gate-' ) );

        assert.equal( await runInit( [ '--personal' ], directory ), 0 );
        await runGit( directory, [ 'config', 'user.name', 'Test' ] );
        await runGit( directory, [ 'config', 'user.email', 'test@example.com' ] );

        server = await startStudioServer( { contentDirectory: directory, assetsDirectory: join( directory, 'no-such-assets' ), packages: [] }, 0 );
        base = `http://127.0.0.1:${server.port}`;
    } );

    after( async () =>
    {
        await server.close();

        if ( previousOverride === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousOverride; }
    } );

    it( 'a personal site publishes freely and the fifth publish carries the supporter moment once', async () =>
    {
        const moments: ( number | null | undefined )[] = [];

        for ( let n = 1; n <= 6; n += 1 )
        {
            await touchPage( n );

            const { status, body } = await publish();

            assert.equal( status, 200, `publish ${n}` );
            assert.equal( body.publishCount, n );
            assert.equal( body.licensing?.phase, 'personal' );
            moments.push( body.supporterMoment );
        }

        assert.deepEqual( moments, [ null, null, null, null, 5, null ] );
        assert.deepEqual( ( await readUserConfig() ).supporterMoments, [ 5 ] );
        assert.equal( ( await snapshot() ).publishCount, 6 );
    } );

    it( 'declaring commercial opens the window at the next publish and writes the witness', async () =>
    {
        assert.equal( await meta( { use: 'commercial', origin: 'https://sunrise-bakery.com' } ), 200 );
        assert.equal( ( await snapshot() ).licensing.phase, 'unstarted' );

        await touchPage( 7 );

        const { status, body } = await publish();

        assert.equal( status, 200 );
        assert.equal( body.supporterMoment, null );
        assert.equal( body.licensing?.phase, 'grace' );
        assert.equal( body.licensing?.siteKey, 'sunrise-bakery.com' );
        assert.equal( typeof ( ( await readUserConfig() ).grace as Record<string, string> )[ 'sunrise-bakery.com' ], 'string' );
        assert.equal( ( await snapshot() ).licensing.daysLeft, 14 );
    } );

    it( 'an ended window refuses to publish until the key route stores a key', async () =>
    {
        await updateUserConfig( ( config ) =>
        {
            config.grace = { 'sunrise-bakery.com': '2026-01-01T00:00:00.000Z' };
        } );
        assert.equal( ( await snapshot() ).licensing.phase, 'expired' );

        await touchPage( 8 );

        const refused = await publish();

        assert.equal( refused.status, 402 );
        assert.equal( refused.body.licensing?.phase, 'expired' );

        const empty = await fetch( `${base}/api/license?t=${server.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { key: '  ' } ) } );

        assert.equal( empty.status, 400 );

        const elsewhere = await fetch( `${base}/api/license?t=${server.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { key: issueTestKey( 'license', 'other.example' ) } ) } );

        assert.equal( elsewhere.status, 400 );
        assert.match( ( await elsewhere.json() as { error: string } ).error, /different site address/ );

        const issued = issueTestKey( 'license', 'sunrise-bakery.com' );
        const keyed = await fetch( `${base}/api/license?t=${server.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { key: issued } ) } );

        assert.equal( keyed.status, 200 );
        assert.equal( ( await snapshot() ).licensing.phase, 'licensed' );

        // The stored key comes back out for the card's copy button.
        const readBack = await fetch( `${base}/api/license?t=${server.token}` );

        assert.equal( readBack.status, 200 );
        assert.equal( ( await readBack.json() as { key: string } ).key, issued );

        const allowed = await publish();

        assert.equal( allowed.status, 200 );
        assert.equal( allowed.body.licensing?.phase, 'licensed' );
        assert.deepEqual( allowed.body.notices, [] );
    } );

    it( 'a revoked license is cleared at the next publish, which the gate then refuses in the registry\'s words', async () =>
    {
        const relay = await startTestRelay( 'revoked' );
        const previous = process.env.CASOMER_RELAY_ORIGIN;

        process.env.CASOMER_RELAY_ORIGIN = relay.origin;

        try
        {
            await touchPage( 9 );

            const refused = await publish();

            assert.equal( refused.status, 402 );
            assert.match( refused.body.error ?? '', /license key has been revoked/ );
            assert.deepEqual( refused.body.notices, [ refused.body.error ] );
            assert.equal( refused.body.licensing?.phase, 'expired' );
            assert.deepEqual( ( await readUserConfig() ).licenses, {} );
            assert.equal( ( await snapshot() ).licensing.phase, 'expired' );

            // A fresh key is asked about as it is entered; a valid answer
            // stamps it, so the publish that follows does not ask again.
            relay.mood = 'valid';
            relay.seen.length = 0;

            const keyed = await fetch( `${base}/api/license?t=${server.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { key: issueTestKey( 'license', 'sunrise-bakery.com' ) } ) } );

            assert.equal( keyed.status, 200 );

            const allowed = await publish();

            assert.equal( allowed.status, 200 );
            assert.deepEqual( allowed.body.notices, [] );
            assert.deepEqual( relay.seen.map( ( call ) => call.path ), [ '/api/keys/verify', '/api/licenses/activate' ] );
        }
        finally
        {
            process.env.CASOMER_RELAY_ORIGIN = previous;
            await relay.close();
        }
    } );
} );
