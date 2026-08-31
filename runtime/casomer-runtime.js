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
// transition (2.1): every stale name in the content area is swept
// before any is set, only the first element per name participates, and
// all names clear when the transition finishes. Ambient motion freezes
// while snapshots exist (2.3) via the casomer-vt class. Persistent
// chrome names live outside main and are never touched (2.8).
//
// Ships readable until the M2 bundling step adds minification.

const reducedMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' );
const pageCache = new Map();
const freezeClass = 'casomer-vt';

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

        if ( name !== '' && !byName.has( name ) ) { byName.set( name, element ); }
    }

    return byName;
}

function assignMorphNames ( currentMain, nextMain )
{
    const current = firstElementByMorphName( currentMain );
    const next = firstElementByMorphName( nextMain );
    const names = [];

    for ( const [ name, element ] of current )
    {
        const partner = next.get( name );

        if ( partner === undefined ) { continue; }

        element.style.viewTransitionName = name;
        partner.style.viewTransitionName = name;
        names.push( name );
    }

    return names;
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

    if ( pushHistory )
    {
        history.replaceState( { casomerScroll: window.scrollY }, '', location.href );
        history.pushState( {}, '', url.href );
    }

    // Capture preparation: freeze ambient motion, sweep every stale
    // name, then dress this transition's pairs. Assignment happens at
    // capture time only.
    document.documentElement.classList.add( freezeClass );

    const sweptStale = sweepContentNames( currentMain );
    const names = assignMorphNames( currentMain, nextMain );

    const swap = () =>
    {
        document.title = next.title;
        currentMain.replaceWith( nextMain );
    };

    let finished = Promise.resolve();

    if ( typeof document.startViewTransition === 'function' )
    {
        const transition = document.startViewTransition( swap );

        await transition.updateCallbackDone;
        finished = transition.finished.catch( () => undefined );
    }
    else
    {
        swap();
    }

    const savedScroll = history.state && typeof history.state.casomerScroll === 'number'
        ? history.state.casomerScroll
        : 0;

    window.scrollTo( 0, pushHistory ? 0 : savedScroll );
    await finished;

    // Names never rest: clear the dressing the moment the transition
    // is over, and unfreeze. A skipped transition still lands here.
    sweepContentNames( nextMain );
    document.documentElement.classList.remove( freezeClass );
    window.casomer.lastTransition = { names, sweptStale };
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
