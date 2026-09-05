// Signed keys: a key issued with a private key verifies under its
// public key, a license key is bound to its host, a supporter key is
// not, and anything tampered, mis-shaped, or of the other kind is
// refused with a reason a person can act on.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { CASOMER_PUBLIC_KEY_PEM, canonicalHost, cleanKey, decodeKey, issueKey, keyProblem, verifyKey } from './keys.ts';

const pair = generateKeyPairSync( 'ed25519' );
const privatePem = pair.privateKey.export( { type: 'pkcs8', format: 'pem' } ) as string;
const publicPem = pair.publicKey.export( { type: 'spki', format: 'pem' } ) as string;
const other = generateKeyPairSync( 'ed25519' ).publicKey.export( { type: 'spki', format: 'pem' } ) as string;

describe( 'signed keys', () =>
{
    it( 'ships a public key that parses', () =>
    {
        assert.equal( createPublicKey( CASOMER_PUBLIC_KEY_PEM ).asymmetricKeyType, 'ed25519' );
    } );

    it( 'spells hosts one way', () =>
    {
        assert.equal( canonicalHost( 'https://WWW.Sunrise-Bakery.com/' ), 'sunrise-bakery.com' );
        assert.equal( canonicalHost( 'sunrise-bakery.com:443' ), 'sunrise-bakery.com' );
        assert.equal( canonicalHost( 'example.com:8080' ), 'example.com:8080' );
    } );

    it( 'issues and verifies a supporter key', () =>
    {
        const key = issueKey( { kind: 'supporter', id: 'sup_1' }, privatePem );

        assert.match( key, /^CSMR\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ );

        const verdict = verifyKey( key, { kind: 'supporter' }, publicPem );

        assert.equal( verdict.ok, true );
        assert.equal( verdict.ok && verdict.payload.id, 'sup_1' );
        assert.equal( decodeKey( key )?.payload.kind, 'supporter' );
    } );

    it( 'binds a license key to its host', () =>
    {
        const key = issueKey( { kind: 'license', id: 'lic_1', host: 'https://www.Sunrise-Bakery.com' }, privatePem );

        assert.equal( verifyKey( key, { kind: 'license', host: 'sunrise-bakery.com' }, publicPem ).ok, true );
        assert.equal( verifyKey( key, { kind: 'license', host: 'WWW.sunrise-bakery.com' }, publicPem ).ok, true );

        const elsewhere = verifyKey( key, { kind: 'license', host: 'other.example' }, publicPem );

        assert.equal( elsewhere.ok, false );
        assert.equal( !elsewhere.ok && elsewhere.reason, 'host' );
        assert.match( keyProblem( elsewhere, 'license' ), /different site address/ );
    } );

    it( 'refuses the wrong kind, a tampered key, another signer, and noise', () =>
    {
        const supporter = issueKey( { kind: 'supporter', id: 'sup_2' }, privatePem );
        const license = issueKey( { kind: 'license', id: 'lic_2', host: 'example.com' }, privatePem );

        const wrongKind = verifyKey( supporter, { kind: 'license', host: 'example.com' }, publicPem );

        assert.equal( !wrongKind.ok && wrongKind.reason, 'kind' );
        assert.match( keyProblem( wrongKind, 'license' ), /supporter key, not a license key/ );

        const [ prefix, body, signature ] = license.split( '.' );
        const tampered = `${prefix}.${Buffer.from( JSON.stringify( { v: 1, kind: 'license', id: 'lic_2', host: 'evil.example', iat: '2026-01-01' } ) ).toString( 'base64url' )}.${signature}`;

        assert.equal( verifyKey( tampered, { kind: 'license', host: 'evil.example' }, publicPem ).ok, false );
        assert.equal( verifyKey( `${prefix}.${body}.${signature}`, { kind: 'license', host: 'example.com' }, other ).ok, false );

        const noise = verifyKey( 'CSMR-LICENSE-1', { kind: 'license', host: 'example.com' }, publicPem );

        assert.equal( !noise.ok && noise.reason, 'shape' );
        assert.match( keyProblem( noise, 'license' ), /starting with CSMR/ );
        assert.equal( verifyKey( '', { kind: 'supporter' }, publicPem ).ok, false );
    } );
} );

describe( 'a pasted key', () =>
{
    it( 'is cleaned of folded lines, quotes, and the angle brackets of <key>', () =>
    {
        assert.equal( cleanKey( '  CSMR.abc.def\n' ), 'CSMR.abc.def' );
        assert.equal( cleanKey( 'CSMR.abc\r\n  .def' ), 'CSMR.abc.def' );
        assert.equal( cleanKey( '<CSMR.abc.def>' ), 'CSMR.abc.def' );
        assert.equal( cleanKey( '"CSMR.abc.def"' ), 'CSMR.abc.def' );
        assert.equal( cleanKey( '`CSMR.abc.def`' ), 'CSMR.abc.def' );
    } );

    it( 'verifies through decodeKey whatever wrapped it', () =>
    {
        const key = issueKey( { kind: 'supporter', id: 'sup_pasted' }, privatePem );
        const folded = key.slice( 0, 40 ) + '\n' + key.slice( 40 );

        assert.equal( verifyKey( '<' + folded + '>', { kind: 'supporter' }, publicPem ).ok, true );
    } );
} );
