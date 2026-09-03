// The Casomer runtime: the delivered-site library of TRANSITIONS,
// licensed MIT (see LICENSE in this directory) because it ships inside
// every generated site. Deliberately dumb by doctrine: it executes what
// the compiler emitted and decides nothing at authoring level.
//
// Tier 2 soft navigation: same-origin link clicks fetch the destination
// and swap main inside a view transition. Reduced-motion visitors get
// tier 1: plain navigation, with Alpine conveniences intact. Every page
// is real HTML at its real URL, so any failure falls back to normal
// navigation and the crossfade net in the stylesheet covers the rest.
//
// Morph mechanics, per the cookbook: elements pair by their compiler
// emitted data-morph attribute. Names are ephemeral dressing for one
// transition (2.1): every stale name in both content areas - the
// departing page's and the arriving page's baked-in names alike - is
// swept before any is set, only the first element per name
// participates, and all names clear when the transition finishes.
// Each pair gets snapshot geometry rules for this one transition
// (2.9): the group clips and carries the landing radius, media pairs
// cover-fit their snapshots, and content rides above chrome. Ambient
// motion freezes while snapshots exist (2.3) via the casomer-vt class.
// Persistent chrome names live outside main and are never touched
// (2.8). Cleanup is backstopped by a timer, because a hidden document
// may never finish its animation (2.9).
//
// Ships readable until the M2 bundling step adds minification.

const reducedMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' );
const pageCache = new Map();
const freezeClass = 'casomer-vt';
const rulesId = 'casomer-vt-rules';

// A view-transition-name is a CSS custom-ident; anything else would
// abort the transition or break the per-transition rules.
const nameShape = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Snapshots of these get the cover-fit blend: both sides fill the
// morphing box as a crop, so a portrait tile becoming a landscape hero
// crossfades two sensible crops instead of stretching or overhanging.
const mediaSelector = 'img, picture, video, canvas, svg';

// How long cleanup waits for a transition to finish before giving up
// on it: a backgrounded tab may pause the animation indefinitely, and
// a stranded freeze would stop every animation on the page.
const finishBackstopMs = 2000;

// A tiny observable surface for the browser test suite and, later, the
// editor: what the last transition did.
window.casomer = { lastTransition: null };

function isSoftNavigable ( anchor, event )
{
    if ( event.defaultPrevented || event.button !== 0 ) { return false; }
    if ( event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) { return false; }
    if ( anchor.target !== '' && anchor.target !== '_self' ) { return false; }
    if ( anchor.hasAttribute( 'download' ) ) { return false; }

    const url = new URL( anchor.href, location.href );

    if ( url.origin !== location.origin ) { return false; }

    const samePage = url.pathname === location.pathname && url.search === location.search;

    if ( samePage && url.hash !== '' ) { return false; }

    return true;
}

function fetchPage ( url )
{
    const key = url.pathname + url.search;

    if ( !pageCache.has( key ) )
    {
        const request = fetch( url.href )
            .then( ( response ) =>
            {
                if ( !response.ok ) { throw new Error( `HTTP ${response.status}` ); }

                return response.text();
            } )
            .catch( ( error ) =>
            {
                pageCache.delete( key );
                throw error;
            } );

        pageCache.set( key, request );
    }

    return pageCache.get( key );
}

function sweepContentNames ( root )
{
    let swept = 0;

    for ( const element of root.querySelectorAll( '[style*="view-transition-name"]' ) )
    {
        element.style.removeProperty( 'view-transition-name' );
        swept += 1;
    }

    return swept;
}

// Only the first element carrying a name participates: duplicates in a
// snapshot abort the whole transition (2.1), so they never get named.
function firstElementByMorphName ( root )
{
    const byName = new Map();

    for ( const element of root.querySelectorAll( '[data-morph]' ) )
    {
        const name = element.getAttribute( 'data-morph' );

        if ( nameShape.test( name ) && !byName.has( name ) ) { byName.set( name, element ); }
    }

    return byName;
}

// Dress the pairs for capture: a name on the departing element belongs
// to the old state, the same name on the arriving element to the new
// state. Names without a partner stay unset, so nothing renders as a
// stray group floating above the crossfade.
function pairMorphs ( currentMain, nextMain )
{
    const current = firstElementByMorphName( currentMain );
    const next = firstElementByMorphName( nextMain );
    const pairs = [];

    for ( const [ name, from ] of current )
    {
        const to = next.get( name );

        if ( to === undefined ) { continue; }

        from.style.viewTransitionName = name;
        to.style.viewTransitionName = name;
        pairs.push( { name, from, to } );
    }

    return pairs;
}

function borderRadiusOf ( element )
{
    const style = getComputedStyle( element );
    const shorthand = style.borderRadius;

    if ( shorthand !== '' ) { return shorthand; }

    return `${style.borderTopLeftRadius} ${style.borderTopRightRadius} ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`;
}

// Snapshot geometry (TRANSITIONS 2.9), written per transition because
// the rules key on names and the landing element's own radius. Read
// once the arriving element is live, so its computed style exists.
function morphRules ( pairs )
{
    const rules = [];

    for ( const { name, from, to } of pairs )
    {
        // The group is the morphing box: it clips (site-wide rule), it
        // carries the landing radius so both snapshots share one
        // rounded clip while the box tweens, and it paints above the
        // persistent chrome groups so a hero never dives behind the
        // footer mid-flight (2.8).
        const radius = borderRadiusOf( to );
        const group = radius === '0px' || radius === '0px 0px 0px 0px'
            ? 'z-index: 1;'
            : `z-index: 1; border-radius: ${radius};`;

        rules.push( `::view-transition-group(${name}) { ${group} }` );

        // Media snapshots keep their own aspect ratio by default and
        // overhang a box tweening between two shapes; cover-fitting
        // both sides makes mid-morph a crossfade of two crops.
        if ( from.matches( mediaSelector ) || to.matches( mediaSelector ) )
        {
            rules.push( `::view-transition-old(${name}), ::view-transition-new(${name}) { width: 100%; height: 100%; object-fit: cover; overflow: clip; }` );
        }
    }

    return rules.join( '\n' );
}

async function navigate ( url, pushHistory )
{
    let html;

    try
    {
        html = await fetchPage( url );
    }
    catch
    {
        location.assign( url.href );
        return;
    }

    const next = new DOMParser().parseFromString( html, 'text/html' );
    const nextMain = next.querySelector( 'main' );
    const currentMain = document.querySelector( 'main' );

    if ( nextMain === null || currentMain === null )
    {
        location.assign( url.href );
        return;
    }

    // Scroll restoration is explicit (2.5): a link pushes 0, browser
    // back carries the position it left from in history state.
    const savedScroll = history.state && typeof history.state.casomerScroll === 'number'
        ? history.state.casomerScroll
        : 0;
    const arrivalScroll = pushHistory ? 0 : savedScroll;

    if ( pushHistory )
    {
        history.replaceState( { casomerScroll: window.scrollY }, '', location.href );
        history.pushState( {}, '', url.href );
    }

    // Capture preparation: freeze ambient motion, sweep every stale
    // name on both sides, then dress this transition's pairs.
    // Assignment happens at capture time only.
    document.documentElement.classList.add( freezeClass );

    const sweptStale = sweepContentNames( currentMain ) + sweepContentNames( nextMain );
    const pairs = pairMorphs( currentMain, nextMain );
    const names = pairs.map( ( pair ) => pair.name );
    const rules = document.createElement( 'style' );

    rules.id = rulesId;

    const swap = () =>
    {
        document.title = next.title;

        // Chrome that changed swaps with the content (SCHEMA 12.6): a
        // page template with its own header or footer. Identical
        // chrome is left alone, and the persistent names hold it
        // still through the transition (TRANSITIONS 2.8).
        for ( const tag of [ 'header', 'footer' ] )
        {
            const nextChrome = next.querySelector( `body > ${tag}` );
            const currentChrome = document.querySelector( `body > ${tag}` );

            // Compared by content, not by the element: a script that
            // decorates the landmark itself must not force a swap.
            if ( nextChrome !== null && currentChrome !== null && nextChrome.innerHTML !== currentChrome.innerHTML )
            {
                currentChrome.replaceWith( nextChrome );
            }
        }

        currentMain.replaceWith( nextMain );

        // Inside the update, so the new-state capture measures the
        // landing geometry at the arrival scroll position, and the
        // landing element is live for its radius.
        window.scrollTo( 0, arrivalScroll );
        rules.textContent = morphRules( pairs );
        document.head.append( rules );
    };

    let finished = Promise.resolve();

    if ( typeof document.startViewTransition === 'function' )
    {
        const transition = document.startViewTransition( swap );

        finished = Promise.race( [
            transition.finished.catch( () => undefined ),
            new Promise( ( resolve ) => setTimeout( resolve, finishBackstopMs ) ),
        ] );
    }
    else
    {
        swap();
    }

    await finished;

    // Names never rest: clear the dressing the moment the transition
    // is over, drop its rules, and unfreeze. A skipped or stalled
    // transition still lands here.
    sweepContentNames( nextMain );
    rules.remove();
    document.documentElement.classList.remove( freezeClass );
    window.casomer.lastTransition = { names, sweptStale, rules: rules.textContent };
}

function onClick ( event )
{
    const anchor = event.target instanceof Element ? event.target.closest( 'a[href]' ) : null;

    if ( anchor === null || !isSoftNavigable( anchor, event ) ) { return; }

    event.preventDefault();
    navigate( new URL( anchor.href, location.href ), true );
}

function onHover ( event )
{
    const anchor = event.target instanceof Element ? event.target.closest( 'a[href]' ) : null;

    if ( anchor === null ) { return; }

    const url = new URL( anchor.href, location.href );

    if ( url.origin === location.origin ) { fetchPage( url ).catch( () => undefined ); }
}

if ( !reducedMotion.matches )
{
    document.addEventListener( 'click', onClick );
    document.addEventListener( 'mouseover', onHover );
    window.addEventListener( 'popstate', () => navigate( new URL( location.href ), false ) );
    history.scrollRestoration = 'manual';
}
