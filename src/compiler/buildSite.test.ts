import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from './buildSite.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );
const expectedRoot = join( fixtureRoot, 'expected' );
const updateSnapshots = process.env.CASOMER_UPDATE_SNAPSHOTS === '1';

async function htmlFilesUnder ( root: string ): Promise<string[]>
{
    const entries = await readdir( root, { recursive: true, withFileTypes: true } );

    return entries
        .filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.html' ) )
        .map( ( entry ) => relative( root, join( entry.parentPath, entry.name ) ).split( sep ).join( '/' ) )
        .sort();
}

// Assets ship under content-hashed names; tests discover them by shape.
async function hashedAsset ( directory: string, shape: RegExp ): Promise<string>
{
    const name = ( await readdir( directory ) ).find( ( entry ) => shape.test( entry ) );

    assert.ok( name !== undefined, `no file in ${directory} matches ${shape}` );
    return join( directory, name );
}

describe( 'buildSite on the golden fixture', () =>
{
    it( 'builds dist/ matching the committed snapshots, with real CSS', async () =>
    {
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-build-' ) );
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
        const result = await buildSite( {
            contentDirectory: join( fixtureRoot, 'content' ),
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            generatorVersion: '0.0.2',
        } );

        assert.deepEqual( result.issues, [] );
        assert.deepEqual( [ ...result.pagesWritten ].sort(), [
            'about/index.html',
            'events/harvest-loaf-tasting/index.html',
            'events/index.html',
            'events/latte-art-night/index.html',
            'index.html',
        ].sort() );

        const built = await htmlFilesUnder( outputDirectory );

        if ( updateSnapshots )
        {
            for ( const file of built )
            {
                const target = join( expectedRoot, file );

                await mkdir( join( target, '..' ), { recursive: true } );
                await writeFile( target, await readFile( join( outputDirectory, file ), 'utf8' ), 'utf8' );
            }
        }

        assert.deepEqual( built, await htmlFilesUnder( expectedRoot ) );

        for ( const file of built )
        {
            assert.equal(
                await readFile( join( outputDirectory, file ), 'utf8' ),
                await readFile( join( expectedRoot, file ), 'utf8' ),
                `${file} differs from its snapshot`,
            );
        }

        // The generated stylesheet is real: token-derived declarations
        // and the compiler's own vocabulary are present.
        const cssFile = await hashedAsset( join( outputDirectory, 'assets', 'css' ), /^main\.[0-9a-f]{8}\.css$/ );
        const css = await readFile( cssFile, 'utf8' );

        assert.ok(
            ( await readFile( join( outputDirectory, 'index.html' ), 'utf8' ) ).includes( `/assets/css/${cssFile.split( sep ).pop() ?? ''}` ),
            'pages reference the stylesheet by its hashed name',
        );

        assert.ok( css.includes( 'spacing-md' ) );
        assert.ok( css.includes( '.min-h-third' ) );
        assert.ok( css.includes( '.skip-link' ) );
        assert.ok( css.includes( '.gap-md' ) );
        assert.ok( css.includes( '@view-transition' ), 'the crossfade net ships' );
        assert.ok( css.includes( '.casomer-vt' ), 'the stillness freeze ships' );
    } );

    it( 'refuses to write anything when validation fails', async () =>
    {
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-refuse-' ) );
        const brokenContent = await mkdtemp( join( tmpdir(), 'casomer-badsite-' ) );

        await writeFile( join( brokenContent, 'site.json' ), '{ "not": "canonical" }', 'utf8' );

        const result = await buildSite( {
            contentDirectory: brokenContent,
            outputDirectory,
            css: false,
        } );

        assert.ok( result.issues.length > 0 );
        assert.deepEqual( result.pagesWritten, [] );
        assert.deepEqual( await readdir( outputDirectory ), [] );
    } );
} );

describe( 'the delivered-site runtime assets', () =>
{
    it( 'vendors Alpine and the MIT runtime, wired into the scaffold', async () =>
    {
        const outputDirectory = await mkdtemp( join( tmpdir(), 'casomer-runtime-' ) );
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        await buildSite( {
            contentDirectory: join( fixtureRoot, 'content' ),
            outputDirectory,
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
            css: false,
        } );

        const jsDirectory = join( outputDirectory, 'assets', 'js' );
        const runtimeFile = await hashedAsset( jsDirectory, /^casomer-runtime\.[0-9a-f]{8}\.js$/ );
        const alpineFile = await hashedAsset( jsDirectory, /^alpine\.min\.[0-9a-f]{8}\.js$/ );
        const runtime = await readFile( runtimeFile, 'utf8' );
        const alpine = await readFile( alpineFile, 'utf8' );
        const home = await readFile( join( outputDirectory, 'index.html' ), 'utf8' );

        assert.ok( runtime.includes( 'startViewTransition' ) );
        assert.ok( alpine.length > 10000 );
        assert.match( home, /<script defer src="\/assets\/js\/alpine\.min\.[0-9a-f]{8}\.js"><\/script>/ );
        assert.match( home, /<script type="module" src="\/assets\/js\/casomer-runtime\.[0-9a-f]{8}\.js"><\/script>/ );
        assert.ok( home.includes( 'view-transition-name: casomer-header' ) );
        assert.ok( home.includes( 'view-transition-name: casomer-footer' ) );
    } );
} );
