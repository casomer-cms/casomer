// The supporter key (EDITOR: the account badge): Verify stores it in
// the user config as supporterConfirm, any stored key counts as a
// confirmed supporter until verification exists, and DELETE clears
// it. The config directory is pointed at a temp folder so a person's
// own config is never touched.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { issueTestKey } from '../licensing/testKeys.ts';
import { startTestRelay } from '../licensing/testRelay.ts';
import { makePng } from './testImages.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'the supporter key route', () =>
{
    let server: StudioServer;
    let base: string;
    let configDirectory: string;
    let previousOverride: string | undefined;

    const config = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( configDirectory, 'config.json' ), 'utf8' ) ) as Record<string, unknown>;
    const supporter = async (): Promise<boolean> => ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { user: { supporter: boolean } } ).user.supporter;
    const put = async ( key: unknown ): Promise<Response> => fetch( `${base}/api/supporter?t=${server.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( { key } ),
    } );

    before( async () =>
    {
        previousOverride = process.env.CASOMER_CONFIG_DIR;
        configDirectory = await mkdtemp( join( tmpdir(), 'casomer-user-config-' ) );
        process.env.CASOMER_CONFIG_DIR = configDirectory;

        const contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-supporter-' ) );

        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;
    } );

    after( async () =>
    {
        await server.close();

        if ( previousOverride === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousOverride; }
    } );

    it( 'starts without a supporter', async () =>
    {
        assert.equal( await supporter(), false );
    } );

    it( 'refuses an empty key', async () =>
    {
        assert.equal( ( await put( '   ' ) ).status, 400 );
        assert.equal( ( await put( 42 ) ).status, 400 );
    } );

    it( 'stores the key as supporterConfirm and the person becomes a supporter', async () =>
    {
        const key = issueTestKey( 'supporter' );

        assert.equal( ( await put( 'CSMR-NOT-A-KEY' ) ).status, 400 );
        assert.equal( ( await put( issueTestKey( 'license', 'example.com' ) ) ).status, 400 );
        assert.equal( ( await put( `  ${key}  ` ) ).status, 200 );
        assert.equal( ( await config() ).supporterConfirm, key );
        assert.equal( await supporter(), true );
    } );

    it( 'keeps the rest of the config when storing the key', async () =>
    {
        await fetch( `${base}/api/profile?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { name: 'Ada' } ),
        } );
        const second = issueTestKey( 'supporter' );

        await put( second );

        const stored = await config();

        assert.equal( stored.name, 'Ada' );
        assert.equal( stored.supporterConfirm, second );
    } );

    it( 'joining sends the entry, leaving sends the removal, and either waits for the relay', async () =>
    {
        const relay = await startTestRelay( 'valid' );
        const previous = process.env.CASOMER_RELAY_ORIGIN;

        process.env.CASOMER_RELAY_ORIGIN = relay.origin;

        const wall = async ( body: Record<string, unknown> ): Promise<number> => ( await fetch( `${base}/api/supporter-wall?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( body ),
        } ) ).status;

        try
        {
            assert.equal( ( await put( issueTestKey( 'supporter' ) ) ).status, 200 );

            // The avatar is made small as it is chosen, and the wall
            // entry carries that small webp.
            const uploaded = await fetch( `${base}/api/profile-avatar?t=${server.token}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array( makePng( 900, 600 ) ) } );

            assert.equal( uploaded.status, 200 );

            // An SVG is refused at the door: a document with a script
            // slot has no place on casomer.com's origin.
            const svg = await fetch( `${base}/api/profile-avatar?t=${server.token}`, { method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' } );

            assert.equal( svg.status, 400 );
            assert.match( ( await svg.json() as { error: string } ).error, /png, jpeg, or webp/ );
            assert.match( ( await uploaded.json() as { avatar: string } ).avatar, /^avatar-[a-f0-9]{8}\.webp$/ );

            const avatarBytes = Buffer.from( await ( await fetch( `${base}/api/avatar?t=${server.token}` ) ).arrayBuffer() );

            assert.ok( avatarBytes.length > 0 && avatarBytes.length < 40 * 1024, `${avatarBytes.length} bytes` );

            assert.equal( await wall( { join: true, name: 'Ada', github: 'ada' } ), 200 );

            let stored = await config();

            assert.equal( typeof stored.supporterWallSentAt, 'string' );
            assert.equal( stored.supporterWallPending, undefined );
            assert.equal( relay.seen.at( -1 )?.body.name, 'Ada' );
            assert.equal( ( relay.seen.at( -1 )?.body.avatar as { type: string } ).type, 'image/webp' );
            assert.equal( Buffer.from( ( relay.seen.at( -1 )?.body.avatar as { data: string } ).data, 'base64' ).length, avatarBytes.length );

            assert.equal( await wall( { join: false } ), 200 );
            stored = await config();
            assert.equal( stored.supporterWall, false );
            assert.equal( stored.supporterWallSentAt, undefined );
            assert.deepEqual( relay.seen.at( -1 )?.body, { key: stored.supporterConfirm } );

            // Refused (forced private from the desk): not on the wall.
            relay.mood = 'unknown';
            assert.equal( await wall( { join: true, name: 'Ada', github: 'ada' } ), 200 );
            stored = await config();
            assert.equal( stored.supporterWall, false );
            assert.equal( stored.supporterWallSentAt, undefined );

            // Unreachable: the entry waits; a decline with nothing up
            // there has nothing to send.
            relay.mood = 'down';
            assert.equal( await wall( { join: true, name: 'Ada', github: 'ada' } ), 200 );
            assert.equal( ( await config() ).supporterWallPending, true );
            assert.equal( await wall( { join: false } ), 200 );
            stored = await config();
            assert.equal( stored.supporterWallPending, undefined );
            assert.equal( stored.supporterWallSentAt, undefined );
        }
        finally
        {
            process.env.CASOMER_RELAY_ORIGIN = previous;
            await relay.close();
        }
    } );

    it( 'a verified key learns its subscription, and the portal link opens Stripe through the relay', async () =>
    {
        const relay = await startTestRelay( 'subscribed' );
        const previous = process.env.CASOMER_RELAY_ORIGIN;

        process.env.CASOMER_RELAY_ORIGIN = relay.origin;

        try
        {
            assert.equal( ( await put( issueTestKey( 'supporter' ) ) ).status, 200 );

            const stored = await config();

            assert.equal( stored.supporterSubscription, true );
            assert.equal( typeof stored.supporterVerifiedAt, 'string' );

            const user = ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { user: { supporter: boolean; subscription: boolean } } ).user;

            assert.equal( user.supporter, true );
            assert.equal( user.subscription, true );

            const portal = await fetch( `${base}/api/supporter/portal?t=${server.token}`, { redirect: 'manual' } );

            assert.equal( portal.status, 302 );
            assert.equal( portal.headers.get( 'location' ), 'https://billing.stripe.com/p/session/test' );
            assert.equal( relay.seen.at( -1 )?.path, '/api/billing/portal' );

            relay.mood = 'down';
            assert.equal( ( await fetch( `${base}/api/supporter/portal?t=${server.token}`, { redirect: 'manual' } ) ).status, 503 );

            // A revoked key is refused as it is entered, in the registry's words.
            relay.mood = 'revoked';

            const refused = await put( issueTestKey( 'supporter' ) );

            assert.equal( refused.status, 400 );
            assert.match( ( await refused.json() as { error: string } ).error, /revoked/ );

            // DELETE clears the key and what was learned about it.
            assert.equal( ( await fetch( `${base}/api/supporter?t=${server.token}`, { method: 'DELETE' } ) ).status, 200 );

            const cleared = await config();

            assert.equal( cleared.supporterConfirm, undefined );
            assert.equal( cleared.supporterSubscription, undefined );
            assert.equal( cleared.supporterVerifiedAt, undefined );
        }
        finally
        {
            process.env.CASOMER_RELAY_ORIGIN = previous;
            await relay.close();
        }
    } );

    it( 'the wall needs a name and a GitHub handle, then records both', async () =>
    {
        const wall = async ( body: Record<string, unknown> ): Promise<Response> => fetch( `${base}/api/supporter-wall?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( body ),
        } );
        const user = async (): Promise<{ github: string; wall: boolean }> => ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { user: { github: string; wall: boolean } } ).user;

        assert.equal( ( await wall( { join: true, name: 'Ada', github: '' } ) ).status, 400 );
        assert.equal( ( await wall( { join: true, name: '', github: 'ada' } ) ).status, 400 );
        assert.equal( ( await user() ).wall, false );

        assert.equal( ( await wall( { join: true, name: 'Ada L', github: '@https://github.com/ada-l/' } ) ).status, 200 );

        const stored = await config();

        assert.equal( stored.name, 'Ada L' );
        assert.equal( stored.github, 'ada-l' );
        assert.equal( stored.supporterWall, true );
        assert.equal( ( await user() ).github, 'ada-l' );
        assert.equal( ( await user() ).wall, true );

        assert.equal( ( await wall( { join: false } ) ).status, 200 );
        assert.equal( ( await config() ).supporterWall, false );
        assert.equal( ( await user() ).wall, false );
    } );

    it( 'DELETE clears the key and the supporter state', async () =>
    {
        assert.equal( ( await fetch( `${base}/api/supporter?t=${server.token}`, { method: 'DELETE' } ) ).status, 200 );
        assert.equal( 'supporterConfirm' in await config(), false );
        assert.equal( ( await config() ).name, 'Ada L' );
        assert.equal( await supporter(), false );
    } );

    // The sponsor key (Mikey, 2026-09-03): the commercial sibling,
    // same route shape, its own kind and its own confirm flag.
    it( 'the sponsor route stores its own kind and lights user.sponsor', async () =>
    {
        const sponsorPut = async ( key: unknown ): Promise<Response> => fetch( `${base}/api/sponsor?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { key } ),
        } );
        const sponsor = async (): Promise<boolean> => ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { user: { sponsor: boolean } } ).user.sponsor;

        assert.equal( await sponsor(), false );
        assert.equal( ( await sponsorPut( '   ' ) ).status, 400 );

        // A supporter key is the wrong kind here, and vice versa.
        assert.equal( ( await sponsorPut( issueTestKey( 'supporter' ) ) ).status, 400 );
        assert.equal( ( await put( issueTestKey( 'sponsor' ) ) ).status, 400 );

        const key = issueTestKey( 'sponsor' );

        assert.equal( ( await sponsorPut( key ) ).status, 200 );
        assert.equal( ( await config() ).sponsorConfirm, key );
        assert.equal( await sponsor(), true );
        assert.equal( await supporter(), false );

        assert.equal( ( await fetch( `${base}/api/sponsor?t=${server.token}`, { method: 'DELETE' } ) ).status, 200 );
        assert.equal( 'sponsorConfirm' in await config(), false );
        assert.equal( await sponsor(), false );
    } );
} );
