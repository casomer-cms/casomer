// The editing bridge (EDITOR section 2), injected into every canvas
// document by the studio server. On canvas a click SELECTS - it never
// navigates and never fires the site's own handlers (following a link
// here would nest Studio inside Studio); behavior is exercised through
// Preview, which opens the real output. The bridge owns geometry and
// the three-level walk: click selects the leaf under the pointer, Esc
// ascends component > section > page, Enter descends, and the chrome
// can command selection by path (breadcrumbs, section handles).

const post = ( message ) => window.parent.postMessage( { casomerStudio: true, ...message }, '*' );

// The chrome sizes a partial's frame to its content (region
// surfaces): report the BODY's content height, never the document's
// scrollHeight - scrollHeight is floored at the frame's own viewport,
// so a frame once made tall would report itself tall forever and the
// partial could never shrink back to its content.
const reportSize = () =>
{
    const style = getComputedStyle( document.body );
    const height = document.body.getBoundingClientRect().height
        + ( parseFloat( style.marginTop ) || 0 )
        + ( parseFloat( style.marginBottom ) || 0 );

    post( { kind: 'size', height } );
};

window.addEventListener( 'load', reportSize );
new ResizeObserver( reportSize ).observe( document.body );

// The engine carries the morph plugin; loading is lazy so a canvas
// nobody edits never pays for it.
let enginePromise = null;

async function morphInto ( element, html )
{
    enginePromise = enginePromise ?? import( '/engine.js' );

    const engine = await enginePromise;

    if ( window.Alpine.morph === undefined ) { window.Alpine.plugin( engine.morphPlugin ); }

    window.Alpine.morph( element, html );
}

let selected = null;
let hovered = null;
let updateQueued = false;

function rectOf ( element )
{
    const rect = element.getBoundingClientRect();

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function radiusOf ( element )
{
    return Math.max( 2, parseFloat( getComputedStyle( element ).borderTopLeftRadius ) || 0 );
}

function blockAt ( target )
{
    return target instanceof Element ? target.closest( '[data-casomer-block]' ) : null;
}

function describe ( element )
{
    return { path: element.dataset.casomerBlock, rect: rectOf( element ), radius: radiusOf( element ) };
}

function markedAncestors ( element )
{
    const chain = [];
    let current = element;

    while ( current !== null && chain.length < 4 )
    {
        chain.push( describe( current ) );
        current = current.parentElement?.closest( '[data-casomer-block]' ) ?? null;
    }

    return chain;
}

function select ( element )
{
    if ( element === null || !element.isConnected )
    {
        const hadSelection = selected !== null;

        selected = null;

        if ( hadSelection ) { post( { kind: 'deselect' } ); }
        return;
    }

    selected = element;
    post( { kind: 'select', ...describe( element ) } );
}

function reportHover ()
{
    if ( hovered === null || !hovered.isConnected || hovered === selected )
    {
        post( { kind: 'hover-clear' } );
        return;
    }

    post( { kind: 'hover', chain: markedAncestors( hovered ) } );
}

function queueUpdate ()
{
    if ( updateQueued ) { return; }

    updateQueued = true;
    requestAnimationFrame( () =>
    {
        updateQueued = false;

        if ( selected !== null ) { select( selected ); }
        if ( hovered !== null ) { reportHover(); }
    } );
}

let refreshing = false;
let refreshQueued = false;

function requestRefresh ()
{
    if ( refreshing )
    {
        refreshQueued = true;
        return;
    }

    refreshing = true;
    void ( async () =>
    {
        try
        {
            const response = await fetch( window.location.href );
            const fresh = new DOMParser().parseFromString( await response.text(), 'text/html' ).querySelector( 'main' );
            const current = document.querySelector( 'main' );

            if ( fresh === null || current === null ) { return; }

            const selectedPath = selected?.dataset.casomerBlock;

            await morphInto( current, fresh.outerHTML );

            if ( selectedPath !== undefined )
            {
                const reanchored = document.querySelector( `[data-casomer-block="${CSS.escape( selectedPath )}"]` );

                select( reanchored instanceof Element ? reanchored : null );
            }

            queueUpdate();
        }
        finally
        {
            refreshing = false;

            if ( refreshQueued )
            {
                refreshQueued = false;
                requestRefresh();
            }
        }
    } )();
}

function ascend ()
{
    select( selected?.parentElement?.closest( '[data-casomer-block]' ) ?? null );
}

function descend ()
{
    const child = selected?.querySelector( '[data-casomer-block]' );

    if ( child instanceof Element ) { select( child ); }
}

document.addEventListener( 'click', ( event ) =>
{
    event.preventDefault();
    event.stopPropagation();

    select( blockAt( event.target ) );
}, true );

// The add-block seam (EDITOR section 2, the AddBlock board): when the
// pointer rests near a boundary between blocks - at the top level or
// inside a section - the chrome shows the amber seam with its plus
// button. Row sections get vertical seams between their side-by-side
// children; an empty section offers its center. The chrome owns the
// button; this side only reports where the boundary is and which
// container it belongs to.
let seamKey = null;

// The resting ghost for empty sections lives here because it is
// editing chrome: the real output never carries the flag.
const ghostStyle = document.createElement( 'style' );

ghostStyle.textContent = `
[data-casomer-empty] {
    min-height: 56px;
    outline: 1px dashed #CDC8BB;
    outline-offset: -4px;
    border-radius: 8px;
}

/* A block whose OUTPUT is empty (a markdown token resolving to
   nothing, an unset image) collapses to zero height and can never
   be clicked again (Mikey). The bridge measures and flags them;
   this ghost keeps them selectable. Editing canvas only - the pure
   preview and the build render the honest nothing. */
[data-casomer-hollow] {
    display: block;
    min-height: 40px;
    outline: 1px dashed #CDC8BB;
    outline-offset: -4px;
    border-radius: 8px;
}

/* The canvas wears the chrome's branded scrollbar - this is the
   EDITING document only; the pure preview and the built site keep
   their own native scrollbars, because the site is never restyled
   to suit the chrome. */
* {
    scrollbar-width: thin;
    scrollbar-color: #CDC8BB transparent;
}

*::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}

*::-webkit-scrollbar-track {
    background: transparent;
}

*::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
}

*::-webkit-scrollbar-thumb {
    background: #CDC8BB;
    border-radius: 5px;
    border: 3px solid transparent;
    background-clip: content-box;
}

*::-webkit-scrollbar-thumb:hover {
    background: #A39E8F;
    border: 3px solid transparent;
    background-clip: content-box;
}
`;
document.head.append( ghostStyle );

function directChildBlocks ( containerPath )
{
    const prefix = containerPath === '' ? 'blocks[' : `${containerPath}.blocks[`;
    const shape = new RegExp( `^${prefix.replace( /[.[\]]/g, '\\$&' )}\\d+\\]$` );

    return [ ...document.querySelectorAll( '[data-casomer-block]' ) ]
        .filter( ( element ) => shape.test( element.dataset.casomerBlock ) );
}

// A container's flow axis comes from the element the children lay out
// in: column flow means horizontal seams, row flow vertical ones.
function containerFlow ( layoutElement )
{
    const style = getComputedStyle( layoutElement );

    return style.display.includes( 'flex' ) && style.flexDirection.startsWith( 'row' ) ? 'row' : 'column';
}

function candidatesFor ( containerPath, layoutElement )
{
    const children = directChildBlocks( containerPath );
    const box = layoutElement.getBoundingClientRect();

    if ( children.length === 0 )
    {
        return [ {
            container: containerPath,
            index: 0,
            orientation: 'h',
            at: box.top + box.height / 2,
            crossStart: box.left,
            crossSize: box.width,
            crossLow: box.top,
            crossHigh: box.bottom,
        } ];
    }

    const flow = containerFlow( children[ 0 ].parentElement === null ? layoutElement : children[ 0 ].parentElement );
    const rects = children.map( ( element ) => element.getBoundingClientRect() );
    const horizontal = flow === 'column';
    const positions = [ horizontal ? rects[ 0 ].top : rects[ 0 ].left ];

    for ( let position = 0; position < rects.length - 1; position += 1 )
    {
        positions.push( horizontal
            ? ( rects[ position ].bottom + rects[ position + 1 ].top ) / 2
            : ( rects[ position ].right + rects[ position + 1 ].left ) / 2 );
    }

    positions.push( horizontal ? rects[ rects.length - 1 ].bottom : rects[ rects.length - 1 ].right );

    return positions.map( ( at, index ) => ( {
        container: containerPath,
        index,
        orientation: horizontal ? 'h' : 'v',
        at,
        crossStart: horizontal ? box.left : box.top,
        crossSize: horizontal ? box.width : box.height,
        crossLow: horizontal ? box.left : box.top,
        crossHigh: horizontal ? box.right : box.bottom,
    } ) );
}

function seamAt ( clientX, clientY )
{
    const main = document.querySelector( 'main' );

    if ( main === null ) { return null; }

    const candidates = candidatesFor( '', main );

    // Every marked section with (or without) children is a container
    // of its own; deeper containers win ties, so a boundary just
    // inside a section beats the page boundary beside it.
    for ( const element of document.querySelectorAll( '[data-casomer-block]' ) )
    {
        const path = element.dataset.casomerBlock;
        const layoutElement = element.querySelector( '[data-casomer-empty]' ) ?? element;
        const isContainer = element.hasAttribute( 'data-casomer-empty' )
            || layoutElement.hasAttribute( 'data-casomer-empty' )
            || directChildBlocks( path ).length > 0;

        if ( isContainer ) { candidates.push( ...candidatesFor( path, layoutElement ) ); }
    }

    let best = null;
    let bestDistance = Infinity;

    for ( const candidate of candidates )
    {
        const along = candidate.orientation === 'h' ? clientY : clientX;
        const cross = candidate.orientation === 'h' ? clientX : clientY;

        if ( cross < candidate.crossLow || cross > candidate.crossHigh ) { continue; }

        const distance = Math.abs( along - candidate.at );

        if ( distance > 12 ) { continue; }

        const deeper = best !== null && candidate.container.length > best.container.length;

        if ( best === null || distance < bestDistance - 2 || ( deeper && distance <= bestDistance + 2 ) )
        {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
}

function reportSeam ( clientX, clientY )
{
    const seam = seamAt( clientX, clientY );

    if ( seam === null )
    {
        if ( seamKey !== null )
        {
            seamKey = null;
            post( { kind: 'seam-clear' } );
        }

        return;
    }

    const key = `${seam.container}:${seam.index}`;

    if ( key === seamKey ) { return; }

    seamKey = key;
    post( {
        kind: 'seam',
        container: seam.container,
        index: seam.index,
        orientation: seam.orientation,
        at: seam.at,
        crossStart: seam.crossStart,
        crossSize: seam.crossSize,
    } );
}

document.addEventListener( 'mousemove', ( event ) =>
{
    const next = blockAt( event.target );

    reportSeam( event.clientX, event.clientY );

    if ( next === hovered ) { return; }

    hovered = next;
    reportHover();
}, { passive: true } );

document.addEventListener( 'mouseleave', () =>
{
    hovered = null;
    post( { kind: 'hover-clear' } );

    if ( seamKey !== null )
    {
        seamKey = null;
        post( { kind: 'seam-clear' } );
    }
} );

document.addEventListener( 'keydown', ( event ) =>
{
    if ( event.key === 'Escape' ) { ascend(); }
    if ( event.key === 'Enter' ) { descend(); }

    // Delete and Backspace ask the chrome to remove the selected
    // block - through its confirm, exactly like the trash button.
    // Never while typing in something editable inside the canvas.
    if ( event.key === 'Delete' || event.key === 'Backspace' )
    {
        const editable = event.target instanceof Element
            && ( event.target.closest( 'input, textarea, select, [contenteditable]' ) !== null );

        if ( !editable )
        {
            event.preventDefault();
            post( { kind: 'remove-request' } );
        }
    }

    // Clicking the canvas moves keyboard focus into this document, so
    // undo and redo forward to the chrome - key events never cross
    // the frame boundary on their own.
    if ( ( event.ctrlKey || event.metaKey ) && event.key.toLowerCase() === 'z' )
    {
        event.preventDefault();
        post( { kind: event.shiftKey ? 'redo' : 'undo' } );
    }

    // The palette shortcut works with canvas focus too.
    if ( ( event.ctrlKey || event.metaKey ) && event.key.toLowerCase() === 'k' )
    {
        event.preventDefault();
        post( { kind: 'palette' } );
    }
} );

window.addEventListener( 'message', ( event ) =>
{
    const message = event.data;

    if ( message?.casomerStudio !== true ) { return; }

    if ( message.kind === 'select-path' )
    {
        const target = document.querySelector( `[data-casomer-block="${CSS.escape( message.path )}"]` );

        if ( target instanceof Element ) { select( target ); }
    }

    if ( message.kind === 'deselect' ) { select( null ); }
    if ( message.kind === 'ascend' ) { ascend(); }
    if ( message.kind === 'descend' ) { descend(); }

    // A whole-page refresh without a reload: refetch this document,
    // morph the new main over the live one, and re-anchor the
    // selection by its path. Journal steps ride this so the canvas
    // never blanks. Spammed steps coalesce: one refresh in flight,
    // at most one queued behind it, and the last always runs against
    // the newest content.
    if ( message.kind === 'refresh' ) { requestRefresh(); }

    // Per-keystroke updates (DEVELOPMENT section 5): the chrome sends
    // the block's re-rendered INNER html; morph merges it under the
    // marker wrapper, so the marker survives and Alpine state, focus,
    // and scroll do too. Geometry re-reports because the size changed.
    if ( message.kind === 'morph-block' )
    {
        const target = document.querySelector( `[data-casomer-block="${CSS.escape( message.path )}"]` );

        if ( target?.firstElementChild instanceof Element )
        {
            void morphInto( target.firstElementChild, message.html ).then( () => queueUpdate() );
        }
    }
} );

window.addEventListener( 'scroll', queueUpdate, { capture: true, passive: true } );
window.addEventListener( 'resize', queueUpdate );

// The hollow sweep: flag every marked block whose rendered height
// collapsed (see the ghost style above). Unflagging measures WITHOUT
// the ghost first, or the min-height it grants would immediately
// disqualify the block it rescued.
function markHollowBlocks ()
{
    for ( const el of document.querySelectorAll( '[data-casomer-block]' ) )
    {
        if ( el.hasAttribute( 'data-casomer-hollow' ) )
        {
            el.removeAttribute( 'data-casomer-hollow' );

            if ( el.getBoundingClientRect().height < 12 ) { el.setAttribute( 'data-casomer-hollow', '' ); }

            continue;
        }

        if ( el.getBoundingClientRect().height < 12 ) { el.setAttribute( 'data-casomer-hollow', '' ); }
    }
}

let hollowTimer = null;
const scheduleHollowSweep = () =>
{
    clearTimeout( hollowTimer );
    hollowTimer = setTimeout( markHollowBlocks, 120 );
};

// Content changes re-measure; attribute changes are NOT observed, so
// the sweep's own flags never retrigger it.
new MutationObserver( scheduleHollowSweep ).observe( document.body, { childList: true, subtree: true, characterData: true } );
scheduleHollowSweep();
