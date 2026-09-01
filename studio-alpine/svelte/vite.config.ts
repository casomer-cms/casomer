import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig( {
    root: dirname( fileURLToPath( import.meta.url ) ),
    base: './',
    plugins: [ svelte() ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
} );
