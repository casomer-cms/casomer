// The online half of key verification (BUSINESS 5.3, DEVELOPMENT 5):
// the signature is checked offline (keys.ts); casomer.com relays the
// rest - revocation, activation, the supporter wall - to Casomer
// Cloud. Every call here is opportunistic: a short timeout, and
// unreachable means "no news", never a refusal. A licensed site can
// never fail to publish because a server was down.

export const RELAY_ORIGIN = 'https://casomer.com';

const TIMEOUT_MS = 4000;

export type RelayResult<T>
    = | { readonly ok: true; readonly status: number; readonly body: T }
        | { readonly ok: false; readonly unreachable: boolean; readonly status: number };

function relayOrigin (): string
{
    const override = process.env.CASOMER_RELAY_ORIGIN;

    return typeof override === 'string' && override !== '' ? override.replace( /\/+$/, '' ) : RELAY_ORIGIN;
}

export async function relay<T> ( path: string, body?: unknown, method: 'GET' | 'POST' | 'DELETE' = body === undefined ? 'GET' : 'POST' ): Promise<RelayResult<T>>
{
    const controller = new AbortController();
    const timer = setTimeout( () => controller.abort(), TIMEOUT_MS );

    try
    {
        const response = await fetch( `${relayOrigin()}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'user-agent': 'caso' },
            ...( body === undefined ? {} : { body: JSON.stringify( body ) } ),
            signal: controller.signal,
        } );
        const parsed = await response.json().catch( () => ( {} ) ) as T;

        // A 5xx is the relay or the cloud being down (Cloudflare's own
        // 52x/53x included), not an answer about the key: no news.
        if ( response.status >= 500 ) { return { ok: false, unreachable: true, status: response.status }; }

        return response.ok ? { ok: true, status: response.status, body: parsed } : { ok: false, unreachable: false, status: response.status };
    }
    catch
    {
        return { ok: false, unreachable: true, status: 0 };
    }
    finally
    {
        clearTimeout( timer );
    }
}

export interface OnlineVerdict
{
    readonly valid: boolean;
    readonly revoked: boolean;
    readonly reason?: string;

    // A supporter key with a monthly subscription behind it: the
    // menu's Manage subscription row reads this.
    readonly subscription?: boolean;
}

// Ask the registry about a key that already verified offline. null
// means the registry could not be asked; the caller carries on.
export async function checkKeyOnline ( key: string, host?: string ): Promise<OnlineVerdict | null>
{
    const result = await relay<{ valid?: unknown; revoked?: unknown; reason?: unknown; subscription?: unknown }>( '/api/keys/verify', { key, ...( host === undefined ? {} : { host } ) } );

    if ( !result.ok ) { return null; }

    return {
        valid: result.body.valid === true,
        revoked: result.body.revoked === true,
        ...( typeof result.body.reason === 'string' ? { reason: result.body.reason } : {} ),
        ...( typeof result.body.subscription === 'boolean' ? { subscription: result.body.subscription } : {} ),
    };
}

export async function activateLicenseOnline ( key: string, host: string ): Promise<boolean | null>
{
    const result = await relay<{ activated?: unknown }>( '/api/licenses/activate', { key, host } );

    return result.ok ? result.body.activated === true : null;
}

export interface WallEntry
{
    readonly key: string;
    readonly name: string;
    readonly github: string;
    readonly avatar?: { readonly type: string; readonly data: string };
}

// Send the supporter wall entry. true sent, false refused, null no
// answer (the caller keeps it pending and tries again later).
export async function sendWallEntry ( entry: WallEntry ): Promise<boolean | null>
{
    const result = await relay<{ saved?: unknown }>( '/api/supporters/wall', entry );

    if ( !result.ok ) { return result.unreachable ? null : false; }

    return result.body.saved === true;
}

// Take the entry down (Mikey, 2026-09-05: leaving the wall is a
// toggle in Studio, not an email). true removed, false the registry
// had no entry or refused the key, null no answer.
export async function removeWallEntry ( key: string ): Promise<boolean | null>
{
    const result = await relay<{ removed?: unknown }>( '/api/supporters/wall', { key }, 'DELETE' );

    if ( !result.ok ) { return result.unreachable ? null : false; }

    return result.body.removed === true;
}

// Stripe's customer portal for a monthly supporter's key (Mikey,
// 2026-09-04): the URL to open, or null when the relay cannot be
// reached or no subscription stands behind the key.
export async function billingPortalOnline ( key: string ): Promise<string | null>
{
    const result = await relay<{ url?: unknown }>( '/api/billing/portal', { key } );

    return result.ok && typeof result.body.url === 'string' ? result.body.url : null;
}

// The words a person sees when the registry says no.
export function onlineProblem ( verdict: OnlineVerdict, kind: 'supporter' | 'license' | 'sponsor' ): string
{
    const noun = kind === 'license' ? 'license key' : ( kind === 'sponsor' ? 'sponsor key' : 'supporter key' );

    if ( verdict.revoked ) { return `That ${noun} has been revoked. If that is a surprise, write to support@casomer.com.`; }
    if ( verdict.reason === 'unknown' ) { return `casomer.com does not know that ${noun}. Paste it exactly as it arrived, or get in touch.`; }
    if ( verdict.reason === 'host' ) { return 'That license key belongs to a different site address.'; }

    return `That ${noun} did not check out with casomer.com.`;
}
