// The licensing mechanics (BUSINESS 5.3 and 5.5): the supporter
// moment fires at five and forty publishes, once each per person and
// never for a supporter; the grace gate keys a commercial site by its
// origin's host, opens at the first commercial publish (either
// witness), counts down fourteen days, and closes on a key. The user
// config is pointed at a temp folder so nothing real is touched.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimSupporterMoment, firstCommercialPublish, licensePageUrl, licenseState, publishCount, recordGraceStart, siteKeyFor, storeLicenseKey, supporterMomentDue } from './gate.ts';
import { readUserConfig, updateUserConfig } from './userConfig.ts';
import { issueTestKey } from './testKeys.ts';
import { runInit, runPublish } from '../cli/commands.ts';
import { runGit } from '../git/repository.ts';

async function makeProject (): Promise<string>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-gate-' ) );

    assert.equal( await runInit( [ '--personal' ], directory ), 0 );
    await runGit( directory, [ 'config', 'user.name', 'Test' ] );
    await runGit( directory, [ 'config', 'user.email', 'test@example.com' ] );
    return directory;
}

async function declare ( directory: string, use: 'personal' | 'commercial', origin?: string ): Promise<void>
{
    const file = join( directory, 'site.json' );
    const site = JSON.parse( await readFile( file, 'utf8' ) ) as Record<string, unknown>;

    site.use = use;

    if ( origin !== undefined ) { site.origin = origin; }

    await writeFile( file, `${JSON.stringify( site, null, 4 )}\n`, 'utf8' );
}

describe( 'licensing', () =>
{
    let previousOverride: string | undefined;

    before( async () =>
    {
        previousOverride = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_CONFIG_DIR = await mkdtemp( join( tmpdir(), 'casomer-gate-config-' ) );
    } );

    after( () =>
    {
        if ( previousOverride === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousOverride; }
    } );

    it( 'the supporter moment is due at five and at forty, each once', () =>
    {
        assert.equal( supporterMomentDue( 4, [] ), null );
        assert.equal( supporterMomentDue( 5, [] ), 5 );
        assert.equal( supporterMomentDue( 12, [ 5 ] ), null );
        assert.equal( supporterMomentDue( 40, [ 5 ] ), 40 );
        assert.equal( supporterMomentDue( 41, [ 5, 40 ] ), null );
        assert.equal( supporterMomentDue( 45, [] ), 40 );
    } );

    it( 'claiming records the moment and a supporter is never asked', async () =>
    {
        assert.equal( await claimSupporterMoment( 3 ), null );
        assert.equal( await claimSupporterMoment( 5 ), 5 );
        assert.equal( await claimSupporterMoment( 5 ), null );
        assert.deepEqual( ( await readUserConfig() ).supporterMoments, [ 5 ] );
        assert.equal( await claimSupporterMoment( 40 ), 40 );
        assert.deepEqual( ( await readUserConfig() ).supporterMoments, [ 5, 40 ] );

        await updateUserConfig( ( config ) =>
        {
            config.supporterMoments = [];
            config.supporterConfirm = issueTestKey( 'supporter' );
        } );
        assert.equal( await claimSupporterMoment( 5 ), null );
        await updateUserConfig( ( config ) => { delete config.supporterConfirm; } );
    } );

    it( 'keys a site by its origin host, else its folder', () =>
    {
        assert.equal( siteKeyFor( 'https://Sunrise-Bakery.com', 'C:/sites/bakery' ), 'sunrise-bakery.com' );
        assert.equal( siteKeyFor( 'http://example.com:8080', '/x' ), 'example.com:8080' );
        assert.equal( siteKeyFor( '', 'C:\\Sites\\Bakery\\' ), 'folder:c:/sites/bakery' );
        assert.equal( siteKeyFor( undefined, '/srv/site' ), 'folder:/srv/site' );
    } );

    it( 'a personal site is never gated, and its publishes count', async () =>
    {
        const directory = await makeProject();

        assert.equal( await publishCount( directory ), 0 );
        assert.equal( await runPublish( [], directory ), 0 );
        assert.equal( await publishCount( directory ), 1 );

        const state = await licenseState( { directory, declaredUse: 'personal' } );

        assert.equal( state.phase, 'personal' );
        assert.equal( await firstCommercialPublish( directory ), null );
    } );

    it( 'a commercial site opens its window at the first commercial publish, counts down, expires, and a key closes the gate', async () =>
    {
        const directory = await makeProject();

        assert.equal( await runPublish( [], directory ), 0 );
        await declare( directory, 'commercial', 'https://sunrise-bakery.com' );

        const before = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com' } );

        assert.equal( before.phase, 'unstarted' );
        assert.equal( before.daysLeft, 14 );
        assert.equal( before.siteKey, 'sunrise-bakery.com' );

        assert.equal( await runPublish( [], directory ), 0 );

        const anchor = await firstCommercialPublish( directory );

        assert.notEqual( anchor, null );

        const opened = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com' } );

        assert.equal( opened.phase, 'grace' );
        assert.equal( opened.daysLeft, 14 );

        const later = new Date( Date.parse( anchor as string ) + 3.5 * 24 * 60 * 60 * 1000 );
        const midway = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com', now: later } );

        assert.equal( midway.phase, 'grace' );
        assert.equal( midway.daysLeft, 11 );

        const past = new Date( Date.parse( anchor as string ) + 15 * 24 * 60 * 60 * 1000 );
        const expired = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com', now: past } );

        assert.equal( expired.phase, 'expired' );
        assert.equal( expired.daysLeft, 0 );

        await storeLicenseKey( 'sunrise-bakery.com', issueTestKey( 'license', 'other.example' ) );

        const wrongSite = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com', now: past } );

        assert.equal( wrongSite.phase, 'expired' );
        assert.equal( wrongSite.hasKey, false );

        const good = issueTestKey( 'license', 'sunrise-bakery.com' );

        await storeLicenseKey( 'sunrise-bakery.com', ` ${good} ` );

        const licensed = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://sunrise-bakery.com', now: past } );

        assert.equal( licensed.phase, 'licensed' );
        assert.equal( licensed.hasKey, true );
        assert.equal( ( ( await readUserConfig() ).licenses as Record<string, string> )[ 'sunrise-bakery.com' ], good );
    } );

    it( 'the earlier witness wins, and a recorded start survives a fresh repository', async () =>
    {
        const directory = await makeProject();
        const early = '2026-01-01T00:00:00.000Z';

        await recordGraceStart( 'folder-witness.test', early );
        await recordGraceStart( 'folder-witness.test', '2026-08-01T00:00:00.000Z' );

        const state = await licenseState( { directory, declaredUse: 'commercial', origin: 'https://folder-witness.test', now: new Date( '2026-01-10T00:00:00.000Z' ) } );

        assert.equal( state.anchor, early );
        assert.equal( state.phase, 'grace' );
        assert.equal( state.daysLeft, 5 );
    } );
} );

describe( 'the license page link', () =>
{
    it( 'carries the site host, lower-case, and nothing without an address', () =>
    {
        assert.equal( licensePageUrl( 'https://www.Sunrise-Bakery.com' ), 'https://casomer.com/license?site=www.sunrise-bakery.com' );
        assert.equal( licensePageUrl( 'https://example.com:8443/' ), 'https://casomer.com/license?site=example.com%3A8443' );
        assert.equal( licensePageUrl( '' ), 'https://casomer.com/license' );
        assert.equal( licensePageUrl( undefined ), 'https://casomer.com/license' );
        assert.equal( licensePageUrl( 'not an address' ), 'https://casomer.com/license' );
    } );
} );
