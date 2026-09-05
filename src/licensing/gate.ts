// The licensing mechanics of BUSINESS 5.3 and 5.5, shared by the Studio
// server and the CLI so both publish paths behave the same:
//
// - The GRACE GATE for commercial-declared sites: the first publish
//   opens a 14 day window (a countdown that informs, never blocks),
//   past which publishing needs the site's license key. The clock's
//   anchor is per site key (the origin's host, else the folder) with
//   two witnesses, earliest wins: the first publish commit whose
//   committed site.json declared commercial, and a quiet record in
//   the user config made at that publish. Nothing is recorded for
//   personal sites. Build and preview never come here.
//
// - The SUPPORTER MOMENT for personal sites: after the fifth
//   successful publish one gentle line offers support, and once more
//   far down the line (the fortieth), each once ever per person;
//   never to a supporter, never to a Cloud user, never on a
//   commercial site.
//
// Keys are signed tokens (keys.ts) verified offline under the public
// key shipped in caso: a key counts here only when it verifies, and a
// license key only for the host it names.

import { runGit } from '../git/repository.ts';
import { cleanKey, keyProblem, verifyKey } from './keys.ts';
import { readUserConfig, recordAt, updateUserConfig } from './userConfig.ts';

export const GRACE_DAYS = 14;
export const SUPPORTER_MOMENTS: readonly number[] = [ 5, 40 ];

const DAY = 24 * 60 * 60 * 1000;
const PUBLISH_GREP = '^casomer: publish';

export type DeclaredUse = 'personal' | 'commercial';
export type LicensePhase = 'personal' | 'unstarted' | 'grace' | 'expired' | 'licensed';

export interface LicenseState
{
    readonly declaredUse: DeclaredUse;
    readonly siteKey: string;
    readonly phase: LicensePhase;
    readonly anchor: string | null;
    readonly daysLeft: number;
    readonly hasKey: boolean;
}

// The site's identity for licensing: the origin's host when it has
// one, else its folder. A commercial site is expected to carry an
// origin (SCHEMA 12.3); the folder keeps the clock honest until then.
// Where a license is bought, with the site filled in: the page reads
// ?site=<host> into its address field, the site's domain as the key
// will name it, so the key is bound to the address the site declares
// rather than one typed from memory. A site without an address gets
// the bare page.
export function licensePageUrl ( origin: string | undefined ): string
{
    const page = 'https://casomer.com/license';

    if ( origin === undefined || origin === '' ) { return page; }

    try
    {
        return `${page}?site=${encodeURIComponent( new URL( origin ).host.toLowerCase() )}`;
    }
    catch
    {
        return page;
    }
}

export function siteKeyFor ( origin: string | undefined, directory: string ): string
{
    if ( origin !== undefined && origin !== '' )
    {
        try
        {
            return new URL( origin ).host.toLowerCase();
        }
        catch
        {
            /* not an address after all: the folder stands in */
        }
    }

    return `folder:${directory.replace( /[\\/]+$/, '' ).replace( /\\/g, '/' ).toLowerCase()}`;
}

// Publishes so far: the publish commits in the site's history.
export async function publishCount ( directory: string ): Promise<number>
{
    const result = await runGit( directory, [ 'rev-list', '--count', 'HEAD', `--grep=${PUBLISH_GREP}` ] );
    const count = Number( result.stdout.trim() );

    return result.code === 0 && Number.isFinite( count ) ? count : 0;
}

// Witness one: the commit date of the first publish whose committed
// site.json declared commercial, or null when none has.
export async function firstCommercialPublish ( directory: string ): Promise<string | null>
{
    const log = await runGit( directory, [ 'log', '--reverse', `--grep=${PUBLISH_GREP}`, '--pretty=%H %cI' ] );

    if ( log.code !== 0 ) { return null; }

    for ( const line of log.stdout.split( '\n' ) )
    {
        const [ sha, at ] = line.trim().split( ' ' );

        if ( sha === undefined || at === undefined ) { continue; }

        const shown = await runGit( directory, [ 'show', `${sha}:site.json` ] );

        if ( shown.code !== 0 ) { continue; }

        try
        {
            const site = JSON.parse( shown.stdout ) as { use?: unknown } | null;

            if ( site !== null && site.use === 'commercial' ) { return at; }
        }
        catch
        {
            /* an unreadable site.json at that commit is no witness */
        }
    }

    return null;
}

// Witness two: recorded quietly at the first commercial publish, so
// replacing the repository does not reset the clock on this machine.
export async function recordGraceStart ( siteKey: string, at: string ): Promise<void>
{
    await updateUserConfig( ( config ) =>
    {
        const grace = recordAt( config, 'grace' );

        if ( typeof grace[ siteKey ] !== 'string' ) { grace[ siteKey ] = at; }

        config.grace = grace;
    } );
}

export async function storeLicenseKey ( siteKey: string, key: string ): Promise<void>
{
    await updateUserConfig( ( config ) =>
    {
        const licenses = recordAt( config, 'licenses' );

        licenses[ siteKey ] = cleanKey( key );
        config.licenses = licenses;
    } );
}

export function looksLikeLicenseKey ( key: unknown ): key is string
{
    return typeof key === 'string' && key.trim() !== '';
}

// A supporter key counts when it verifies as one (keys.ts).
export function supporterKeyOk ( key: unknown ): boolean
{
    return typeof key === 'string' && verifyKey( key, { kind: 'supporter' } ).ok;
}

// A sponsor key the same way (Mikey, 2026-09-03: the commercial
// sibling of the supporter mechanic - the key arrives once the
// sponsorship conversation lands, never through a checkout).
export function sponsorKeyOk ( key: unknown ): boolean
{
    return typeof key === 'string' && verifyKey( key, { kind: 'sponsor' } ).ok;
}

// A license key counts for a site when it verifies and names the
// site's host. A site keyed by its folder has no host to bind to:
// the address comes first.
export function licenseKeyVerdict ( key: unknown, siteKey: string ): { ok: boolean; problem: string }
{
    if ( !looksLikeLicenseKey( key ) ) { return { ok: false, problem: 'A license key is needed.' }; }
    if ( siteKey.startsWith( 'folder:' ) ) { return { ok: false, problem: 'Set the site address first (the All pages sidebar or Site settings): a license binds to it.' }; }

    const verdict = verifyKey( key, { kind: 'license', host: siteKey } );

    return verdict.ok ? { ok: true, problem: '' } : { ok: false, problem: keyProblem( verdict, 'license' ) };
}

export interface LicenseQuery
{
    readonly directory: string;
    readonly declaredUse: DeclaredUse;
    readonly origin?: string;
    readonly now?: Date;
}

export async function licenseState ( query: LicenseQuery ): Promise<LicenseState>
{
    const siteKey = siteKeyFor( query.origin, query.directory );

    if ( query.declaredUse !== 'commercial' )
    {
        return { declaredUse: 'personal', siteKey, phase: 'personal', anchor: null, daysLeft: GRACE_DAYS, hasKey: false };
    }

    const config = await readUserConfig();
    const hasKey = licenseKeyVerdict( recordAt( config, 'licenses' )[ siteKey ], siteKey ).ok;
    const witnesses = [ await firstCommercialPublish( query.directory ), recordAt( config, 'grace' )[ siteKey ] ]
        .filter( ( value ): value is string => typeof value === 'string' && !Number.isNaN( Date.parse( value ) ) )
        .sort( ( a, b ) => Date.parse( a ) - Date.parse( b ) );
    const anchor = witnesses[ 0 ] ?? null;

    if ( hasKey ) { return { declaredUse: 'commercial', siteKey, phase: 'licensed', anchor, daysLeft: 0, hasKey: true }; }
    if ( anchor === null ) { return { declaredUse: 'commercial', siteKey, phase: 'unstarted', anchor, daysLeft: GRACE_DAYS, hasKey: false }; }

    const elapsed = ( query.now ?? new Date() ).getTime() - Date.parse( anchor );
    const daysLeft = Math.max( 0, GRACE_DAYS - Math.floor( elapsed / DAY ) );

    return { declaredUse: 'commercial', siteKey, phase: daysLeft > 0 ? 'grace' : 'expired', anchor, daysLeft, hasKey: false };
}

// The moment due at this publish count: the largest threshold reached
// that this person has not been shown, or null.
export function supporterMomentDue ( count: number, shown: readonly number[] ): number | null
{
    const due = SUPPORTER_MOMENTS.filter( ( threshold ) => count >= threshold && !shown.includes( threshold ) );

    return due.length === 0 ? null : Math.max( ...due );
}

// Claim the moment for this publish: records it as shown so it never
// returns, and stays silent for supporters (and Cloud users, once
// that state exists).
export async function claimSupporterMoment ( count: number ): Promise<number | null>
{
    const config = await readUserConfig();

    if ( supporterKeyOk( config.supporterConfirm ) ) { return null; }
    if ( config.cloud === true ) { return null; }

    const shown = Array.isArray( config.supporterMoments ) ? config.supporterMoments.filter( ( value ): value is number => typeof value === 'number' ) : [];
    const due = supporterMomentDue( count, shown );

    if ( due === null ) { return null; }

    await updateUserConfig( ( current ) =>
    {
        const already = Array.isArray( current.supporterMoments ) ? current.supporterMoments.filter( ( value ): value is number => typeof value === 'number' ) : [];

        current.supporterMoments = [ ...new Set( [ ...already, due ] ) ].sort( ( a, b ) => a - b );
    } );

    return due;
}
