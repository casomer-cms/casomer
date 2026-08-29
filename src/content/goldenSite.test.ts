import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { loadSiteDirectory } from './loadSiteDirectory.ts';
import { serializeCanonicalJson, parseJsonDocument, type JsonValue } from './canonicalJson.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const packageDirectory = join( fixtureRoot, 'fixture-kit' );
const contentDirectory = join( fixtureRoot, 'content' );

describe( 'the golden fixture site', () =>
{
    it( 'loads the fixture package with zero issues', async () =>
    {
        const result = await loadPackageFromDirectory( packageDirectory );

        assert.deepEqual( result.issues, [] );
        assert.deepEqual( [ ...( result.loadedPackage?.components.keys() ?? [] ) ], [ 'card', 'note' ] );
        assert.equal( result.loadedPackage?.components.get( 'card' )?.manifest.anchors[ 1 ]?.label, 'Title' );
    } );

    it( 'validates the fixture site end to end with zero issues', async () =>
    {
        const { loadedPackage } = await loadPackageFromDirectory( packageDirectory );
        const result = await loadSiteDirectory( contentDirectory, loadedPackage === undefined ? [] : [ loadedPackage ] );

        assert.deepEqual( result.issues, [] );
        assert.equal( result.pageCount, 2 );
        assert.equal( result.config.theme.rhythm, 'lg' );
    } );

    // The empty-diff invariant of SCHEMA appendix B, checked against the
    // actual bytes on disk: every fixture document is byte-identical to
    // its own canonical re-serialization.
    it( 'keeps every fixture document in canonical form', async () =>
    {
        const documents = [
            join( contentDirectory, 'site.json' ),
            join( contentDirectory, 'pages.json' ),
            join( packageDirectory, 'casomer.json' ),
            join( packageDirectory, 'components', 'card', 'casomer.json' ),
            join( packageDirectory, 'components', 'note', 'casomer.json' ),
        ];

        for ( const file of documents )
        {
            const text = await readFile( file, 'utf8' );

            assert.equal( serializeCanonicalJson( parseJsonDocument( text ) ), text, `${file} is not canonical` );
        }
    } );

    it( 'reports broken variants: non-canonical files, ghost components, unknown tokens', async () =>
    {
        const brokenDirectory = await mkdtemp( join( tmpdir(), 'casomer-broken-' ) );

        await cp( contentDirectory, brokenDirectory, { recursive: true } );

        // Collapse site.json to one line: valid JSON, not canonical form.
        const siteText = await readFile( join( brokenDirectory, 'site.json' ), 'utf8' );

        await writeFile( join( brokenDirectory, 'site.json' ), JSON.stringify( JSON.parse( siteText ) ), 'utf8' );

        // Reference a component that does not exist, with a spacing token
        // outside the theme, in canonical form so only real issues fire.
        const pages = parseJsonDocument( await readFile( join( brokenDirectory, 'pages.json' ), 'utf8' ) ) as JsonValue[];
        const home = pages[ 0 ] as { blocks: JsonValue[] };

        home.blocks[ 0 ] = { component: 'fixture-kit/ghost', props: {} };
        home.blocks[ 1 ] = { section: { gap: 'xl' }, blocks: [] };
        await writeFile( join( brokenDirectory, 'pages.json' ), serializeCanonicalJson( pages ), 'utf8' );

        const { loadedPackage } = await loadPackageFromDirectory( packageDirectory );
        const result = await loadSiteDirectory( brokenDirectory, loadedPackage === undefined ? [] : [ loadedPackage ] );
        const messages = result.issues.map( ( issue ) => issue.message ).join( '\n' );

        assert.ok( messages.includes( 'canonical form' ) );
        assert.ok( messages.includes( 'no component "ghost"' ) );
        assert.ok( messages.includes( '"xl" is not a spacing token' ) );
    } );

    it( 'rejects references to core components that do not exist', async () =>
    {
        const brokenDirectory = await mkdtemp( join( tmpdir(), 'casomer-core-' ) );

        await cp( contentDirectory, brokenDirectory, { recursive: true } );

        const pages = parseJsonDocument( await readFile( join( brokenDirectory, 'pages.json' ), 'utf8' ) ) as JsonValue[];
        const home = pages[ 0 ] as { blocks: JsonValue[] };

        home.blocks = [ { component: 'core/section', props: {} } ];
        await writeFile( join( brokenDirectory, 'pages.json' ), serializeCanonicalJson( pages ), 'utf8' );

        const result = await loadSiteDirectory( brokenDirectory, [] );

        assert.ok( result.issues.some( ( issue ) => issue.message.includes( 'Core is deliberately small' ) ) );
    } );

    it( 'has no stray files in the fixture content directory', async () =>
    {
        assert.deepEqual( ( await readdir( contentDirectory ) ).sort(), [ 'pages.json', 'site.json' ] );
    } );
} );
