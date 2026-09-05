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
    // Chrome and partials on a page canvas carry no block path; they
    // select as a SCOPE - the sidebar names what owns them and offers
    // the way there (Mikey: select first, never jump).
    const scope = element.dataset.casomerBlock !== undefined
        ? undefined
        : ( element.dataset.casomerPartial !== undefined
                ? { kind: 'partial', name: element.dataset.casomerPartial }
                : ( element.dataset.casomerTemplate !== undefined ? { kind: 'template', name: element.dataset.casomerTemplate } : undefined ) );

    return { path: element.dataset.casomerBlock ?? null, scope, rect: rectOf( element ), radius: radiusOf( element ) };
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
    // A selection change ends any inline edit outside the new target
    // (a blur may not arrive when focus was never real).
    if ( inlineEl !== null && ( element === null || !element.contains( inlineEl ) ) ) { endInline( true ); }

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

        seamRefresh();
    } );
}

// The seam stays on its boundary when the canvas scrolls under a
// resting pointer (Mikey): the same key, fresh geometry. Recomputing
// from the pointer would hop to whatever boundary slid under it.
function seamRefresh ()
{
    if ( seamKey === null ) { return; }

    const split = seamKey.lastIndexOf( ':' );
    const container = seamKey.slice( 0, split );
    const index = Number( seamKey.slice( split + 1 ) );
    let element = null;

    if ( container === '' ) { element = document.querySelector( 'main' ); }
    else if ( container === 'header' || container === 'footer' ) { element = document.querySelector( `body > ${container}` ); }
    else
    {
        const block = document.querySelector( `[data-casomer-block="${CSS.escape( container )}"]` );

        element = block === null ? null : ( block.querySelector( '[data-casomer-empty]' ) ?? block );
    }

    const candidate = element === null ? undefined : candidatesFor( container, element ).find( ( entry ) => entry.index === index );

    if ( candidate === undefined )
    {
        seamKey = null;
        post( { kind: 'seam-clear' } );
        return;
    }

    post( {
        kind: 'seam',
        container: candidate.container,
        index: candidate.index,
        orientation: candidate.orientation,
        at: candidate.at,
        crossStart: candidate.crossStart,
        crossSize: candidate.crossSize,
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

// Inline text editing (EDITOR 3): a double-click on text inside the
// selected block puts a caret there. A paragraph or heading from a
// markdown field carries its source range (data-casomer-md) and edits
// write back to exactly that range, inline formatting serialized to
// markdown; any other text is a text field, matched by its value.
// Enter in markdown starts a new paragraph; Enter in a text field
// commits; Escape and blur commit too. Structure stays the
// inspector's (the ceiling).
let inlineEl = null;
let lastMorph = Promise.resolve();
let inlineMode = null;
let inlinePath = null;
let inlineCaret = null;

function serializeInline ( node )
{
    let out = '';

    for ( const child of node.childNodes )
    {
        if ( child.nodeType === Node.TEXT_NODE )
        {
            out += child.nodeValue;
            continue;
        }

        if ( child.nodeType !== Node.ELEMENT_NODE ) { continue; }

        const tag = child.tagName;
        const inner = serializeInline( child );

        if ( tag === 'BR' ) { out += '  \n'; }
        else if ( tag === 'STRONG' || tag === 'B' ) { out += inner === '' ? '' : `**${inner}**`; }
        else if ( tag === 'EM' || tag === 'I' ) { out += inner === '' ? '' : `*${inner}*`; }
        else if ( tag === 'CODE' ) { out += inner === '' ? '' : `\`${inner}\``; }
        else if ( tag === 'DEL' || tag === 'S' ) { out += inner === '' ? '' : `~~${inner}~~`; }
        else if ( tag === 'A' ) { out += `[${inner}](${child.getAttribute( 'href' ) ?? ''})`; }
        else { out += inner; }
    }

    return out;
}

function inlineSplitAtCaret ()
{
    const selection = window.getSelection();

    if ( selection === null || selection.rangeCount === 0 || inlineEl === null ) { return null; }

    const caret = selection.getRangeAt( 0 );
    const before = document.createRange();
    const after = document.createRange();

    before.setStart( inlineEl, 0 );
    before.setEnd( caret.startContainer, caret.startOffset );
    after.setStart( caret.endContainer, caret.endOffset );
    after.setEnd( inlineEl, inlineEl.childNodes.length );

    return { before: serializeInline( before.cloneContents() ), after: serializeInline( after.cloneContents() ) };
}

function inlineReport ()
{
    if ( inlineEl === null ) { return; }

    post( {
        kind: 'inline-input',
        path: inlinePath,
        mode: inlineMode,
        text: inlineEl.textContent,
        markdown: inlineMode === 'markdown' ? serializeInline( inlineEl ) : undefined,
    } );
}

function inlineKey ( event )
{
    if ( inlineEl === null ) { return; }

    if ( event.key === 'Escape' )
    {
        event.preventDefault();
        inlineEl.blur();
        return;
    }

    if ( event.key === 'Enter' && !event.shiftKey )
    {
        event.preventDefault();

        if ( inlineMode === 'text' )
        {
            inlineEl.blur();
            return;
        }

        const split = inlineSplitAtCaret();

        if ( split !== null ) { post( { kind: 'inline-split', path: inlinePath, ...split } ); }

        endInline( false );
    }
}

function endInline ( report = true )
{
    const element = inlineEl;

    if ( element === null ) { return; }

    inlineEl = null;
    element.removeAttribute( 'contenteditable' );
    element.removeEventListener( 'input', inlineReport );
    element.removeEventListener( 'keydown', inlineKey );
    element.removeEventListener( 'blur', onInlineBlur );

    if ( report ) { post( { kind: 'inline-end', path: inlinePath } ); }

    inlinePath = null;
    inlineMode = null;
}

function onInlineBlur ()
{
    endInline( true );
}

function beginInline ( element, mode, path, caret )
{
    endInline( true );
    inlineEl = element;
    inlineMode = mode;
    inlinePath = path;
    element.setAttribute( 'contenteditable', mode === 'text' ? 'plaintext-only' : 'true' );
    element.addEventListener( 'input', inlineReport );
    element.addEventListener( 'keydown', inlineKey );
    element.addEventListener( 'blur', onInlineBlur );
    element.focus( { preventScroll: true } );

    const selection = window.getSelection();

    if ( selection !== null && caret !== null )
    {
        selection.removeAllRanges();
        selection.addRange( caret );
    }
}

function inlineStartAt ( event )
{
    if ( !( event.target instanceof Element ) || selected === null || !selected.contains( event.target ) ) { return; }
    if ( inlineEl !== null && inlineEl.contains( event.target ) ) { return; }
    if ( selected.dataset.casomerBlock === undefined ) { return; }

    const mapped = event.target.closest( '[data-casomer-md]' );
    const element = mapped !== null && selected.contains( mapped ) ? mapped : event.target;

    inlineCaret = document.caretRangeFromPoint?.( event.clientX, event.clientY ) ?? null;

    post( {
        kind: 'inline-start',
        path: selected.dataset.casomerBlock,
        mode: mapped !== null && selected.contains( mapped ) ? 'markdown' : 'text',
        range: mapped?.dataset.casomerMd ?? null,
        text: element.textContent,
    } );

    inlineEl = null;
    window.__casomerInlineCandidate = element;
}

document.addEventListener( 'click', ( event ) =>
{
    // A click inside the live inline edit is the caret's, not ours.
    if ( inlineEl !== null && event.target instanceof Node && inlineEl.contains( event.target ) ) { return; }

    event.preventDefault();
    event.stopPropagation();

    const block = blockAt( event.target );

    if ( block !== null )
    {
        // One click selects the block; one more, on its text, edits
        // in place (EDITOR 3, Mikey: single click once selected).
        if ( block === selected && event.target instanceof Element ) { inlineStartAt( event ); }
        else { select( block ); }

        return;
    }

    // Chrome and layout on a page canvas (EDITOR 2): a click on a
    // partial's content or a template's own block SELECTS it as a
    // scope; the sidebar offers the canvas that owns it. The partial
    // wins when both apply (it is inside).
    const partial = event.target instanceof Element ? event.target.closest( '[data-casomer-partial]' ) : null;
    const template = event.target instanceof Element ? event.target.closest( '[data-casomer-template]' ) : null;

    if ( partial !== null && partial.dataset.casomerPartial !== undefined )
    {
        select( partial );
        return;
    }

    if ( template !== null && typeof template.dataset.casomerTemplate === 'string' && template.dataset.casomerTemplate !== '' )
    {
        select( template );
        return;
    }

    select( null );
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
[contenteditable]:focus {
    outline: none;
}

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

// The template canvas (SCHEMA 12.6): the content slot fades and wears
// a centered stamp - it is the page's, not the template's - and an
// empty header or footer keeps a ghost box with its name so its
// seams stay reachable. Selection passes through the slot.
const templateStyle = document.createElement( 'style' );
const slotStamp = encodeURIComponent( '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="6" y="8" width="36" height="32" rx="6" stroke="#E8A13D" stroke-width="2.4"/><path d="M14 18h20M14 25h20M14 32h12" stroke="#E8A13D" stroke-width="2.4" stroke-linecap="round"/></svg>' );

templateStyle.textContent = `
body[data-casomer-template] [data-casomer-slot] {
    position: relative;
    min-height: 96px;
    cursor: default;
}

body[data-casomer-template] [data-casomer-slot] > * {
    opacity: 0.38;
    filter: saturate(0.55);
    pointer-events: none;
}

body[data-casomer-template] [data-casomer-slot]::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(-45deg, rgba(232, 161, 61, 0.16) 0 2px, transparent 2px 16px);
    pointer-events: none;
}

body[data-casomer-template] [data-casomer-slot]::after {
    content: '';
    position: absolute;
    inset: 0;
    background: url("data:image/svg+xml,${slotStamp}") center / 48px 48px no-repeat;
    pointer-events: none;
}

body[data-casomer-template] > [data-casomer-part]:empty {
    min-height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: 1px dashed rgba(163, 158, 143, 0.7);
    outline-offset: -1px;
}

body[data-casomer-template] > [data-casomer-part]:empty::before {
    content: attr(data-casomer-part);
    font: 600 11px/1 system-ui, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #A39E8F;
}
`;
document.head.append( templateStyle );

// The hover cue (Mikey, 2026-09-03): over anything selectable the
// pointer is a hand - a click selects - and stays a hand on the
// selected block until a click there starts inline editing, when the
// text cursor takes over. A block on the move dims in place; the
// seam says where it lands.
const cueStyle = document.createElement( 'style' );

cueStyle.textContent = `
[data-casomer-block], [data-casomer-partial], [data-casomer-template] { cursor: pointer; }
[contenteditable="true"], [contenteditable="true"] * { cursor: text; }
[data-casomer-dragging] { opacity: 0.4; transition: opacity 120ms ease; }
`;
document.head.append( cueStyle );

function directChildBlocks ( containerPath )
{
    // A template canvas's chrome parts address as header[i] and
    // footer[i] (SCHEMA 12.6): their root container IS the part name.
    const prefix = containerPath === '' ? 'blocks[' : ( containerPath === 'header' || containerPath === 'footer' ? `${containerPath}[` : `${containerPath}.blocks[` );
    const shape = new RegExp( `^${prefix.replace( /[.[\]]/g, '\\$&' )}\\d+\\]$` );

    // A template canvas's content slot is a sibling for seam purposes
    // (a plus above and below it insert into the template's layout),
    // never a selectable block.
    return [ ...document.querySelectorAll( '[data-casomer-block], [data-casomer-slot]' ) ]
        .filter( ( element ) => shape.test( element.dataset.casomerBlock ?? element.dataset.casomerSlot ?? '' ) );
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

            // A horizontal seam's cross axis is x: the pointer must be
            // within the box's width, not its height (the empty footer's
            // seam was unreachable at any x outside its y range).
            crossLow: box.left,
            crossHigh: box.right,
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

    // On a template canvas the header and footer are surfaces of
    // their own: root seams inside each landmark, when it is marked.
    for ( const part of [ 'header', 'footer' ] )
    {
        const landmark = document.querySelector( `body > ${part}` );

        if ( landmark !== null && document.body.hasAttribute( 'data-casomer-template' ) )
        {
            candidates.push( ...candidatesFor( part, landmark ) );
        }
    }

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

    // A block on the move (the chrome holds the pointer): it dims in
    // place, the seam follows the chrome's point, the edges scroll.
    if ( message.kind === 'drag-start' )
    {
        const moving = document.querySelector( `[data-casomer-block="${CSS.escape( message.path )}"]` );

        if ( moving instanceof Element ) { moving.setAttribute( 'data-casomer-dragging', '' ); }
    }

    if ( message.kind === 'drag-at' )
    {
        const edge = 48;
        const step = 14;

        if ( message.y < edge && window.scrollY > 0 ) { window.scrollBy( 0, -step ); }
        else if ( message.y > window.innerHeight - edge ) { window.scrollBy( 0, step ); }

        seamKey = null;
        reportSeam( message.x, message.y );
    }

    if ( message.kind === 'drag-end' )
    {
        for ( const element of document.querySelectorAll( '[data-casomer-dragging]' ) ) { element.removeAttribute( 'data-casomer-dragging' ); }

        seamKey = null;
        post( { kind: 'seam-clear' } );
    }

    // The chrome matched the double-clicked text to a field (or not).
    if ( message.kind === 'inline-edit' )
    {
        const candidate = window.__casomerInlineCandidate ?? null;

        window.__casomerInlineCandidate = null;

        if ( message.ok === true && candidate instanceof Element && candidate.isConnected )
        {
            beginInline( candidate, message.mode, message.path, inlineCaret );
        }
    }

    // After an Enter split the chrome re-rendered; the new paragraph
    // takes the caret at its start.
    if ( message.kind === 'inline-focus' )
    {
        // The morph that made the new paragraph may still be landing.
        void lastMorph.then( () =>
        {
            const block = document.querySelector( `[data-casomer-block="${CSS.escape( message.path )}"]` );
            const target = block?.querySelector( `[data-casomer-md="${CSS.escape( message.range )}"]` ) ?? null;

            if ( target instanceof Element )
            {
                const caret = document.createRange();

                caret.setStart( target, 0 );
                caret.collapse( true );
                beginInline( target, 'markdown', message.path, caret );
                return;
            }

            post( { kind: 'inline-end', path: message.path } );
        } );
    }
    if ( message.kind === 'ascend' ) { ascend(); }
    if ( message.kind === 'descend' ) { descend(); }

    // A whole-page refresh without a reload: refetch this document,
    // morph the new main over the live one, and re-anchor the
    // selection by its path. Journal steps ride this so the canvas
    // never blanks. Spammed steps coalesce: one refresh in flight,
    // at most one queued behind it, and the last always runs against
    // the newest content.
    if ( message.kind === 'refresh' )
    {
        endInline( true );
        requestRefresh();
    }

    // Per-keystroke updates (DEVELOPMENT section 5): the chrome sends
    // the block's re-rendered INNER html; morph merges it under the
    // marker wrapper, so the marker survives and Alpine state, focus,
    // and scroll do too. Geometry re-reports because the size changed.
    if ( message.kind === 'morph-block' )
    {
        const target = document.querySelector( `[data-casomer-block="${CSS.escape( message.path )}"]` );

        if ( target?.firstElementChild instanceof Element )
        {
            lastMorph = morphInto( target.firstElementChild, message.html ).then( () => queueUpdate() );
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
