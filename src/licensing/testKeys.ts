// Test support: a throwaway signing pair, trusted for the life of the
// test process through CASOMER_TRUST_PEM, so tests can issue keys
// that verify without the real private key existing anywhere near
// the repository. Importing this module installs the trust.

import { generateKeyPairSync } from 'node:crypto';

import { issueKey, type KeyKind } from './keys.ts';

const pair = generateKeyPairSync( 'ed25519' );
const privatePem = pair.privateKey.export( { type: 'pkcs8', format: 'pem' } ) as string;

export const testPublicKeyPem = pair.publicKey.export( { type: 'spki', format: 'pem' } ) as string;

process.env.CASOMER_TRUST_PEM = testPublicKeyPem;

// Tests never reach casomer.com: the relay points at a closed port,
// so every online check fails fast and counts as no answer.
process.env.CASOMER_RELAY_ORIGIN = process.env.CASOMER_RELAY_ORIGIN ?? 'http://127.0.0.1:1';

export function issueTestKey ( kind: KeyKind, host?: string, id = `${kind}_${Math.random().toString( 36 ).slice( 2, 8 )}` ): string
{
    return issueKey( { kind, id, ...( host === undefined ? {} : { host } ) }, privatePem );
}
