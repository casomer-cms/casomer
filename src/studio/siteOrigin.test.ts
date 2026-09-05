// The site's public address (SCHEMA 12.3): Site settings writes it
// through the site-meta patch, normalized; an empty one clears it;
// a path is refused; the snapshot carries it for the chrome.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { normalizeOrigin } from '../content/siteConfig.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'the site address', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;

    const put = async ( origin: unknown ): Promise<Response> => fetch( `${base}/api/site-meta?t=${server.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify( { origin } ),
    } );
    const stored = async (): Promise<string | undefined> => ( JSON.parse( await readFile( join( contentDirectory, 'site.json' ), 'utf8' ) ) as { origin?: string } ).origin;
    const snapshot = async (): Promise<string> => ( ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() ) as { origin: string } ).origin;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-origin-' ) );
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
    } );

    it( 'normalizes addresses and refuses what is not one', () =>
    {
        assert.equal( normalizeOrigin( 'Example.com' ), 'https://example.com' );
        assert.equal( normalizeOrigin( 'http://Example.com:8080/' ), 'http://example.com:8080' );
        assert.equal( normalizeOrigin( '  ' ), '' );
        assert.equal( normalizeOrigin( 'https://example.com/shop' ), null );
        assert.equal( normalizeOrigin( 'https://example.com?x=1' ), null );
        assert.equal( normalizeOrigin( 'ftp://example.com' ), null );
        assert.equal( normalizeOrigin( 'not an address' ), null );
    } );

    it( 'starts unset, stores a normalized address, then clears it', async () =>
    {
        assert.equal( await snapshot(), '' );
        assert.equal( ( await put( 'Sunrise-Bakery.com' ) ).status, 200 );
        assert.equal( await stored(), 'https://sunrise-bakery.com' );
        assert.equal( await snapshot(), 'https://sunrise-bakery.com' );
        assert.equal( ( await put( 'https://sunrise-bakery.com/menu' ) ).status, 400 );
        assert.equal( await stored(), 'https://sunrise-bakery.com' );
        assert.equal( ( await put( '' ) ).status, 200 );
        assert.equal( await stored(), undefined );
        assert.equal( await snapshot(), '' );
    } );
} );
