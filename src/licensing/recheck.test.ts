// Revocation at publish: a stored key is asked about once a day at
// most; a revoked answer clears it and says so, a valid one stamps
// the date (and the subscription behind a supporter key), no answer
// changes nothing. The user config is a temp folder and the relay a
// local stand-in.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RECHECK_AFTER_MS, recheckKeysAtPublish, recheckLicenseKey, recheckPersonKey } from './recheck.ts';
import { issueTestKey } from './testKeys.ts';
import { startTestRelay, type TestRelay } from './testRelay.ts';
import { readUserConfig, updateUserConfig } from './userConfig.ts';

describe( 'the re-check at publish', () =>
{
    let relay: TestRelay;
    let previousOrigin: string | undefined;
    let previousConfig: string | undefined;
    const site = 'sunrise-bakery.com';
    const license = issueTestKey( 'license', site );
    const supporter = issueTestKey( 'supporter' );
    const sponsor = issueTestKey( 'sponsor' );
    const now = Date.parse( '2026-09-04T12:00:00.000Z' );

    before( async () =>
    {
        relay = await startTestRelay();
        previousOrigin = process.env.CASOMER_RELAY_ORIGIN;
        previousConfig = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_RELAY_ORIGIN = relay.origin;
        process.env.CASOMER_CONFIG_DIR = await mkdtemp( join( tmpdir(), 'casomer-recheck-' ) );
    } );

    after( async () =>
    {
        await relay.close();

        if ( previousOrigin === undefined ) { delete process.env.CASOMER_RELAY_ORIGIN; }
        else { process.env.CASOMER_RELAY_ORIGIN = previousOrigin; }
        if ( previousConfig === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousConfig; }
    } );

    beforeEach( async () =>
    {
        relay.mood = 'valid';
        relay.seen.length = 0;
        await updateUserConfig( ( config ) =>
        {
            for ( const key of Object.keys( config ) ) { delete config[ key ]; }

            config.licenses = { [ site ]: license };
            config.supporterConfirm = supporter;
            config.sponsorConfirm = sponsor;
        } );
    } );

    it( 'asks nothing when no key is stored, or the stored one does not verify', async () =>
    {
        await updateUserConfig( ( config ) =>
        {
            config.licenses = { [ site ]: 'CSMR.not.a.key' };
            delete config.supporterConfirm;
        } );

        assert.equal( await recheckLicenseKey( site, now ), null );
        assert.equal( await recheckPersonKey( 'supporter', now ), null );
        assert.equal( relay.seen.length, 0 );
    } );

    it( 'a valid answer stamps the date, and the next day is the next ask', async () =>
    {
        assert.equal( await recheckLicenseKey( site, now ), null );
        assert.deepEqual( relay.seen.at( -1 )?.body, { key: license, host: site } );
        assert.equal( ( ( await readUserConfig() ).licensesVerifiedAt as Record<string, string> )[ site ], new Date( now ).toISOString() );

        assert.equal( await recheckLicenseKey( site, now + RECHECK_AFTER_MS - 1 ), null );
        assert.equal( relay.seen.length, 1 );

        assert.equal( await recheckLicenseKey( site, now + RECHECK_AFTER_MS ), null );
        assert.equal( relay.seen.length, 2 );
    } );

    it( 'a revoked answer clears the key and says so in the registry\'s words', async () =>
    {
        relay.mood = 'revoked';

        const notice = await recheckLicenseKey( site, now );

        assert.equal( notice?.kind, 'license' );
        assert.match( notice?.problem ?? '', /license key has been revoked/ );

        const config = await readUserConfig();

        assert.deepEqual( config.licenses, {} );
        assert.deepEqual( config.licensesVerifiedAt, {} );

        // Gone is gone: nothing left to ask about.
        assert.equal( await recheckLicenseKey( site, now ), null );
        assert.equal( relay.seen.length, 1 );
    } );

    it( 'no answer is no news: the key stays, unstamped, and is asked about next time', async () =>
    {
        relay.mood = 'down';
        assert.equal( await recheckLicenseKey( site, now ), null );

        const config = await readUserConfig();

        assert.equal( ( config.licenses as Record<string, string> )[ site ], license );
        assert.equal( config.licensesVerifiedAt, undefined );

        relay.mood = 'unknown';
        assert.equal( await recheckLicenseKey( site, now ), null );
        assert.equal( ( ( await readUserConfig() ).licenses as Record<string, string> )[ site ], license );
    } );

    it( 'a supporter key learns its subscription; a sponsor key is asked the same way', async () =>
    {
        relay.mood = 'subscribed';
        assert.equal( await recheckPersonKey( 'supporter', now ), null );

        let config = await readUserConfig();

        assert.equal( config.supporterVerifiedAt, new Date( now ).toISOString() );
        assert.equal( config.supporterSubscription, true );
        assert.deepEqual( relay.seen.at( -1 )?.body, { key: supporter } );

        relay.mood = 'valid';
        assert.equal( await recheckPersonKey( 'supporter', now + RECHECK_AFTER_MS ), null );
        assert.equal( ( await readUserConfig() ).supporterSubscription, false );

        relay.mood = 'revoked';

        const notice = await recheckPersonKey( 'sponsor', now );

        assert.match( notice?.problem ?? '', /sponsor key has been revoked/ );
        config = await readUserConfig();
        assert.equal( config.sponsorConfirm, undefined );
        assert.equal( config.supporterConfirm, supporter );
    } );

    it( 'the round at publish asks about every key, and stops at the first the registry cannot answer', async () =>
    {
        relay.mood = 'revoked';

        const notices = await recheckKeysAtPublish( site, now );

        assert.deepEqual( notices.map( ( notice ) => notice.kind ), [ 'license', 'supporter', 'sponsor' ] );
        assert.equal( relay.seen.length, 3 );

        await updateUserConfig( ( config ) =>
        {
            config.licenses = { [ site ]: license };
            config.supporterConfirm = supporter;
        } );
        relay.seen.length = 0;
        relay.mood = 'down';
        assert.deepEqual( await recheckKeysAtPublish( site, now ), [] );
        assert.equal( relay.seen.length, 1 );
    } );
} );
