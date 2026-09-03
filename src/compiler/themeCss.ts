// The token-to-Tailwind bridge of SCHEMA section 12.1: the site's theme
// tokens become a Tailwind v4 CSS-first theme, so every component, core
// or third-party, expresses design exclusively through the site's own
// vocabulary. Re-theming a site is a JSON edit; this file is where that
// edit becomes CSS. The small block of plain classes at the end covers
// the compiler's own emissions that are not Tailwind utilities.

import { type SiteConfig } from '../content/siteConfig.ts';
import { fontFaceCss, type SiteFont } from './fonts.ts';

const familyPrefixes: Readonly<Record<string, string>> = {
    colors: '--color',
    spacing: '--spacing',
    widths: '--container',
    radius: '--radius',
    shadows: '--shadow',
};

// One formula, two homes: Studio's placeholder previews mirror it.
export function defaultTypeScale ( config: SiteConfig ): number
{
    const raw = Number.parseFloat( config.theme.families.typography?.scale ?? '1.25' );

    return Number.isFinite( raw ) && raw > 1 ? raw : 1.25;
}

export function scaleSize ( scale: number, power: number ): string
{
    return `${Number( Math.pow( scale, power ).toFixed( 3 ) )}rem`;
}

export function generateThemeInputCss ( config: SiteConfig, tailwindImport = 'tailwindcss', fonts: readonly SiteFont[] = [] ): string
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

    lines.push( '}', '' );

    // Self-hosted fonts (fonts/ directory): one @font-face per file,
    // families spoken by filename - usable directly in typography
    // stacks. font-display swap; the site never phones out.
    if ( fonts.length > 0 )
    {
        lines.push( ...fontFaceCss( fonts ), '' );
    }

    // The default type scale (SCHEMA 12.1): Tailwind's preflight
    // zeroes heading styles, so without this every h1 reads as
    // paragraph text. Sizes derive from the theme's "scale" token
    // (h1 = scale^5 ... h6 = scale^0 rem - the same formula Studio
    // shows as placeholders); weight and line-height make headings
    // headings. The body speaks the sans token when one exists.
    const scale = defaultTypeScale( config );

    if ( config.theme.families.typography?.sans !== undefined )
    {
        lines.push( 'body { font-family: var(--font-sans); }' );
    }

    // Each heading style also answers to a class alias (.h4 beside
    // h4): the assembler splits semantics from looks when it remaps -
    // <h2 class="h4"> keeps the outline honest while wearing the
    // authored size (SCHEMA 8).
    for ( const [ element, power ] of Object.entries( { h1: 5, h2: 4, h3: 3, h4: 2, h5: 1, h6: 0 } ) )
    {
        lines.push( `${element}, .${element} { font-size: ${scaleSize( scale, power )}; font-weight: 650; line-height: 1.2; }` );
    }

    // Element typography (SCHEMA 12.1): per-element size and font,
    // layered over the defaults. A font is a free font-family stack
    // ("Helvetica, Arial, sans-serif"); a bare typography token name
    // still resolves to its variable.
    for ( const element of [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ] )
    {
        const entry = config.theme.text?.[ element ];

        if ( entry === undefined ) { continue; }

        const fontTokens = Object.keys( config.theme.families.typography ?? {} ).filter( ( token ) => token !== 'scale' );
        const parts = [
            ...( entry.size === undefined ? [] : [ `font-size: ${entry.size};` ] ),
            ...( entry.font === undefined ? [] : [ `font-family: ${fontTokens.includes( entry.font ) ? `var(--font-${entry.font})` : entry.font};` ] ),
        ];
        const selector = element === 'p' ? 'p' : `${element}, .${element}`;

        if ( parts.length > 0 ) { lines.push( `${selector} { ${parts.join( ' ' )} }` ); }
    }

    lines.push(
        '',
        // The crossfade net (TRANSITIONS section 1): no element names,
        // so hard navigations get a root crossfade where supported and
        // there is no collision risk. A courtesy, not a system.
        '@view-transition { navigation: auto; }',
        '',
        // Snapshot geometry (TRANSITIONS 2.9): a group's overflow is
        // visible by default, the door every ghost leaks through when
        // a snapshot keeps its own aspect inside a box tweening
        // between two shapes. Clipping every group closes it; the
        // runtime adds the per-pair cover-fit and radius rules.
        '::view-transition-group(*) { overflow: clip; }',
        '',
        // One-sided captures fade, never pop (TRANSITIONS 2.8): a name
        // with no counterpart on the other side is :only-child in its
        // group. Matched pairs stay untouched, so these compose with
        // the morph rules.
        '@keyframes casomer-vt-exit { to { opacity: 0; } }',
        '@keyframes casomer-vt-enter { from { opacity: 0; } }',
        '::view-transition-old(*):only-child { animation: casomer-vt-exit 0.25s ease both; }',
        '::view-transition-new(*):only-child { animation: casomer-vt-enter 0.35s ease both; }',
        '',
        // A scrollbar appearing or vanishing between capture and
        // animation changes the viewport width, which aborts the whole
        // transition (TRANSITIONS 2.9). A stable gutter keeps the width
        // constant between a short page and a long one.
        'html { scrollbar-gutter: stable; }',
        '',
        // Motion respects prefers-reduced-motion, emitted by the
        // compiler so no component can opt out (SCHEMA 7): the
        // crossfade net switches off and morphs snap instead of
        // animating.
        '@media (prefers-reduced-motion: reduce) {',
        '    @view-transition { navigation: none; }',
        '    ::view-transition-group(*), ::view-transition-image-pair(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }',
        '}',
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
        'p + p { margin-top: 0.75em; }',
        '.skip-link { position: absolute; left: -999rem; }',
        '.skip-link:focus { position: static; }',
        '',
        // Menus (SCHEMA 12.5): the functional layer under menu-sourced
        // repeats - a flat row of links by default, nested families as
        // CSS-only dropdowns on hover and keyboard focus. Sites
        // restyle these freely; only the class names are contract.
        'ul.cs-menu, .cs-menu ul { list-style: none; margin: 0; padding: 0; }',
        '.cs-menu { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em 1.5em; }',
        '.cs-menu-item { position: relative; }',
        '.cs-menu-sub { display: none; flex-direction: column; gap: 0.35em; position: absolute; top: 100%; left: 0; z-index: 20; min-width: 12em; padding: 0.6em 0.85em; background: Canvas; border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); }',
        '.cs-menu-sub .cs-menu-sub { top: 0; left: 100%; }',
        '.cs-menu-parent:hover > .cs-menu-sub, .cs-menu-parent:focus-within > .cs-menu-sub { display: flex; }',
        '.cs-menu-label { font-weight: 650; }',
        '',
        // The pager (SCHEMA 13.5): functional layer under paginated
        // indexes; sites restyle freely - the class names are the
        // contract.
        '.cs-pager ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4em; justify-content: center; }',
        '.cs-pager a, .cs-pager-current { display: inline-block; min-width: 2em; padding: 0.3em 0.55em; text-align: center; border-radius: 6px; }',
        '.cs-pager-current { font-weight: 650; background: var(--color-secondary, #eeeeee); }',
        '',
    );

    return lines.join( '\n' );
}
