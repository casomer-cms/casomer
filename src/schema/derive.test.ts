import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveJsonSchema, derivePropsInterface, deriveDocsStub } from './derive.ts';
import { normalizeComponentManifest } from './manifest.ts';
import { serializeCanonicalJson } from '../content/canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

const loadCardManifest = async (): Promise<ReturnType<typeof normalizeComponentManifest>> =>
{
    const file = join( fixtureRoot, 'fixture-kit', 'components', 'card', 'casomer.json' );

    return normalizeComponentManifest( JSON.parse( await readFile( file, 'utf8' ) ) );
};

describe( 'deriveJsonSchema', () =>
{
    it( 'derives a serializable draft 2020-12 schema from the card manifest', async () =>
    {
        const schema = deriveJsonSchema( await loadCardManifest() ) as Record<string, unknown>;

        assert.equal( schema.$schema, 'https://json-schema.org/draft/2020-12/schema' );
        assert.equal( schema.title, 'Card' );
        assert.doesNotThrow( () => serializeCanonicalJson( schema as never ) );
    } );

    it( 'maps types, enums, rules, and image alt requirements', async () =>
    {
        const schema = deriveJsonSchema( await loadCardManifest() ) as {
            properties: Record<string, Record<string, unknown>>;
            required: string[];
        };

        assert.deepEqual( schema.properties.title, { title: 'Title', type: 'string', maxLength: 80 } );
        assert.deepEqual( schema.properties.layout?.enum, [ 'stacked', 'overlay' ] );
        assert.equal( schema.properties.width?.enum, undefined );
        assert.deepEqual( schema.properties.photo?.required, [ 'src', 'alt' ] );
        assert.deepEqual( schema.properties.divider?.required, [ 'src' ] );
        assert.equal( schema.properties.faqs?.minItems, 1 );
    } );

    it( 'keeps conditional fields out of required and documents are lenient', async () =>
    {
        const schema = deriveJsonSchema( await loadCardManifest() ) as {
            required: string[];
            additionalProperties: boolean;
            properties: Record<string, Record<string, unknown>>;
        };

        assert.deepEqual( schema.required, [ 'title', 'photo' ] );
        assert.equal( schema.additionalProperties, true );
        assert.ok( String( schema.properties.scrim?.description ).includes( 'shown when: layout == "overlay"' ) );
    } );
} );

describe( 'derivePropsInterface', () =>
{
    it( 'derives a house-style props interface with unions and nested lists', async () =>
    {
        const source = derivePropsInterface( await loadCardManifest() );

        assert.ok( source.includes( 'export interface CardProps\n{' ) );
        assert.ok( source.includes( 'layout?: \'stacked\' | \'overlay\';' ) );
        assert.ok( source.includes( 'title: string;' ) );
        assert.ok( source.includes( 'scrim?: boolean;' ) );
        assert.ok( source.includes( 'photo: { src: string; alt: string; width?: number; height?: number };' ) );
        assert.ok( source.includes( 'divider?: { src: string; alt?: string; width?: number; height?: number };' ) );
        assert.ok( source.includes( 'faqs?: {\n        question: string;\n        answer: string;\n    }[];' ) );
        assert.ok( source.includes( 'Do not edit' ) );
    } );

    it( 'pascal-cases hyphenated component ids', async () =>
    {
        const manifest = normalizeComponentManifest( {
            id: 'card-grid',
            title: 'Card Grid',
            template: './template.html',
            fields: {},
        } );

        assert.ok( derivePropsInterface( manifest ).includes( 'export interface CardGridProps' ) );
    } );
} );

describe( 'deriveDocsStub', () =>
{
    it( 'derives a fields table and anchors table', async () =>
    {
        const stub = deriveDocsStub( await loadCardManifest() );

        assert.ok( stub.startsWith( '# Card\n' ) );
        assert.ok( stub.includes( '| Field | Type | Required | Notes |' ) );
        assert.ok( stub.includes( '| `title` | text | yes | max: 80 |' ) );
        assert.ok( stub.includes( '| `scrim` | toggle | no | (shown when: layout == "overlay") |' ) );
        assert.ok( stub.includes( '| `photo` (Photo) | image |' ) );
        assert.ok( stub.endsWith( '\n' ) );
    } );
} );
