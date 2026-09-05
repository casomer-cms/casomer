// Go live over SFTP, against a real SFTP server in this process: the
// ssh2 package ships the server half, so the transport is tested for
// real (login, listing, mkdir, upload, delete, the trusted host key)
// with nothing mocked but the host itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

import ssh2, { type Server } from 'ssh2';

import { deployChangeSet, deployTargetOf, normalizeRemotePath, readDeployRecord, runDeploy, testConnection, updateDeployRecord, uploadChanges, type SftpTarget } from './sftp.ts';
import { runGit } from '../git/repository.ts';

const { STATUS_CODE, flagsToString } = ssh2.utils.sftp;

// A small SFTP server over a folder: what an upload needs and no more.
function serve ( root: string ): Promise<{ server: Server; port: number }>
{
    const hostKey = generateKeyPairSync( 'rsa', { modulusLength: 2048 } ).privateKey.export( { type: 'pkcs1', format: 'pem' } ) as string;
    const server = new ssh2.Server( { hostKeys: [ hostKey ] }, ( client ) =>
    {
        // A client that walks away mid-handshake (the host-key test)
        // is the server's error event, not the test's.
        client.on( 'error', () => {} );
        client.on( 'authentication', ( context ) =>
        {
            if ( context.method === 'password' && context.username === 'sunrise' && context.password === 'secret' ) { context.accept(); }
            else { context.reject( [ 'password' ] ); }
        } ).on( 'ready', () =>
        {
            client.on( 'session', ( acceptSession ) =>
            {
                const session = acceptSession();

                session.on( 'sftp', ( acceptSftp ) =>
                {
                    const sftp = acceptSftp();
                    const handles = new Map<number, { fd?: number; entries?: string[]; path: string }>();
                    let next = 1;
                    const local = ( remote: string ): string => join( root, remote.replace( /^\/+/, '' ) );
                    const handleOf = ( entry: { fd?: number; entries?: string[]; path: string } ): Buffer =>
                    {
                        const id = next;

                        next += 1;
                        handles.set( id, entry );

                        const buffer = Buffer.alloc( 4 );

                        buffer.writeUInt32BE( id );

                        return buffer;
                    };
                    const attrsOf = ( path: string ): { mode: number; size: number; uid: number; gid: number; atime: number; mtime: number } | null =>
                    {
                        try
                        {
                            const info = statSync( path );

                            return { mode: info.mode, size: info.size, uid: 0, gid: 0, atime: Math.floor( info.atimeMs / 1000 ), mtime: Math.floor( info.mtimeMs / 1000 ) };
                        }
                        catch
                        {
                            return null;
                        }
                    };

                    sftp.on( 'OPEN', ( reqId, filename, flags ) =>
                    {
                        const mode = flagsToString( flags ) ?? 'r';

                        try
                        {
                            sftp.handle( reqId, handleOf( { fd: openSync( local( filename ), mode ), path: filename } ) );
                        }
                        catch
                        {
                            sftp.status( reqId, STATUS_CODE.NO_SUCH_FILE );
                        }
                    } );
                    sftp.on( 'WRITE', ( reqId, handle, offset, data ) =>
                    {
                        const entry = handles.get( handle.readUInt32BE() );

                        if ( entry?.fd === undefined )
                        {
                            sftp.status( reqId, STATUS_CODE.FAILURE );
                            return;
                        }

                        writeSync( entry.fd, data, 0, data.length, offset );
                        sftp.status( reqId, STATUS_CODE.OK );
                    } );
                    sftp.on( 'FSTAT', ( reqId, handle ) =>
                    {
                        const entry = handles.get( handle.readUInt32BE() );
                        const attrs = entry === undefined ? null : attrsOf( local( entry.path ) );

                        if ( attrs === null ) { sftp.status( reqId, STATUS_CODE.FAILURE ); }
                        else { sftp.attrs( reqId, attrs ); }
                    } );
                    sftp.on( 'FSETSTAT', ( reqId ) => { sftp.status( reqId, STATUS_CODE.OK ); } );
                    sftp.on( 'SETSTAT', ( reqId ) => { sftp.status( reqId, STATUS_CODE.OK ); } );
                    sftp.on( 'CLOSE', ( reqId, handle ) =>
                    {
                        const id = handle.readUInt32BE();
                        const entry = handles.get( id );

                        if ( entry?.fd !== undefined ) { closeSync( entry.fd ); }

                        handles.delete( id );
                        sftp.status( reqId, STATUS_CODE.OK );
                    } );
                    sftp.on( 'MKDIR', ( reqId, path ) =>
                    {
                        try
                        {
                            mkdirSync( local( path ) );
                            sftp.status( reqId, STATUS_CODE.OK );
                        }
                        catch
                        {
                            sftp.status( reqId, STATUS_CODE.FAILURE );
                        }
                    } );
                    sftp.on( 'OPENDIR', ( reqId, path ) =>
                    {
                        try
                        {
                            sftp.handle( reqId, handleOf( { entries: readdirSync( local( path ) ), path } ) );
                        }
                        catch
                        {
                            sftp.status( reqId, STATUS_CODE.NO_SUCH_FILE );
                        }
                    } );
                    sftp.on( 'READDIR', ( reqId, handle ) =>
                    {
                        const entry = handles.get( handle.readUInt32BE() );

                        if ( entry?.entries === undefined )
                        {
                            sftp.status( reqId, STATUS_CODE.FAILURE );
                            return;
                        }

                        if ( entry.entries.length === 0 )
                        {
                            sftp.status( reqId, STATUS_CODE.EOF );
                            return;
                        }

                        const names = entry.entries.splice( 0 );

                        sftp.name( reqId, names.map( ( filename ) => ( { filename, longname: filename, attrs: attrsOf( join( local( entry.path ), filename ) ) ?? { mode: 0, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 } } ) ) );
                    } );
                    sftp.on( 'REMOVE', ( reqId, path ) =>
                    {
                        try
                        {
                            unlinkSync( local( path ) );
                            sftp.status( reqId, STATUS_CODE.OK );
                        }
                        catch
                        {
                            sftp.status( reqId, STATUS_CODE.NO_SUCH_FILE );
                        }
                    } );

                    const statOf = ( reqId: number, path: string ): void =>
                    {
                        const attrs = attrsOf( local( path ) );

                        if ( attrs === null ) { sftp.status( reqId, STATUS_CODE.NO_SUCH_FILE ); }
                        else { sftp.attrs( reqId, attrs ); }
                    };

                    sftp.on( 'STAT', statOf );
                    sftp.on( 'LSTAT', statOf );

                    sftp.on( 'REALPATH', ( reqId, path ) => { sftp.name( reqId, [ { filename: posix.normalize( path ), longname: path, attrs: { mode: 0, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 } } ] ); } );
                } );
            } );
        } );
    } );

    return new Promise( ( resolve ) =>
    {
        server.listen( 0, '127.0.0.1', () =>
        {
            const address = server.address() as { port: number };

            resolve( { server, port: address.port } );
        } );
    } );
}

describe( 'go live over SFTP', () =>
{
    let root: string;
    let site: string;
    let configDirectory: string;
    let server: Server;
    let target: SftpTarget;
    let previousConfigDirectory: string | undefined;

    const git = ( arguments_: readonly string[] ): ReturnType<typeof runGit> => runGit( site, [ '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...arguments_ ] );

    before( async () =>
    {
        root = await mkdtemp( join( tmpdir(), 'casomer-sftp-host-' ) );
        site = await mkdtemp( join( tmpdir(), 'casomer-sftp-site-' ) );
        configDirectory = await mkdtemp( join( tmpdir(), 'casomer-sftp-config-' ) );
        previousConfigDirectory = process.env.CASOMER_CONFIG_DIR;
        process.env.CASOMER_CONFIG_DIR = configDirectory;

        await mkdir( join( root, 'public_html' ) );
        await writeFile( join( root, 'public_html', 'old.txt' ), 'old' );
        await writeFile( join( root, 'public_html', 'keep.txt' ), 'keep' );

        const served = await serve( root );

        server = served.server;
        target = { host: '127.0.0.1', port: served.port, user: 'sunrise', path: '/public_html', enabled: true };
    } );

    after( async () =>
    {
        server.close();

        if ( previousConfigDirectory === undefined ) { delete process.env.CASOMER_CONFIG_DIR; }
        else { process.env.CASOMER_CONFIG_DIR = previousConfigDirectory; }

        await rm( root, { recursive: true, force: true } );
        await rm( site, { recursive: true, force: true } );
        await rm( configDirectory, { recursive: true, force: true } );
    } );

    it( 'reads the destination from site.json and spells the folder one way', () =>
    {
        assert.deepEqual( deployTargetOf( { sftp: { host: ' ftp.example.com ', user: 'sunrise', path: 'public_html/' } } ), { host: 'ftp.example.com', port: 22, user: 'sunrise', path: 'public_html', enabled: true } );
        assert.deepEqual( deployTargetOf( { sftp: { host: 'h', port: 2222, user: 'u', path: '\\www\\', enabled: false } } )?.enabled, false );
        assert.equal( deployTargetOf( { sftp: { host: '' } } ), null );
        assert.equal( deployTargetOf( undefined ), null );
        assert.equal( normalizeRemotePath( '  /  ' ), '/' );
    } );

    it( 'tests a connection: says what is in the folder, trusts the host key once', async () =>
    {
        const first = await testConnection( target, { password: 'secret' } );

        assert.equal( first.ok, true );

        if ( !first.ok ) { return; }

        assert.equal( first.entries, 2 );
        assert.match( first.hostKey, /^SHA256:/ );
        assert.equal( first.trusted, 'new' );

        const again = await testConnection( target, { password: 'secret', hostKey: first.hostKey } );

        assert.equal( again.ok && again.trusted, 'known' );

        const changed = await testConnection( target, { password: 'secret', hostKey: 'SHA256:somethingelse' } );

        assert.equal( changed.ok, false );
        assert.match( !changed.ok ? changed.error : '', /host key changed/ );
    } );

    it( 'says plainly when the login or the folder is wrong', async () =>
    {
        const wrong = await testConnection( target, { password: 'nope' } );

        assert.equal( wrong.ok, false );
        assert.match( !wrong.ok ? wrong.error : '', /user name and password/ );

        const folder = await testConnection( { ...target, path: '/nowhere' }, { password: 'secret' } );

        assert.equal( folder.ok, false );
        assert.match( !folder.ok ? folder.error : '', /folder does not exist/ );

        const nobody = await testConnection( { ...target, port: 1 }, { password: 'secret' } );

        assert.equal( nobody.ok, false );
    } );

    it( 'uploads everything the first time and only the difference after, media included', async () =>
    {
        await git( [ 'init', '-q' ] );
        await writeFile( join( site, '.gitignore' ), 'dist/media/\n' );
        await mkdir( join( site, 'dist', 'about' ), { recursive: true } );
        await mkdir( join( site, 'dist', 'media' ), { recursive: true } );
        await writeFile( join( site, 'dist', 'index.html' ), 'home v1' );
        await writeFile( join( site, 'dist', 'about', 'index.html' ), 'about' );
        await writeFile( join( site, 'dist', 'media', 'a.png' ), 'AAA' );
        await git( [ 'add', '-A' ] );
        await git( [ 'commit', '-q', '-m', 'casomer: publish 2 pages' ] );

        const siteKey = 'sunrise.example';

        await updateDeployRecord( siteKey, { password: 'secret' } );

        const first = await runDeploy( site, siteKey, target );

        assert.deepEqual( first, { ok: true, uploaded: 3, deleted: 0, full: true } );
        assert.equal( await readFile( join( root, 'public_html', 'index.html' ), 'utf8' ), 'home v1' );
        assert.equal( await readFile( join( root, 'public_html', 'about', 'index.html' ), 'utf8' ), 'about' );
        assert.equal( await readFile( join( root, 'public_html', 'media', 'a.png' ), 'utf8' ), 'AAA' );
        assert.equal( existsSync( join( root, 'public_html', 'old.txt' ) ), true, 'what was on the host and not ours stays' );

        const record = await readDeployRecord( siteKey );

        assert.match( record.hostKey ?? '', /^SHA256:/ );
        assert.equal( record.manifest?.[ 'dist/media/a.png' ] !== undefined, true );

        // The next publish: a changed page, a removed page, a new
        // media file, one media file gone.
        await writeFile( join( site, 'dist', 'index.html' ), 'home v2' );
        await rm( join( site, 'dist', 'about' ), { recursive: true } );
        await writeFile( join( site, 'dist', 'media', 'b.png' ), 'BBB' );
        await rm( join( site, 'dist', 'media', 'a.png' ) );
        await git( [ 'add', '-A' ] );
        await git( [ 'commit', '-q', '-m', 'casomer: publish 1 page' ] );

        const set = await deployChangeSet( site, await readDeployRecord( siteKey ) );

        assert.equal( set.full, false );
        assert.deepEqual( set.changes.map( ( change ) => `${change.local === null ? '-' : '+'}${change.path}` ).sort(), [ '+index.html', '+media/b.png', '-about/index.html', '-media/a.png' ] );

        const second = await runDeploy( site, siteKey, target );

        assert.deepEqual( second, { ok: true, uploaded: 2, deleted: 2, full: false } );
        assert.equal( await readFile( join( root, 'public_html', 'index.html' ), 'utf8' ), 'home v2' );
        assert.equal( existsSync( join( root, 'public_html', 'about', 'index.html' ) ), false );
        assert.equal( existsSync( join( root, 'public_html', 'media', 'a.png' ) ), false );
        assert.equal( await readFile( join( root, 'public_html', 'media', 'b.png' ), 'utf8' ), 'BBB' );

        // Nothing new: nothing moves.
        const third = await runDeploy( site, siteKey, target );

        assert.deepEqual( third, { ok: true, uploaded: 0, deleted: 0, full: false } );

        // A failed upload leaves the record where it was, so the next
        // publish carries the same difference again.
        await updateDeployRecord( siteKey, { password: 'wrong' } );

        const failed = await runDeploy( site, siteKey, target );

        assert.equal( failed.ok, false );
        assert.equal( ( await readDeployRecord( siteKey ) ).commit, set.commit );
    } );

    it( 'refuses to upload without a password or key on record', async () =>
    {
        const outcome = await runDeploy( site, 'nothing.example', target );

        assert.equal( outcome.ok, false );
        assert.match( !outcome.ok ? outcome.error : '', /No password or key file/ );
    } );

    it( 'carries an explicit change list as given', async () =>
    {
        const file = join( site, 'extra.txt' );

        await writeFile( file, 'extra' );

        const result = await uploadChanges( target, { password: 'secret' }, [ { path: 'deep/er/extra.txt', local: file }, { path: 'missing.txt', local: null } ] );

        assert.equal( result.uploaded, 1 );
        assert.equal( result.deleted, 0 );
        assert.equal( readFileSync( join( root, 'public_html', 'deep', 'er', 'extra.txt' ), 'utf8' ), 'extra' );
    } );
} );
