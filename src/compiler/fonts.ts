// Self-hosted fonts (DEVELOPMENT recommendation, Mikey's licensed-
// fonts question): font files dropped in fonts/ become @font-face
// rules and ship with the site - licensed faces without the site
// ever phoning out. The FILENAME is the contract:
// "PlayfairDisplay-BoldItalic.woff2" -> family "PlayfairDisplay",
// weight 700, italic. Weight words and 3-digit weights are consumed;
// whatever remains is the family. Files sort by name so the emitted
// CSS is deterministic (the empty-diff invariant).

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const weightWords: Readonly<Record<string, number>> = {
    thin: 100, hairline: 100,
    extralight: 200, ultralight: 200,
    light: 300,
    regular: 400, normal: 400, book: 400,
    medium: 500,
    semibold: 600, demibold: 600,
    bold: 700,
    extrabold: 800, ultrabold: 800,
    black: 900, heavy: 900,
};

const formats: Readonly<Record<string, string>> = {
    woff2: 'woff2',
    woff: 'woff',
    ttf: 'truetype',
    otf: 'opentype',
};

export interface SiteFont
{
    readonly file: string;
    readonly family: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
    readonly format: string;
}

export async function scanFonts ( contentDirectory: string ): Promise<SiteFont[]>
{
    let names: string[] = [];

    try { names = await readdir( join( contentDirectory, 'fonts' ) ); }
    catch { return []; }

    const fonts: SiteFont[] = [];

    for ( const name of [ ...names ].sort() )
    {
        const match = /^(.+)\.(woff2|woff|ttf|otf)$/i.exec( name );

        if ( match === null ) { continue; }

        const stem = match[ 1 ] as string;
        const format = formats[ ( match[ 2 ] as string ).toLowerCase() ] as string;
        const familyTokens: string[] = [];
        let weight = 400;
        let italic = false;

        for ( const token of stem.split( /[-_ ]+/ ).filter( ( part ) => part !== '' ) )
        {
            const lower = token.toLowerCase();

            if ( lower === 'italic' || lower === 'oblique' )
            {
                italic = true;
                continue;
            }

            if ( weightWords[ lower ] !== undefined )
            {
                weight = weightWords[ lower ] as number;
                continue;
            }

            // "BoldItalic" style compounds.
            const compound = /^(.*)italic$/.exec( lower );

            if ( compound !== null && ( compound[ 1 ] === '' || weightWords[ compound[ 1 ] as string ] !== undefined ) )
            {
                italic = true;
                weight = weightWords[ compound[ 1 ] as string ] ?? weight;
                continue;
            }

            if ( /^[1-9]00$/.test( lower ) )
            {
                weight = Number( lower );
                continue;
            }

            familyTokens.push( token );
        }

        fonts.push( {
            file: name,
            family: familyTokens.join( ' ' ) || stem,
            weight,
            style: italic ? 'italic' : 'normal',
            format,
        } );
    }

    return fonts;
}

export function fontFaceCss ( fonts: readonly SiteFont[] ): string[]
{
    return fonts.map( ( font ) =>
        `@font-face { font-family: "${font.family}"; src: url("/fonts/${font.file}") format("${font.format}"); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }` );
}
