// The canvas engine build: the one bundling job the chrome depends on
// (the chrome itself is no-build source). Output lands beside the
// chrome as studio/app/engine.js, served and shipped with it.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname( fileURLToPath( import.meta.url ) );

export default defineConfig( {
    root: here,
    build: {
        outDir: join( here, '..', 'app' ),
        emptyOutDir: false,
        lib: {
            entry: join( here, 'engine.ts' ),
            formats: [ 'es' ],
            fileName: () => 'engine.js',
        },
    },
} );
