// Signed keys (BUSINESS 5.3 and 5.5; DEVELOPMENT 5, licensing): the
// supporter key and the license key are Ed25519-signed tokens. The
// key IS the proof: caso ships the public key, so a key verifies
// offline, instantly, forever; nothing can be forged without the
// private key, which lives only on casomer.cloud (never in casomer.com,
// whose source is open). A license key carries the site's host, so a
// key cannot move to another site. casomer.cloud keeps the registry
// for what a signature cannot say: revocation, and which host a
// license is bound to today.
//
// Shape: CSMR.<payload>.<signature>, both base64url, the payload a
// JSON record { v, kind, id, host?, iat }.
//
// THE PUBLIC KEY BELOW IS THE PRODUCTION KEY (generated 2026-09-03;
// the private half is held offline with redundancy and becomes the
// cloud's SIGNING_KEY_PEM secret). Keys signed by any other pair,
// including the cloud's local development key, do not verify here:
// to test Studio against a local cloud, set CASOMER_TRUST_PEM to that
// cloud's public key for the session.

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const KEY_PREFIX = 'CSMR';

export const CASOMER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAgDkhXnVecguG/He1ykdvUrk3N7GDZ46mnGKqSiJyTY=
-----END PUBLIC KEY-----
`;

export type KeyKind = 'supporter' | 'license' | 'sponsor';

// The public key verification trusts: the shipped one, or, for test
// processes only, CASOMER_TRUST_PEM. Not a security boundary (the gate
// is a default, BUSINESS 5.3): someone who edits their environment
// could as easily edit their copy of caso.
export function trustedPublicKeyPem (): string
{
    const override = process.env.CASOMER_TRUST_PEM;

    return typeof override === 'string' && override.includes( 'BEGIN PUBLIC KEY' ) ? override : CASOMER_PUBLIC_KEY_PEM;
}

export interface KeyPayload
{
    readonly v: 1;
    readonly kind: KeyKind;
    readonly id: string;
    readonly host?: string;
    readonly iat: string;
}

export type KeyVerdict
    = | { readonly ok: true; readonly payload: KeyPayload }
        | { readonly ok: false; readonly reason: 'shape' | 'payload' | 'signature' | 'kind' | 'host' };

function base64url ( bytes: Buffer ): string
{
    return bytes.toString( 'base64url' );
}

function fromBase64url ( text: string ): Buffer | null
{
    if ( !/^[A-Za-z0-9_-]+$/.test( text ) ) { return null; }

    try
    {
        return Buffer.from( text, 'base64url' );
    }
    catch
    {
        return null;
    }
}

// A key as a person pastes it: an email client folds it across
// lines, a chat wraps it in quotes or backticks, an instruction's
// <key> leaves its angle brackets on. None of that is the key.
export function cleanKey ( text: string ): string
{
    return text.replace( /\s+/g, '' ).replace( /^[<"'`\[(]+/, '' ).replace( /[>"'`\])]+$/, '' );
}

// A host as keys and sites spell it: lower-case, no scheme, no
// leading www, no port when it is the default one.
export function canonicalHost ( value: string ): string
{
    let host = value.trim().toLowerCase();

    host = host.replace( /^[a-z][a-z0-9+.-]*:\/\//, '' ).replace( /\/.*$/, '' );
    host = host.replace( /^www\./, '' );
    host = host.replace( /:(80|443)$/, '' );

    return host;
}

// Issue a key. The private key never leaves casomer.cloud; this lives
// here so the format has one definition and one test.
export function issueKey ( payload: Omit<KeyPayload, 'v' | 'iat'> & { iat?: string }, privateKeyPem: string ): string
{
    const record: KeyPayload = {
        v: 1,
        kind: payload.kind,
        id: payload.id,
        ...( payload.host === undefined ? {} : { host: canonicalHost( payload.host ) } ),
        iat: payload.iat ?? new Date().toISOString(),
    };
    const body = Buffer.from( JSON.stringify( record ), 'utf8' );
    const signature = sign( null, body, createPrivateKey( privateKeyPem ) );

    return `${KEY_PREFIX}.${base64url( body )}.${base64url( signature )}`;
}

export function decodeKey ( key: string ): { payload: KeyPayload; body: Buffer; signature: Buffer } | null
{
    const parts = cleanKey( key ).split( '.' );

    if ( parts.length !== 3 || parts[ 0 ] !== KEY_PREFIX ) { return null; }

    const body = fromBase64url( parts[ 1 ] ?? '' );
    const signature = fromBase64url( parts[ 2 ] ?? '' );

    if ( body === null || signature === null || signature.length !== 64 ) { return null; }

    let payload: unknown;

    try
    {
        payload = JSON.parse( body.toString( 'utf8' ) );
    }
    catch
    {
        return null;
    }

    if ( payload === null || typeof payload !== 'object' ) { return null; }

    const record = payload as Record<string, unknown>;

    if ( record.v !== 1 || ( record.kind !== 'supporter' && record.kind !== 'license' && record.kind !== 'sponsor' ) || typeof record.id !== 'string' || typeof record.iat !== 'string' ) { return null; }
    if ( record.host !== undefined && typeof record.host !== 'string' ) { return null; }

    return { payload: record as unknown as KeyPayload, body, signature };
}

let cachedPublicKey: { pem: string; key: KeyObject } | undefined;

function publicKeyFor ( pem: string ): KeyObject
{
    if ( cachedPublicKey?.pem !== pem ) { cachedPublicKey = { pem, key: createPublicKey( pem ) }; }

    return cachedPublicKey.key;
}

// Verify a key offline: its shape, its signature under the shipped
// public key, the kind expected, and for a license the host it is
// bound to against the site's.
export function verifyKey ( key: string, expected: { kind: KeyKind; host?: string }, publicKeyPem = trustedPublicKeyPem() ): KeyVerdict
{
    const decoded = decodeKey( key );

    if ( decoded === null ) { return { ok: false, reason: 'shape' }; }

    let signed = false;

    try
    {
        signed = verify( null, decoded.body, publicKeyFor( publicKeyPem ), decoded.signature );
    }
    catch
    {
        signed = false;
    }

    if ( !signed ) { return { ok: false, reason: 'signature' }; }
    if ( decoded.payload.kind !== expected.kind ) { return { ok: false, reason: 'kind' }; }

    if ( expected.kind === 'license' )
    {
        if ( decoded.payload.host === undefined ) { return { ok: false, reason: 'payload' }; }
        if ( expected.host !== undefined && canonicalHost( expected.host ) !== canonicalHost( decoded.payload.host ) ) { return { ok: false, reason: 'host' }; }
    }

    return { ok: true, payload: decoded.payload };
}

// The person's words for a verdict, shared by Studio and the CLI.
export function keyProblem ( verdict: KeyVerdict, kind: KeyKind ): string
{
    if ( verdict.ok ) { return ''; }

    const noun = kind === 'license' ? 'license key' : ( kind === 'sponsor' ? 'sponsor key' : 'supporter key' );

    switch ( verdict.reason )
    {
        case 'shape': return `That is not a ${noun}. Paste the whole key from your email, starting with CSMR.`;
        case 'signature': return `That ${noun} did not check out. Paste it exactly as it arrived, or get in touch.`;
        case 'kind':
            if ( kind === 'license' ) { return 'That is a supporter key, not a license key.'; }
            if ( kind === 'sponsor' ) { return 'That key is a different kind, not a sponsor key.'; }

            return 'That is a license key, not a supporter key.';
        case 'host': return 'That license key belongs to a different site address.';
        default: return `That ${noun} could not be read.`;
    }
}
