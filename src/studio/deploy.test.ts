// Go live (SCHEMA 12.4) from Studio's side: the destination is written
// into site.json, the password into the user config (never the repo),
// the snapshot says what is set without saying the secret, and the
// test and upload routes refuse plainly when something is missing.
// The transport itself is tested against a real server in
// src/deploy/sftp.test.ts.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { readUserConfig } from '../licensing/userConfig.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'go live from Studio', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let configDirectory: string;
    let previousConfigDirectory: string | undefined;

    const call = async ( method: string, path: string, body?: unknown ): Promise<{ status: number; body: Record<string, unknown> }> =>
    {
        const response = await fetch( `${base}${path}?t=${server.token}`, { method, headers: { 'content-type': 'application/json' }, ...( body === undefined ? {} : { body: JSON.stringify( body ) } ) } );

        return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const siteJson = async (): Promise<Record<string, unknown>> => JSON.parse( await readFile( join( contentDirectory, 'site.json' ), 'utf8' ) ) as Record<string, unknown>;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-deploy-' ) );
        configDirectory = await mkdtemp( join( tmpdir(), 'casomer-deploy-config-' ) );
        previousConfigDirectory = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_CONFIG_DIR = configDirectory;
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

        if ( previousConfigDirectory === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousConfigDirectory; }

        await rm( configDirectory, { recursive: true, force: true } );
    } );

    it( 'starts unset, and the upload route says so', async () =>
    {
        const snapshot = ( await call( 'GET', '/api/site' ) ).body.deploy as { target: unknown; hasCredential: boolean };

        assert.equal( snapshot.target, null );
        assert.equal( snapshot.hasCredential, false );

        const run = await call( 'POST', '/api/deploy/run' );

        assert.equal( run.status, 400 );
        assert.match( String( run.body.error ), /No host/ );
    } );

    it( 'saves the destination in site.json and the password in the user config', async () =>
    {
        const saved = await call( 'PUT', '/api/deploy', { host: 'ftp.example.com', port: '', user: 'sunrise', path: 'public_html/', password: 'hunter2' } );

        assert.equal( saved.status, 200 );

        const site = await siteJson();

        assert.deepEqual( site.deploy, { sftp: { host: 'ftp.example.com', port: 22, user: 'sunrise', path: 'public_html', enabled: true } } );
        assert.equal( JSON.stringify( site ).includes( 'hunter2' ), false, 'the password never touches the repository' );

        const config = await readUserConfig();
        const records = config.deploys as Record<string, { password?: string }>;

        assert.equal( Object.values( records ).some( ( record ) => record.password === 'hunter2' ), true );

        const snapshot = ( await call( 'GET', '/api/site' ) ).body.deploy as { target: { host: string; enabled: boolean }; hasCredential: boolean; credential: string; hostKeyTrusted: boolean };

        assert.equal( snapshot.target.host, 'ftp.example.com' );
        assert.equal( snapshot.hasCredential, true );
        assert.equal( snapshot.credential, 'password' );
        assert.equal( snapshot.hostKeyTrusted, false );
        assert.equal( JSON.stringify( snapshot ).includes( 'hunter2' ), false, 'the snapshot never carries the secret' );
    } );

    it( 'switches off without losing the details, and refuses a bad host or port', async () =>
    {
        assert.equal( ( await call( 'PUT', '/api/deploy', { enabled: false } ) ).status, 200 );

        const site = await siteJson();

        assert.equal( ( site.deploy as { sftp: { enabled: boolean; host: string } } ).sftp.enabled, false );
        assert.equal( ( site.deploy as { sftp: { host: string } } ).sftp.host, 'ftp.example.com' );

        assert.equal( ( await call( 'PUT', '/api/deploy', { host: 'https://ftp.example.com/' } ) ).status, 400 );
        assert.equal( ( await call( 'PUT', '/api/deploy', { port: 70000 } ) ).status, 400 );
        assert.equal( ( await call( 'PUT', '/api/deploy', { user: '' } ) ).status, 400 );
    } );

    it( 'refuses to test without a host or a credential', async () =>
    {
        const nothing = await call( 'POST', '/api/deploy/test', { host: '', user: '' } );

        assert.equal( nothing.status, 400 );

        // A different host than the saved one starts from no secret.
        const other = await call( 'POST', '/api/deploy/test', { host: 'other.example.com', user: 'x' } );

        assert.equal( other.status, 400 );
        assert.match( String( other.body.error ), /password or a key file/ );
    } );

    it( 'switches pull & push in site.json, on being the key\'s absence', async () =>
    {
        assert.equal( ( await call( 'PUT', '/api/deploy/git', { enabled: false } ) ).status, 200 );
        assert.deepEqual( ( ( await siteJson() ).deploy as { git: unknown } ).git, { enabled: false } );
        assert.equal( ( ( await call( 'GET', '/api/site' ) ).body.deploy as { git: { enabled: boolean } } ).git.enabled, false );
        assert.equal( ( await call( 'PUT', '/api/deploy/git', { enabled: true } ) ).status, 200 );
        assert.equal( ( ( await siteJson() ).deploy as { git?: unknown } | undefined )?.git, undefined );
        assert.equal( ( await call( 'PUT', '/api/deploy/git', { enabled: 'yes' } ) ).status, 400 );
    } );

    it( 'clears the destination when the host is emptied', async () =>
    {
        assert.equal( ( await call( 'PUT', '/api/deploy', { host: '' } ) ).status, 200 );
        assert.equal( ( await siteJson() ).deploy, undefined );
    } );
} );
