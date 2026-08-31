// The token-to-Tailwind bridge of SCHEMA section 12.1: the site's theme
// tokens become a Tailwind v4 CSS-first theme, so every component, core
// or third-party, expresses design exclusively through the site's own
// vocabulary. Re-theming a site is a JSON edit; this file is where that
// edit becomes CSS. The small block of plain classes at the end covers
// the compiler's own emissions that are not Tailwind utilities.

import { type SiteConfig } from '../content/siteConfig.ts';

const familyPrefixes: Readonly<Record<string, string>> = {
    colors: '--color',
    spacing: '--spacing',
    widths: '--container',
    radius: '--radius',
    shadows: '--shadow',
};

export function generateThemeInputCss ( config: SiteConfig, tailwindImport = 'tailwindcss' ): string
{
    const lines: string[] = [ `@import "${tailwindImport}";`, '@source "../../**/*.html";', '', '@theme {' ];

    for ( const [ family, prefix ] of Object.entries( familyPrefixes ) )
    {
        for ( const [ name, value ] of Object.entries( config.theme.families[ family ] ?? {} ) )
        {
            lines.push( `    ${prefix}-${name}: ${value};` );
        }
    }

    // Typography tokens map to font-family variables; the "scale" token
    // is a type-scale ratio, not a font, and gets its own treatment when
    // generated typography styles land.
    for ( const [ name, value ] of Object.entries( config.theme.families.typography ?? {} ) )
    {
        if ( name === 'scale' ) { continue; }

        lines.push( `    --font-${name}: ${value};` );
    }

    for ( const [ name, value ] of Object.entries( config.theme.breakpoints ) )
    {
        lines.push( `    --breakpoint-${name}: ${value}px;` );
    }

    lines.push(
        '}',
        '',
        // The crossfade net (TRANSITIONS section 1): no element names,
        // so hard navigations get a root crossfade where supported and
        // there is no collision risk. A courtesy, not a system.
        '@view-transition { navigation: auto; }',
        '',
        // Stillness under capture (TRANSITIONS 2.3): while the runtime
        // holds snapshots, ambient motion pauses and CSS transitions
        // snap to their end states, so nothing moves under a morph.
        '.casomer-vt * { animation-play-state: paused !important; transition-duration: 0s !important; }',
        '',
        // The compiler's own vocabulary: layering (SCHEMA 11.5), viewport
        // presets (11.3), kickers (8.4), and the skip link (7).
        '.layer { display: grid; }',
        '.layer > * { grid-area: 1 / 1; }',
        '.min-h-half { min-height: 50vh; }',
        '.min-h-third { min-height: 33.333vh; }',
        '.kicker { font-size: 0.875em; letter-spacing: 0.1em; text-transform: uppercase; }',
        '.skip-link { position: absolute; left: -999rem; }',
        '.skip-link:focus { position: static; }',
        '',
    );

    return lines.join( '\n' );
}
