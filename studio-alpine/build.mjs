// One command readies both lanes: the shared manifest, the vendored
// Alpine file, the Alpine lane's Tailwind pass, and the Svelte lane's
// vite build. Run from the repo root:
//   node --experimental-strip-types studio-alpine/build.mjs
// then serve the directory:
//   node bin/caso.js preview --dir studio-alpine --port 2299

import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );
const require = createRequire( import.meta.url );

await import( './generate-manifest.mjs' );

await copyFile(
    join( dirname( require.resolve( 'alpinejs/package.json' ) ), 'dist', 'cdn.min.js' ),
    join( here, 'alpine', 'alpine.min.js' ),
);
console.log( 'alpine vendored' );

const cliPackage = require.resolve( '@tailwindcss/cli/package.json' );
const binField = require( '@tailwindcss/cli/package.json' ).bin;
const binPath = typeof binField === 'string' ? binField : Object.values( binField )[ 0 ];

execFileSync(
    process.execPath,
    [ join( dirname( cliPackage ), binPath ), '-i', join( here, 'alpine', 'tailwind.input.css' ), '-o', join( here, 'alpine', 'tailwind.css' ) ],
    { cwd: join( here, 'alpine' ), stdio: 'pipe' },
);
console.log( 'tailwind generated' );

const viteBin = join( dirname( require.resolve( 'vite/package.json' ) ), 'bin', 'vite.js' );

execFileSync(
    process.execPath,
    [ viteBin, 'build', '--config', join( here, 'svelte', 'vite.config.ts' ) ],
    { cwd: here, stdio: 'inherit' },
);
console.log( 'svelte lane built' );

execFileSync(
    process.execPath,
    [ viteBin, 'build', '--config', join( here, 'engine', 'vite.config.ts' ) ],
    { cwd: here, stdio: 'inherit' },
);
console.log( 'preview engine built' );

// The preview's site CSS: render the sample through the product path,
// then run the theme's Tailwind pass over that sample alone.
{
    const { writeFile, readFile } = await import( 'node:fs/promises' );
    const { loadPackageFromDirectory } = await import( '../src/schema/loadPackage.ts' );
    const { renderComponentInstance } = await import( '../src/compiler/assemblePage.ts' );
    const { generateThemeInputCss } = await import( '../src/compiler/themeCss.ts' );
    const { loadSiteDirectory } = await import( '../src/content/loadSiteDirectory.ts' );

    const fixtureRoot = join( here, '..', 'fixtures', 'site-basic' );
    const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );
    const site = await loadSiteDirectory( join( fixtureRoot, 'content' ), [ loadedPackage ] );
    const card = loadedPackage.components.get( 'card' );
    const manifestJson = JSON.parse( await readFile( join( here, 'manifest.json' ), 'utf8' ) );
    const sample = await renderComponentInstance( card, manifestJson.initialProps );

    await writeFile( join( here, 'preview', 'sample.html' ), sample, 'utf8' );

    const tailwindEntry = join( dirname( require.resolve( 'tailwindcss/package.json' ) ), 'index.css' ).replaceAll( '\\', '/' );
    const input = generateThemeInputCss( site.config, tailwindEntry )
        .replace( '@source "../../**/*.html";', '@source "./sample.html";' );

    await writeFile( join( here, 'preview', 'site.input.css' ), input, 'utf8' );
    execFileSync(
        process.execPath,
        [ join( dirname( cliPackage ), binPath ), '-i', join( here, 'preview', 'site.input.css' ), '-o', join( here, 'preview', 'site.css' ) ],
        { cwd: join( here, 'preview' ), stdio: 'pipe' },
    );
    console.log( 'preview site css generated' );
}
