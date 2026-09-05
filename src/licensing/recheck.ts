// Revocation reaches a computer at publish (Mikey, 2026-09-04; the
// re-check DEVELOPMENT 5 promised: opportunistic and throttled). A
// key verifies offline forever, so the registry is the only place a
// revocation can be learned: before the gate looks, each stored key
// that verifies is asked about, once a day at most per computer. A
// revoked answer clears the key from the user config and the person
// is told in the registry's words; a valid answer stamps the date;
// no answer is no news, and the publish goes on. Nothing here can
// refuse a publish on its own: the gate does that, after the key is
// gone.

import { verifyKey } from './keys.ts';
import { checkKeyOnline, onlineProblem, type OnlineVerdict } from './relay.ts';
import { readUserConfig, recordAt, updateUserConfig } from './userConfig.ts';

export const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

export type PersonKeyKind = 'supporter' | 'sponsor';

export interface KeyNotice
{
    readonly kind: 'license' | PersonKeyKind;
    readonly problem: string;
}

// One key's outcome: the notice when the key was cleared, and
// whether the registry answered at all (an unreachable registry ends
// the round, so an offline publish waits for one timeout, not three).
interface Recheck
{
    readonly notice: KeyNotice | null;
    readonly answered: boolean;
}

const NOTHING: Recheck = { notice: null, answered: true };
const NO_ANSWER: Recheck = { notice: null, answered: false };

function fresh ( at: unknown, now: number ): boolean
{
    return typeof at === 'string' && now - Date.parse( at ) < RECHECK_AFTER_MS;
}

// Only a revocation clears a key. Any other refusal (a registry that
// has forgotten a key it signed) is kept, as at entry the registry
// would have refused it; here the key stays and is asked about again
// next time.
function cleared ( verdict: OnlineVerdict ): boolean
{
    return !verdict.valid && verdict.revoked;
}

async function recheckLicense ( siteKey: string, now: number ): Promise<Recheck>
{
    const config = await readUserConfig();
    const key = recordAt( config, 'licenses' )[ siteKey ];

    if ( typeof key !== 'string' || !verifyKey( key, { kind: 'license', host: siteKey } ).ok ) { return NOTHING; }
    if ( fresh( recordAt( config, 'licensesVerifiedAt' )[ siteKey ], now ) ) { return NOTHING; }

    const verdict = await checkKeyOnline( key, siteKey );

    if ( verdict === null ) { return NO_ANSWER; }

    if ( verdict.valid )
    {
        await updateUserConfig( ( current ) =>
        {
            const verified = recordAt( current, 'licensesVerifiedAt' );

            verified[ siteKey ] = new Date( now ).toISOString();
            current.licensesVerifiedAt = verified;
        } );

        return NOTHING;
    }

    if ( !cleared( verdict ) ) { return NOTHING; }

    await updateUserConfig( ( current ) =>
    {
        const licenses = recordAt( current, 'licenses' );
        const verified = recordAt( current, 'licensesVerifiedAt' );

        delete licenses[ siteKey ];
        delete verified[ siteKey ];
        current.licenses = licenses;
        current.licensesVerifiedAt = verified;
    } );

    return { notice: { kind: 'license', problem: onlineProblem( verdict, 'license' ) }, answered: true };
}

// The supporter and sponsor keys: one per person, stored as
// supporterConfirm / sponsorConfirm with a verifiedAt stamp beside
// each. A valid supporter answer also records whether a subscription
// stands behind the key (supporterSubscription), which is what the
// menu's Manage subscription row reads.
async function recheckPerson ( kind: PersonKeyKind, now: number ): Promise<Recheck>
{
    const confirmField = kind === 'sponsor' ? 'sponsorConfirm' : 'supporterConfirm';
    const stampField = kind === 'sponsor' ? 'sponsorVerifiedAt' : 'supporterVerifiedAt';
    const config = await readUserConfig();
    const key = config[ confirmField ];

    if ( typeof key !== 'string' || !verifyKey( key, { kind } ).ok ) { return NOTHING; }
    if ( fresh( config[ stampField ], now ) ) { return NOTHING; }

    const verdict = await checkKeyOnline( key );

    if ( verdict === null ) { return NO_ANSWER; }

    if ( verdict.valid )
    {
        await updateUserConfig( ( current ) =>
        {
            current[ stampField ] = new Date( now ).toISOString();

            if ( kind === 'supporter' ) { current.supporterSubscription = verdict.subscription === true; }
        } );

        return NOTHING;
    }

    if ( !cleared( verdict ) ) { return NOTHING; }

    await updateUserConfig( ( current ) =>
    {
        delete current[ confirmField ];
        delete current[ stampField ];

        if ( kind === 'supporter' ) { delete current.supporterSubscription; }
    } );

    return { notice: { kind, problem: onlineProblem( verdict, kind ) }, answered: true };
}

export async function recheckLicenseKey ( siteKey: string, now = Date.now() ): Promise<KeyNotice | null>
{
    return ( await recheckLicense( siteKey, now ) ).notice;
}

export async function recheckPersonKey ( kind: PersonKeyKind, now = Date.now() ): Promise<KeyNotice | null>
{
    return ( await recheckPerson( kind, now ) ).notice;
}

// The round both publish paths run: the site's license first, then
// the person's keys, stopping at the first key the registry could
// not be asked about. The notices are for the person to read, in
// the order the keys were cleared.
export async function recheckKeysAtPublish ( siteKey: string, now = Date.now() ): Promise<KeyNotice[]>
{
    const notices: KeyNotice[] = [];
    const rounds: ( () => Promise<Recheck> )[] = [
        () => recheckLicense( siteKey, now ),
        () => recheckPerson( 'supporter', now ),
        () => recheckPerson( 'sponsor', now ),
    ];

    for ( const round of rounds )
    {
        const outcome = await round();

        if ( outcome.notice !== null ) { notices.push( outcome.notice ); }
        if ( !outcome.answered ) { break; }
    }

    return notices;
}
