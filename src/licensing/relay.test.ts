// The online half of verification is opportunistic: a reachable
// registry answers valid or revoked, an unreachable one answers
// nothing and the caller carries on. A mock relay stands in for
// casomer.com through CASOMER_RELAY_ORIGIN.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { activateLicenseOnline, billingPortalOnline, checkKeyOnline, onlineProblem, removeWallEntry, sendWallEntry } from './relay.ts';

describe( 'the relay client', () =>
{
    let server: Server;
    let previous: string | undefined;
    let mode: 'valid' | 'revoked' | 'unknown' | 'slow' | 'down' = 'valid';
    const seen: { path: string; method: string; body: Record<string, unknown> }[] = [];

    before( async () =>
    {
        server = createServer( ( request, response ) =>
        {
            let raw = '';

            request.on( 'data', ( chunk: Buffer ) => { raw += chunk.toString( 'utf8' ); } );
            request.on( 'end', () =>
            {
                const body = raw === '' ? {} : JSON.parse( raw ) as Record<string, unknown>;

                seen.push( { path: request.url ?? '', method: request.method ?? '', body } );

                if ( mode === 'slow' ) { return; }

                // Cloudflare's own page for a dead origin: not JSON.
                if ( mode === 'down' )
                {
                    response.writeHead( 530, { 'content-type': 'text/plain' } );
                    response.end( 'error code: 1016' );

                    return;
                }

                const answers: Record<string, unknown> = {
                    '/api/keys/verify': mode === 'valid' ? { valid: true, revoked: false, subscription: true } : ( mode === 'revoked' ? { valid: false, revoked: true, reason: 'revoked' } : { valid: false, revoked: false, reason: 'unknown' } ),
                    '/api/licenses/activate': { activated: mode === 'valid' },
                    '/api/supporters/wall': { saved: mode === 'valid', removed: mode === 'valid' },
                    '/api/billing/portal': { url: 'https://billing.stripe.com/p/session/x' },
                };

                response.writeHead( 200, { 'content-type': 'application/json' } );
                response.end( JSON.stringify( answers[ request.url ?? '' ] ?? { error: 'no such route' } ) );
            } );
        } );
        await new Promise<void>( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );

        const address = server.address();

        previous = process.env.CASOMER_RELAY_ORIGIN;
        process.env.CASOMER_RELAY_ORIGIN = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    } );

    after( async () =>
    {
        server.closeAllConnections();
        await new Promise<void>( ( resolve ) => server.close( () => resolve() ) );

        if ( previous === undefined ) { delete process.env.CASOMER_RELAY_ORIGIN; }
        else { process.env.CASOMER_RELAY_ORIGIN = previous; }
    } );

    it( 'reports valid, revoked, and unknown keys', async () =>
    {
        mode = 'valid';
        assert.deepEqual( await checkKeyOnline( 'CSMR.x.y', 'example.com' ), { valid: true, revoked: false, subscription: true } );
        assert.deepEqual( seen.at( -1 )?.body, { key: 'CSMR.x.y', host: 'example.com' } );

        mode = 'revoked';

        const revoked = await checkKeyOnline( 'CSMR.x.y' );

        assert.equal( revoked?.valid, false );
        assert.equal( revoked?.revoked, true );
        assert.match( onlineProblem( revoked as { valid: boolean; revoked: boolean }, 'license' ), /revoked/ );

        mode = 'unknown';
        assert.match( onlineProblem( ( await checkKeyOnline( 'CSMR.x.y' ) ) as { valid: boolean; revoked: boolean; reason?: string }, 'supporter' ), /does not know/ );
    } );

    it( 'activates and sends a wall entry', async () =>
    {
        mode = 'valid';
        assert.equal( await activateLicenseOnline( 'CSMR.x.y', 'example.com' ), true );
        assert.equal( await sendWallEntry( { key: 'CSMR.x.y', name: 'Ada', github: 'ada' } ), true );
        assert.deepEqual( seen.at( -1 )?.body, { key: 'CSMR.x.y', name: 'Ada', github: 'ada' } );
        assert.equal( await billingPortalOnline( 'CSMR.x.y' ), 'https://billing.stripe.com/p/session/x' );
        assert.deepEqual( seen.at( -1 )?.body, { key: 'CSMR.x.y' } );
        assert.equal( await removeWallEntry( 'CSMR.x.y' ), true );
        assert.equal( seen.at( -1 )?.method, 'DELETE' );
    } );

    it( 'treats a 5xx from the relay as no news, not a refusal', async () =>
    {
        mode = 'down';
        assert.equal( await checkKeyOnline( 'CSMR.x.y' ), null );
        assert.equal( await activateLicenseOnline( 'CSMR.x.y', 'example.com' ), null );
        assert.equal( await sendWallEntry( { key: 'CSMR.x.y', name: 'Ada', github: 'ada' } ), null );
        assert.equal( await billingPortalOnline( 'CSMR.x.y' ), null );
        assert.equal( await removeWallEntry( 'CSMR.x.y' ), null );
        mode = 'valid';
    } );

    it( 'answers nothing when the relay cannot be reached', async () =>
    {
        const origin = process.env.CASOMER_RELAY_ORIGIN;

        process.env.CASOMER_RELAY_ORIGIN = 'http://127.0.0.1:1';
        assert.equal( await checkKeyOnline( 'CSMR.x.y' ), null );
        assert.equal( await sendWallEntry( { key: 'CSMR.x.y', name: 'Ada', github: 'ada' } ), null );
        process.env.CASOMER_RELAY_ORIGIN = origin;
    } );
} );
