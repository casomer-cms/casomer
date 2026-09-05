// Go live over SFTP (SCHEMA 12.4): publish's last mile for the person
// whose host emailed them SFTP credentials. The destination is data in
// site.json ("deploy.sftp": host, port, user, path); the password or
// key file, the trusted host key, and what was last uploaded live in
// the user config under the site's key, never in the repository. The
// upload is strictly a post-publish step: the commit and the backup
// stand on their own, and a failed upload is retried by the next
// publish (or "upload now") without touching version truth.
//
// Transport: the ssh2 package (decided 2026-09-05, Mikey). The
// platform curl the doctrine counted on has no SFTP on Windows or
// macOS, and OpenSSH's sftp refuses a password without a terminal;
// ssh2 does both auth kinds everywhere and lets the tests run a real
// SFTP server in-process.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

// ssh2 is CommonJS: the default import is its module.exports.
import ssh2, { type Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';

import { runGit } from '../git/repository.ts';
import { readUserConfig, recordAt, updateUserConfig } from '../licensing/userConfig.ts';

export interface SftpTarget
{
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly path: string;
    readonly enabled: boolean;
}

// What the user config holds for one site's destination.
export interface DeployRecord
{
    readonly password?: string;
    readonly keyFile?: string;
    readonly passphrase?: string;

    // The host's key fingerprint, trusted on first connection and
    // required to match after (a changed key is refused, loudly).
    readonly hostKey?: string;

    // The publish commit whose dist is on the host, and the ignored
    // files (media, when untracked) as uploaded: path -> "size:mtime".
    readonly commit?: string;
    readonly manifest?: Readonly<Record<string, string>>;
    readonly at?: string;
}

export interface DeployChange
{
    // Path under dist, forward slashes.
    readonly path: string;

    // The local file, or null when the remote copy is to be removed.
    readonly local: string | null;
}

export type TestOutcome
    = | { readonly ok: true; readonly entries: number; readonly hostKey: string; readonly trusted: 'new' | 'known' }
        | { readonly ok: false; readonly error: string };

export type DeployOutcome
    = | { readonly ok: true; readonly uploaded: number; readonly deleted: number; readonly full: boolean }
        | { readonly ok: false; readonly error: string };

const CONNECT_TIMEOUT_MS = 20000;

export function deployTargetOf ( raw: unknown ): SftpTarget | null
{
    if ( raw === null || typeof raw !== 'object' ) { return null; }

    const sftp = ( raw as { sftp?: unknown } ).sftp;

    if ( sftp === null || typeof sftp !== 'object' ) { return null; }

    const record = sftp as Record<string, unknown>;
    const host = typeof record.host === 'string' ? record.host.trim() : '';

    if ( host === '' ) { return null; }

    return {
        host,
        port: typeof record.port === 'number' && Number.isInteger( record.port ) && record.port > 0 && record.port < 65536 ? record.port : 22,
        user: typeof record.user === 'string' ? record.user.trim() : '',
        path: normalizeRemotePath( typeof record.path === 'string' ? record.path : '/' ),
        enabled: record.enabled !== false,
    };
}

// The host's folder as SFTP spells it: forward slashes, no trailing
// one, "/" for the root; a relative folder (cPanel's "public_html")
// stays relative to the login's home.
export function normalizeRemotePath ( value: string ): string
{
    const trimmed = value.trim().replace( /\\/g, '/' ).replace( /\/+$/, '' );

    return trimmed === '' ? '/' : trimmed;
}

export async function readDeployRecord ( siteKey: string ): Promise<DeployRecord>
{
    const config = await readUserConfig();
    const deploys = config.deploys;

    if ( deploys === null || typeof deploys !== 'object' ) { return {}; }

    const record = ( deploys as Record<string, unknown> )[ siteKey ];

    return record !== null && typeof record === 'object' ? record as DeployRecord : {};
}

export async function updateDeployRecord ( siteKey: string, patch: Partial<Record<keyof DeployRecord, unknown>> ): Promise<void>
{
    await updateUserConfig( ( config ) =>
    {
        const deploys = recordAt( config, 'deploys' );
        const current = ( deploys[ siteKey ] !== null && typeof deploys[ siteKey ] === 'object' ? deploys[ siteKey ] : {} ) as Record<string, unknown>;

        for ( const [ key, value ] of Object.entries( patch ) )
        {
            if ( value === undefined ) { delete current[ key ]; }
            else { current[ key ] = value; }
        }

        deploys[ siteKey ] = current;
        config.deploys = deploys;
    } );
}

export function hasCredential ( record: DeployRecord ): boolean
{
    return ( typeof record.password === 'string' && record.password !== '' ) || ( typeof record.keyFile === 'string' && record.keyFile !== '' );
}

function fingerprintOf ( key: Buffer ): string
{
    return `SHA256:${createHash( 'sha256' ).update( key ).digest( 'base64' ).replace( /=+$/, '' )}`;
}

// The person's words for what went wrong.
export function deployProblem ( error: unknown ): string
{
    const message = error instanceof Error ? error.message : String( error );
    const code = ( error as { code?: unknown } | null )?.code;

    if ( code === 'ENOTFOUND' || /getaddrinfo/i.test( message ) ) { return 'That host could not be found. Check the host name.'; }
    if ( code === 'ECONNREFUSED' ) { return 'The host refused the connection. Check the port; SFTP is usually 22.'; }
    if ( code === 'ETIMEDOUT' || /timed out/i.test( message ) ) { return 'The host did not answer in time. Check the host and port, and that SFTP is enabled for this account.'; }
    if ( /authentication methods failed|auth/i.test( message ) ) { return 'The host did not accept the user name and password (or key). Check them.'; }
    if ( /host key changed/i.test( message ) ) { return message; }
    if ( /no such file|no such path/i.test( message ) ) { return 'That folder does not exist on the host. Check the folder path.'; }
    if ( /permission denied/i.test( message ) ) { return 'The host refused to write there. Check the folder path and the account\'s permissions.'; }

    return message === '' ? 'The connection failed.' : message;
}

interface Session
{
    readonly client: Client;
    readonly sftp: SFTPWrapper;
    readonly hostKey: string;
}

async function connect ( target: SftpTarget, record: DeployRecord ): Promise<Session>
{
    const client: Client = new ssh2.Client();
    let seenKey = '';
    const config: ConnectConfig = {
        host: target.host,
        port: target.port,
        username: target.user,
        readyTimeout: CONNECT_TIMEOUT_MS,
        hostVerifier: ( key: Buffer ) =>
        {
            seenKey = fingerprintOf( key );

            return record.hostKey === undefined || record.hostKey === '' || record.hostKey === seenKey;
        },
    };

    if ( typeof record.keyFile === 'string' && record.keyFile !== '' )
    {
        config.privateKey = await readFile( record.keyFile );

        if ( typeof record.passphrase === 'string' && record.passphrase !== '' ) { config.passphrase = record.passphrase; }
    }
    else
    {
        config.password = record.password ?? '';
    }

    await new Promise<void>( ( resolve, reject ) =>
    {
        client.once( 'ready', resolve );
        client.once( 'error', ( error ) =>
        {
            if ( seenKey !== '' && record.hostKey !== undefined && record.hostKey !== '' && record.hostKey !== seenKey && /host/i.test( error.message ) )
            {
                reject( new Error( `The host key changed (${seenKey} instead of the trusted ${record.hostKey}). If the host was reinstalled, clear the trusted key under Go live and test again; otherwise stop and ask your host.` ) );
                return;
            }

            reject( error );
        } );
        client.connect( config );
    } );

    const sftp = await new Promise<SFTPWrapper>( ( resolve, reject ) =>
    {
        client.sftp( ( error, wrapper ) =>
        {
            if ( error ) { reject( error ); }
            else { resolve( wrapper ); }
        } );
    } );

    return { client, sftp, hostKey: seenKey };
}

function call<T> ( run: ( callback: ( error: Error | undefined | null, value: T ) => void ) => void ): Promise<T>
{
    return new Promise<T>( ( resolve, reject ) =>
    {
        run( ( error, value ) =>
        {
            if ( error ) { reject( error ); }
            else { resolve( value ); }
        } );
    } );
}

// Log in, look at the folder, say what is there. A first connection
// records the host's key as the trusted one.
export async function testConnection ( target: SftpTarget, record: DeployRecord ): Promise<TestOutcome>
{
    let session: Session | undefined;

    try
    {
        session = await connect( target, record );

        const list = await call<{ filename: string }[]>( ( callback ) => session?.sftp.readdir( target.path, callback ) );

        return { ok: true, entries: list.filter( ( entry ) => entry.filename !== '.' && entry.filename !== '..' ).length, hostKey: session.hostKey, trusted: record.hostKey === session.hostKey ? 'known' : 'new' };
    }
    catch ( error )
    {
        return { ok: false, error: deployProblem( error ) };
    }
    finally
    {
        session?.client.end();
    }
}

async function ensureDirectory ( sftp: SFTPWrapper, remote: string, made: Set<string> ): Promise<void>
{
    if ( remote === '' || remote === '/' || remote === '.' || made.has( remote ) ) { return; }

    await ensureDirectory( sftp, posix.dirname( remote ), made );

    try
    {
        await call<void>( ( callback ) => sftp.mkdir( remote, ( error ) => callback( error, undefined ) ) );
    }
    catch
    {
        // Exists already, or the host says no; the upload that follows
        // is the honest test of the second.
    }

    made.add( remote );
}

// Carry the changes over: files up, removals removed. Order: uploads
// first so a failure part-way leaves the site whole where it can.
export async function uploadChanges ( target: SftpTarget, record: DeployRecord, changes: readonly DeployChange[] ): Promise<{ uploaded: number; deleted: number; hostKey: string }>
{
    const session = await connect( target, record );
    const made = new Set<string>();
    let uploaded = 0;
    let deleted = 0;

    try
    {
        for ( const change of changes )
        {
            const remote = target.path === '/' ? `/${change.path}` : `${target.path}/${change.path}`;

            if ( change.local === null )
            {
                try
                {
                    await call<void>( ( callback ) => session.sftp.unlink( remote, ( error ) => callback( error, undefined ) ) );
                    deleted += 1;
                }
                catch
                {
                    // Already gone: the outcome is the same.
                }

                continue;
            }

            await ensureDirectory( session.sftp, posix.dirname( remote ), made );
            await call<void>( ( callback ) => session.sftp.fastPut( change.local as string, remote, ( error ) => callback( error, undefined ) ) );
            uploaded += 1;
        }
    }
    finally
    {
        session.client.end();
    }

    return { uploaded, deleted, hostKey: session.hostKey };
}

function splitZ ( text: string ): string[]
{
    return text.split( '\0' ).filter( ( part ) => part !== '' );
}

async function fileStamp ( file: string ): Promise<string | null>
{
    try
    {
        const info = await stat( file );

        return `${info.size}:${Math.floor( info.mtimeMs )}`;
    }
    catch
    {
        return null;
    }
}

// What has to move: the tracked half from the git diff between the
// deployed publish and HEAD (publish = commit, so the set is exact),
// the ignored half (media, when untracked) from a manifest of what was
// uploaded. No deployed publish on record, or one this clone no longer
// has, means everything under dist goes.
export async function deployChangeSet ( directory: string, record: DeployRecord ): Promise<{ changes: DeployChange[]; full: boolean; commit: string; manifest: Record<string, string> }>
{
    const head = ( await runGit( directory, [ 'rev-parse', 'HEAD' ] ) ).stdout.trim();
    const known = record.commit !== undefined && record.commit !== '' && ( await runGit( directory, [ 'cat-file', '-e', `${record.commit}^{commit}` ] ) ).code === 0;
    const changes: DeployChange[] = [];
    const seen = new Set<string>();
    const add = ( path: string, local: string | null ): void =>
    {
        if ( !path.startsWith( 'dist/' ) || seen.has( path ) ) { return; }

        seen.add( path );
        changes.push( { path: path.slice( 'dist/'.length ), local } );
    };

    if ( known && record.commit !== head )
    {
        const diff = await runGit( directory, [ 'diff', '--name-status', '-z', '-M', record.commit as string, head, '--', 'dist' ] );
        const parts = splitZ( diff.stdout );

        for ( let index = 0; index < parts.length; )
        {
            const status = parts[ index ] ?? '';

            if ( status.startsWith( 'R' ) || status.startsWith( 'C' ) )
            {
                const from = parts[ index + 1 ] ?? '';
                const to = parts[ index + 2 ] ?? '';

                if ( status.startsWith( 'R' ) ) { add( from, null ); }

                add( to, join( directory, to ) );
                index += 3;
                continue;
            }

            const path = parts[ index + 1 ] ?? '';

            add( path, status === 'D' ? null : join( directory, path ) );
            index += 2;
        }
    }
    else if ( !known )
    {
        const tree = await runGit( directory, [ 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', 'dist' ] );

        for ( const path of splitZ( tree.stdout ) ) { add( path, join( directory, path ) ); }
    }

    // The ignored half.
    const ignored = await runGit( directory, [ 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', 'dist' ] );
    const manifest: Record<string, string> = {};
    const previous = record.manifest ?? {};

    for ( const path of splitZ( ignored.stdout ) )
    {
        const stamp = await fileStamp( join( directory, path ) );

        if ( stamp === null ) { continue; }

        manifest[ path ] = stamp;

        if ( !known || previous[ path ] !== stamp ) { add( path, join( directory, path ) ); }
    }

    if ( known )
    {
        for ( const path of Object.keys( previous ) )
        {
            if ( manifest[ path ] === undefined ) { add( path, null ); }
        }
    }

    return { changes, full: !known, commit: head, manifest };
}

// The whole last mile for one publish: what changed, carried over,
// and remembered. Nothing here throws; the outcome says.
export async function runDeploy ( directory: string, siteKey: string, target: SftpTarget ): Promise<DeployOutcome>
{
    const record = await readDeployRecord( siteKey );

    if ( !hasCredential( record ) ) { return { ok: false, error: 'No password or key file is set for the host. Set one under Go live in Site settings.' }; }

    try
    {
        const set = await deployChangeSet( directory, record );
        const result = await uploadChanges( target, record, set.changes );

        await updateDeployRecord( siteKey, { commit: set.commit, manifest: set.manifest, at: new Date().toISOString(), ...( record.hostKey === undefined || record.hostKey === '' ? { hostKey: result.hostKey } : {} ) } );

        return { ok: true, uploaded: result.uploaded, deleted: result.deleted, full: set.full };
    }
    catch ( error )
    {
        return { ok: false, error: deployProblem( error ) };
    }
}
