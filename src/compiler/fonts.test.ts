import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fontFaceCss, scanFonts } from './fonts.ts';

describe( 'self-hosted fonts', () =>
{
    it( 'derives family, weight, and style from filenames, deterministically', async () =>
    {
        const directory = await mkdtemp( join( tmpdir(), 'casomer-fonts-' ) );

        await mkdir( join( directory, 'fonts' ) );

        for ( const name of [ 'Sora-Bold.woff2', 'PlayfairDisplay-BoldItalic.woff2', 'Inter.ttf', 'Grenze_300.otf', 'notes.txt' ] )
        {
            await writeFile( join( directory, 'fonts', name ), '' );
        }

        const fonts = await scanFonts( directory );

        assert.deepEqual( fonts.map( ( font ) => [ font.family, font.weight, font.style, font.format ] ), [
            [ 'Grenze', 300, 'normal', 'opentype' ],
            [ 'Inter', 400, 'normal', 'truetype' ],
            [ 'PlayfairDisplay', 700, 'italic', 'woff2' ],
            [ 'Sora', 700, 'normal', 'woff2' ],
        ] );

        const css = fontFaceCss( fonts ).join( '\n' );

        assert.match( css, /font-family: "PlayfairDisplay"; src: url\("\/fonts\/PlayfairDisplay-BoldItalic\.woff2"\) format\("woff2"\); font-weight: 700; font-style: italic; font-display: swap;/ );
    } );

    it( 'answers an absent fonts directory with nothing', async () =>
    {
        const directory = await mkdtemp( join( tmpdir(), 'casomer-nofonts-' ) );

        assert.deepEqual( await scanFonts( directory ), [] );
    } );
} );
