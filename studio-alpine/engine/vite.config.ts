import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname( fileURLToPath( import.meta.url ) );

export default defineConfig( {
    root: here,
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
            entry: join( here, 'engine.ts' ),
            formats: [ 'es' ],
            fileName: () => 'engine.js',
        },
    },
} );
