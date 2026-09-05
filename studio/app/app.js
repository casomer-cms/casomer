// The Studio chrome: Alpine inside and out (DEVELOPMENT section 2).
// No build step; this module and the markup in index.html are served
// as they sit here. Logic lives in Alpine.data factories, never in
// x-data blobs; every markup expression is verified by npm run checks.

import { t } from './strings.js';

// Tree rows (menu items, terms) indent by depth: an inset, then one
// unit per level. One formula serves the Alpine rows and the drag
// helpers below, which read depth off the DOM rather than reaching
// into Alpine scope.
const TREE_INSET = 18;
const TREE_INDENT = 22;

// The drop slot's outline starts this far in at the top level (the
// row's grip sits just inside it) and steps in with the depth.
const TREE_SLOT_INSET = 10;

// The list card's corner radius (rounded-xl): the rows at the slot's
// edges wear it, and the pane color bleeds this far under them.
const TREE_EDGE_RADIUS = 12;

// Island classes with no churn: only touched when they change,
// since every pointer move runs the preview. Scoped to the card, as
// the header can be an island edge too.
function setIsland ( card, members, islandClass )
{
    for ( const stale of card.querySelectorAll( `.${islandClass}` ) )
    {
        if ( !members.has( stale ) ) { stale.classList.remove( islandClass ); }
    }

    for ( const member of members )
    {
        if ( !member.classList.contains( islandClass ) ) { member.classList.add( islandClass ); }
    }
}

function treeRowIndent ( depth )
{
    return `${TREE_INSET + depth * TREE_INDENT}px`;
}

// ---- Sortable lists in flight (UI.md section 1) ----
// Every [data-sort-list] - fields, terms, entries, the menu tree -
// shares the drag-time treatment below: the slot as an absence, the
// islands, the echo, the card's shadow fading. [data-sort-card] is
// the list's card and [data-sort-header] the card's header, when it
// has one. Only the menu tree ([data-menu-tree]) is hierarchical: its
// rows carry data-depth, so only there a family collapses, the slot
// previews a landing depth, and a sideways pull nests.
let pointerX = 0;

function listOf ( el )
{
    return el.closest( '[data-sort-list]' );
}

function cardOf ( list )
{
    return list.closest( '[data-sort-card]' );
}

// Neighbours are rows only: the echo, or an x-for template, is not.
function rowOrNull ( el )
{
    return el !== null && el.dataset?.sortId !== undefined ? el : null;
}

function slotSlot ()
{
    return document.querySelector( '[data-sort-list] .sort-drop-slot' );
}

// The slot's preview. For the menu tree (rows with data-depth) it
// picks the landing depth (sortMenuRows applies the same rule to the
// data): the pointer's horizontal pull since the grab picks a level,
// one per indent unit, clamped to what the slot allows - no
// shallower than the row beneath (that row keeps its parent), no
// deeper than one under the row above (its last child, or first
// child when the row beneath is its child). Pulled left the unit
// sits at the top level; pulled right it nests under the item above.
// The pick rides on the row as data-drop-depth for the drop handler.
// For every list it then sets the islands: the list splits at the
// gap, every island's bottom row (the row above the gap, or the card
// header when the slot sits first, and the last row of the list)
// wears the card's bottom edge, the row below the gap wears a top
// edge (so does the first row of a header-less list), and the pane color bleeds one radius under each neighbour of
// the gap, which is what shows in their rounded corners.
function previewSlot ( slot )
{
    let above = slot.previousElementSibling;
    let below = slot.nextElementSibling;

    while ( above !== null && above.classList.contains( 'sort-family-hidden' ) ) { above = above.previousElementSibling; }
    while ( below !== null && below.classList.contains( 'sort-family-hidden' ) ) { below = below.nextElementSibling; }

    above = rowOrNull( above );
    below = rowOrNull( below );

    if ( slot.dataset.depth !== undefined )
    {
        const min = below === null ? 0 : Number( below.dataset.depth );
        const max = above === null ? 0 : Number( above.dataset.depth ) + 1;
        const pulled = Math.round( ( pointerX - Number( slot.dataset.startX ?? pointerX ) ) / TREE_INDENT );
        const depth = Math.min( max, Math.max( min, Number( slot.dataset.depth ) + pulled ) );
        const mark = slot.querySelector( '[data-depth-mark]' );

        slot.dataset.dropDepth = String( depth );
        slot.style.paddingLeft = treeRowIndent( depth );
        slot.style.setProperty( '--slot-inset', `${TREE_SLOT_INSET + depth * TREE_INDENT}px` );

        if ( mark !== null ) { mark.style.display = depth > 0 ? '' : 'none'; }
    }

    const list = listOf( slot );
    const card = cardOf( list );
    const header = card.querySelector( '[data-sort-header]' );
    const visible = [ ...list.querySelectorAll( '[data-sort-id]' ) ].filter( ( row ) => row !== slot && !row.classList.contains( 'sort-family-hidden' ) );
    const last = visible.at( -1 ) ?? null;
    const bottoms = new Set( [ above ?? header, ...below === null ? [] : [ last ] ].filter( ( el ) => el !== null ) );
    // A header-less list has no header to wear the card's top
    // corners while the clip is open, so its first row does (Mikey,
    // 2026-09-03) - the slot's neighbour below, or the top of the
    // upper island.
    const first = header === null ? ( visible[ 0 ] ?? null ) : null;
    const tops = new Set( [ ...below === null ? [] : [ below ], ...first === null ? [] : [ first ] ] );

    setIsland( card, bottoms, 'sort-island-bottom' );
    setIsland( card, tops, 'sort-island-top' );
    slot.style.setProperty( '--bleed-top', above === null ? '0' : `${-TREE_EDGE_RADIUS}px` );
    slot.style.setProperty( '--bleed-bottom', below === null ? '0' : `${-TREE_EDGE_RADIUS}px` );
}

// Where the slot last sat, relative to its list (scroll-proof), and
// the echo it leaves behind when it jumps: the slot does not animate
// (see the stylesheet), so its old spot would show card surface a
// beat before the incoming row slides in - the echo keeps that spot
// pane-colored under the rows for the length of Sortable's slide.
let lastSlotTop = null;
let settleTimer = null;
const SLOT_ECHO_MS = 260;

function slotTopIn ( list, slot )
{
    return slot.getBoundingClientRect().top - list.getBoundingClientRect().top;
}

function echoSlotMove ( slot )
{
    const list = listOf( slot );
    const top = slotTopIn( list, slot );

    if ( lastSlotTop !== null && Math.abs( top - lastSlotTop ) > 1 )
    {
        const echo = document.createElement( 'div' );

        echo.className = 'sort-slot-echo';
        echo.style.top = `${lastSlotTop}px`;
        echo.style.height = `${slot.getBoundingClientRect().height}px`;
        list.append( echo );
        setTimeout( () => echo.remove(), SLOT_ECHO_MS );

        // The outline hides for the slide and fades back after.
        slot.classList.add( 'sort-slot-settling' );
        clearTimeout( settleTimer );
        settleTimer = setTimeout( () => slot.classList.remove( 'sort-slot-settling' ), SLOT_ECHO_MS );
    }

    lastSlotTop = top;
}

// The slot's row, back to its resting state after the drag: its own
// indent (tree rows), its own height, no outline inset, no islands,
// no echoes. A drop that changed nothing keeps this row on screen,
// so the reset is not optional.
function resetSlot ( row )
{
    if ( row.dataset.depth !== undefined )
    {
        const depth = Number( row.dataset.depth );
        const mark = row.querySelector( '[data-depth-mark]' );

        row.style.paddingLeft = treeRowIndent( depth );
        row.style.removeProperty( '--slot-inset' );

        if ( mark !== null ) { mark.style.display = depth > 0 ? '' : 'none'; }
    }

    row.style.height = '';
    row.style.removeProperty( '--bleed-top' );
    row.style.removeProperty( '--bleed-bottom' );

    const list = listOf( row );

    if ( list !== null )
    {
        // A list outside a card (none today; every sortable wraps in
        // [data-sort-card]) still resets cleanly.
        if ( cardOf( list ) !== null )
        {
            setIsland( cardOf( list ), new Set(), 'sort-island-bottom' );
            setIsland( cardOf( list ), new Set(), 'sort-island-top' );
        }

        for ( const echo of list.querySelectorAll( '.sort-slot-echo' ) ) { echo.remove(); }
    }

    clearTimeout( settleTimer );
    row.classList.remove( 'sort-slot-settling' );
    lastSlotTop = null;
}

// A row's family: the following rows with greater depth. Read from
// the DOM in row order, so it holds before the drag starts moving
// anything. Rows without data-depth (the flat lists) have none.
function familyOf ( row )
{
    const depth = Number( row.dataset.depth );
    const family = [];
    let next = row.nextElementSibling;

    while ( next !== null && Number( next.dataset?.depth ?? 'NaN' ) > depth )
    {
        family.push( next );
        next = next.nextElementSibling;
    }

    return family;
}

// The drag clone is a copy of a live Alpine row: its x-text and
// x-sort attributes have no valid scope on <body>, so Alpine firing
// on it blanks the text and its errors disrupt Sortable's
// positioning (the yw-webapp gotcha). The observer catches the clone
// the moment it appears, rebuilds its content from the still-rendered
// source row, and strips every directive so Alpine leaves it alone.
// A menu family rides in the clone whole - the parent row over its
// collapsed descendants, every row at the indent it had in the list
// (Mikey: the grab point must stay under the cursor, so a nested
// family's grip lines up where it was grabbed) - so the thing on the
// cursor is the thing that moves.
if ( typeof MutationObserver !== 'undefined' )
{
    // The pointer's x drives the slot's depth preview; the capture
    // listener sees the grab before Sortable marks the row chosen.
    document.addEventListener( 'pointerdown', ( event ) => { pointerX = event.clientX; }, true );

    // A press on a sortable row starts a native text selection before
    // Sortable engages, and the selection then smears across the page
    // as the pointer travels (Mikey). The press's default goes, unless
    // it lands on something that takes focus or edits.
    document.addEventListener( 'mousedown', ( event ) =>
    {
        const row = event.target?.closest?.( '[x-sort\\:item]' );
        const editable = event.target?.closest?.( 'input, textarea, select, [contenteditable]' );

        if ( event.button === 0 && row !== null && row !== undefined && editable === null ) { event.preventDefault(); }
    } );
    document.addEventListener( 'pointermove', ( event ) =>
    {
        pointerX = event.clientX;

        const slot = slotSlot();

        if ( slot !== null ) { previewSlot( slot ); }
    }, { passive: true } );

    new MutationObserver( ( mutations ) =>
    {
        for ( const mutation of mutations )
        {
            for ( const node of mutation.addedNodes )
            {
                if ( node.nodeType !== 1 || !node.classList?.contains( 'sort-drag-clone' ) ) { continue; }

                // The family comes from the rows' depths, not the
                // hidden class: Sortable appends the clone in the same
                // task that marks the slot, and this observer runs
                // before the class observer has collapsed anything.
                const source = document.querySelector( '.sortable-chosen' );
                const family = source !== null && listOf( source ) !== null ? familyOf( source ) : [];

                if ( source !== null && source.tagName === 'TR' )
                {
                    const table = document.createElement( 'table' );
                    const body = document.createElement( 'tbody' );
                    const columns = document.createElement( 'colgroup' );

                    table.className = 'sort-clone-table';

                    for ( const cell of source.children )
                    {
                        const column = document.createElement( 'col' );

                        column.style.width = cell.getBoundingClientRect().width + 'px';
                        columns.append( column );
                    }

                    for ( const [ index, row ] of [ source, ...family ].entries() )
                    {
                        const copy = document.createElement( 'tr' );

                        copy.className = row.className;
                        copy.classList.remove( 'sort-family-hidden', 'sortable-chosen', 'sort-drop-slot' );

                        if ( index === 0 ) { copy.classList.remove( 'border-t' ); }

                        copy.innerHTML = row.innerHTML;
                        body.append( copy );
                    }

                    table.append( columns, body );
                    node.classList.add( 'sort-family-clone' );
                    node.innerHTML = '';
                    node.append( table );
                }
                else if ( source !== null && family.length === 0 ) { node.innerHTML = source.innerHTML; }

                if ( source !== null && source.tagName !== 'TR' && family.length > 0 )
                {
                    node.classList.add( 'sort-family-clone' );
                    node.innerHTML = '';

                    for ( const [ index, row ] of [ source, ...family ].entries() )
                    {
                        const copy = document.createElement( 'div' );

                        copy.className = row.className;
                        copy.classList.remove( 'sort-family-hidden', 'sortable-chosen', 'sort-drop-slot' );

                        if ( index === 0 ) { copy.classList.remove( 'border-t' ); }

                        copy.style.paddingLeft = treeRowIndent( Number( row.dataset.depth ) );
                        copy.innerHTML = row.innerHTML;
                        node.append( copy );
                    }
                }

                for ( const el of [ node, ...node.querySelectorAll( '*' ) ] )
                {
                    for ( const attribute of [ ...el.attributes ] )
                    {
                        if ( /^(x-|[:@])/.test( attribute.name ) || attribute.name === 'data-sort-id' )
                        {
                            el.removeAttribute( attribute.name );
                        }
                    }
                }
            }
        }

        // Sortable moves the slot row through the list (a childList
        // mutation each time); the preview follows it, and the echo
        // covers the spot it left.
        const slot = slotSlot();

        if ( slot !== null )
        {
            echoSlotMove( slot );
            previewSlot( slot );
        }
    } ).observe( document.documentElement, { childList: true, subtree: true } );

    // The drag starts when Sortable marks the row as the slot - on
    // the first pointer move, not on the press. Then the slot takes
    // its height (a menu family's descendants, the following rows
    // with greater depth, collapse out of the list and the slot takes
    // the family's summed height, so the list does not jump and the
    // gap is the size of what fills it; they reappear when the choice
    // releases) and the preview runs. Nothing happens on the press
    // itself: a still press once collapsed the family and left a tall
    // centered row on screen until the first move (Mikey's
    // half-second jar). Depth comes from the rows' own data
    // attributes, so this needs no reach into Alpine scope, and no
    // Sortable config handlers are overridden (the sort plugin owns
    // onStart/onEnd).
    new MutationObserver( ( mutations ) =>
    {
        for ( const mutation of mutations )
        {
            const row = mutation.target;

            if ( row.nodeType !== 1 || row.dataset?.sortId === undefined || listOf( row ) === null ) { continue; }

            const had = ( mutation.oldValue ?? '' ).includes( 'sortable-chosen' );
            const has = row.classList.contains( 'sortable-chosen' );

            if ( !had && has )
            {
                // A selection the press started (or one left over)
                // would smear across the rows as the pointer travels.
                window.getSelection()?.removeAllRanges();
                row.dataset.startX = String( pointerX );
                delete row.dataset.dropDepth;
                delete row.dataset.dropped;
            }

            if ( had && !has )
            {
                for ( const hidden of listOf( row ).querySelectorAll( '.sort-family-hidden' ) )
                {
                    hidden.classList.remove( 'sort-family-hidden' );
                }

                resetSlot( row );

                // A tree row released in its own slot fires no sort
                // event (Sortable sees no index change), so a
                // sideways pull there - a depth change alone - lands
                // through the tree's own drop event instead. Rows the
                // sort event already handled are marked dropped.
                if ( row.closest( '[data-sort-tree]' ) !== null && row.dataset.dropped === undefined && row.dataset.dropDepth !== undefined && row.dataset.dropDepth !== row.dataset.depth )
                {
                    row.closest( '[data-sort-tree]' ).dispatchEvent( new CustomEvent( 'tree-drop', { detail: row.dataset.sortId } ) );
                }
            }

            if ( !( mutation.oldValue ?? '' ).includes( 'sort-drop-slot' ) && row.classList.contains( 'sort-drop-slot' ) )
            {
                let height = row.getBoundingClientRect().height;

                for ( const next of familyOf( row ) )
                {
                    height += next.getBoundingClientRect().height;
                    next.classList.add( 'sort-family-hidden' );
                }

                row.style.height = `${height}px`;
                lastSlotTop = slotTopIn( listOf( row ), row );
                previewSlot( row );
            }
        }
    } ).observe( document.documentElement, { subtree: true, attributes: true, attributeFilter: [ 'class' ], attributeOldValue: true } );
}

// Catalog entries may carry {placeholders}; this fills them. Count
// keys get a singular sibling under "<key>One" when one exists.
function tFill ( key, values )
{
    let text = t( key );

    for ( const [ name, value ] of Object.entries( values ) )
    {
        text = text.replaceAll( `{${name}}`, String( value ) );
    }

    return text;
}

function tCount ( key, count )
{
    if ( count === 1 && t( `${key}One` ) !== `${key}One` ) { return t( `${key}One` ); }

    return tFill( key, { n: count } );
}

// A minimal showWhen evaluator for manifest condition sources. The
// full expression evaluator arrives with the canvas engine bundle
// (DEVELOPMENT section 6.1); equality covers the shipped manifests.
function evalCondition ( source, values )
{
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*"([^"]*)"$/.exec( source.trim() );

    if ( match === null ) { return true; }

    const [ , key, operator, literal ] = match;

    return operator === '==' ? values[ key ] === literal : values[ key ] !== literal;
}

// A prop value of { "$bind": "entry.x" } is a binding (SCHEMA 13.5).
// The chrome resolves it against a sample entry for the local morph;
// the server resolves the real thing.
function isBindValue ( value )
{
    return value !== null && typeof value === 'object' && !Array.isArray( value ) && typeof value.$bind === 'string';
}

function resolveBoundProps ( value, scope )
{
    if ( Array.isArray( value ) ) { return value.map( ( item ) => resolveBoundProps( item, scope ) ); }

    if ( value !== null && typeof value === 'object' )
    {
        if ( isBindValue( value ) )
        {
            let current = { entry: scope, term: scope };

            for ( const segment of value.$bind.split( '.' ) )
            {
                current = current === null || typeof current !== 'object' ? undefined : current[ segment ];
            }

            // Presented references travel as String objects for
            // bind-through traversal; callers get the primitive.
            return current instanceof String ? String( current ) : current;
        }

        return Object.fromEntries( Object.entries( value ).map( ( [ key, item ] ) => [ key, resolveBoundProps( item, scope ) ] ) );
    }

    // Inline interpolation, mirrored from the server resolver: the
    // "{{ $" marker, the same path vocabulary. Local morphs know only
    // the sample entry/term scope; $page and $site tokens substitute
    // empty here and the server render corrects them.
    if ( typeof value === 'string' && value.includes( '{{' ) )
    {
        return value.replace( /\{\{\s*\$((?:entry|term|page|site)(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\}\}/g, ( match, path ) =>
        {
            let current = { entry: scope, term: scope };

            for ( const segment of path.split( '.' ) )
            {
                current = current === null || typeof current !== 'object' ? undefined : current[ segment ];
            }

            return current === undefined || current === null ? '' : String( current );
        } );
    }

    return value;
}

// The wiring UI offers only type-compatible fields (SCHEMA 13.5):
// an image prop lists image fields, text-shaped props list every
// field that can speak as text (markdown is just text - Mikey), and
// select/toggle/list props stay literal-only. References qualify as
// text: they present as their target's name.
const bindCompatibility = {
    text: [ 'text', 'textarea', 'select', 'date', 'number', 'url', 'email', 'reference' ],
    textarea: [ 'textarea', 'text', 'markdown', 'select', 'date', 'number', 'url', 'email', 'reference' ],
    markdown: [ 'markdown', 'textarea', 'text', 'select', 'date', 'number', 'url', 'email', 'reference' ],
    url: [ 'url', 'text' ],
    email: [ 'email', 'text' ],
    number: [ 'number' ],
    date: [ 'date' ],
    image: [ 'image' ],
};

function compatibleFieldKeys ( propType, entryFields )
{
    const allowed = bindCompatibility[ propType ] ?? [];

    return Object.entries( entryFields ?? {} )
        .filter( ( [ , field ] ) => allowed.includes( field.type ) )
        .map( ( [ key ] ) => key );
}

// A hierarchical taxonomy's terms in tree order, each with its depth:
// roots in stored order, children walked directly after their parent.
// Terms whose parent id resolves to nothing sit at the top level.
function termTree ( terms )
{
    const childrenOf = new Map();
    const roots = [];

    for ( const term of terms )
    {
        if ( term.parent !== undefined && terms.some( ( candidate ) => candidate.id === term.parent ) )
        {
            if ( !childrenOf.has( term.parent ) ) { childrenOf.set( term.parent, [] ); }

            childrenOf.get( term.parent ).push( term );
        }
        else { roots.push( term ); }
    }

    const ordered = [];
    const walk = ( term, depth ) =>
    {
        ordered.push( { term, depth } );

        for ( const child of childrenOf.get( term.id ) ?? [] ) { walk( child, depth + 1 ); }
    };

    for ( const root of roots ) { walk( root, 0 ); }

    return ordered;
}

function emptyValueFor ( field )
{
    if ( field.defaultValue !== undefined ) { return structuredClone( field.defaultValue ); }
    if ( field.type === 'reference' && field.rules?.multiple === true ) { return []; }

    switch ( field.type )
    {
        case 'toggle': return false;
        case 'list': return [];
        case 'image': return null;
        default: return '';
    }
}

// Block renderers cache by component reference: one parsed template
// serves every block of that component. Kept outside Alpine's
// reactivity on purpose - a template AST gains nothing from proxies.
const blockRenderers = new Map();
let enginePromise = null;

async function rendererFor ( reference, fields, templateText )
{
    if ( blockRenderers.has( reference ) ) { return blockRenderers.get( reference ); }

    enginePromise = enginePromise ?? import( '/engine.js' );

    const engine = await enginePromise;
    const renderer = engine.createBlockRenderer( fields, templateText );

    blockRenderers.set( reference, renderer );
    return renderer;
}

// A press that starts in one place and releases in another is a drag
// (a text selection swept out of a field, say), not a click. The
// browser still fires a click on the common ancestor - for a modal
// that is its veil, for a popover whatever lies outside it - so the
// modal or menu closed the moment a selection ended past its edge
// (Mikey, 2026-09-03). Two rules, applied before any handler sees
// the click: a veil dismisses only when the press began on the veil
// itself, and a press that began in a text field is never a click on
// anything else.
let pressTarget = null;

document.addEventListener( 'mousedown', ( event ) => { pressTarget = event.target; }, true );
document.addEventListener( 'click', ( event ) =>
{
    const target = event.target;
    const pressed = pressTarget;

    pressTarget = null;

    if ( !( target instanceof Element ) || pressed === null || pressed === target ) { return; }

    const veil = target.classList.contains( 'bg-veil' );
    const field = pressed instanceof Element && pressed.closest( 'input, textarea, [contenteditable]' ) !== null;

    if ( veil || field ) { event.stopPropagation(); }
}, true );

// Text to the clipboard: the async API where the page may use it,
// else the selection-and-copy fallback (an http://localhost tab and a
// blocked permission both land there).
async function copyText ( text )
{
    try
    {
        if ( navigator.clipboard !== undefined )
        {
            await navigator.clipboard.writeText( text );
            return;
        }
    }
    catch
    {
        /* falls through to the selection copy */
    }

    const area = document.createElement( 'textarea' );

    area.value = text;
    area.setAttribute( 'readonly', '' );
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild( area );
    area.select();

    try { document.execCommand( 'copy' ); }
    catch { /* nothing to do: the tag stays visible to copy by hand */ }

    area.remove();
}

document.addEventListener( 'alpine:init', () =>
{
    const Alpine = window.Alpine;

    Alpine.magic( 't', () => t );

    // x-component="template-id": stamp a named template into the
    // element. Children appended while Alpine walks the element are
    // not walked themselves, so stamp after the pass settles and
    // initialize each child against the inherited scope chain.
    Alpine.directive( 'component', ( el, { expression } ) =>
    {
        if ( el.__casomerStamped === true ) { return; }

        el.__casomerStamped = true;

        const template = document.getElementById( expression );
        const content = template.content.cloneNode( true );

        queueMicrotask( () =>
        {
            el.append( content );

            for ( const child of el.children ) { Alpine.initTree( child ); }
        } );
    } );

    Alpine.data( 'studio', () => ( {
        booting: true,
        snapshot: null,
        error: null,
        selectedPageId: null,
        viewport: 'desktop',
        themeDark: document.documentElement?.dataset.theme === 'dark',
        themeTick: 0,
        palette: null,
        contentVersion: 0,
        selectedBlock: null,
        selectionRect: null,
        selectionRadius: 2,
        hoverChain: [],
        tab: 'content',
        blockEditor: null,
        dirty: 0,
        saveTimer: null,
        hoverClearTimer: null,
        pinnedHandle: null,
        saveState: 'idle',
        publishState: 'idle',
        suppressReloadUntil: 0,
        loadSequence: 0,
        discardOpen: false,
        workspace: 'page',
        workspaceFile: null,
        collectionEditor: null,
        selectedEntryId: null,
        taxonomyEditor: null,
        selectedTermId: null,
        confirmTarget: null,
        confirmRowId: null,
        navCreate: null,
        navCreateLabel: '',
        navCreateIndex: true,
        navCreateError: '',
        navCreateHierarchical: false,
        navCreateFields: [],
        createKind: null,
        createLabel: '',
        createValues: {},
        createFieldDraft: null,
        entrySaveTimer: null,
        themeDraft: null,
        themeSaveTimer: null,
        metaSaveTimer: null,
        surface: null,
        collectionView: 'entries',
        taxonomyView: 'terms',
        selectedFieldKey: null,
        fieldTagCopied: false,
        fieldTagCopiedTimer: null,
        licenseKeyCopied: false,
        licenseKeyCopiedTimer: null,
        fieldsDraft: null,
        fieldsSaveTimer: null,
        fieldsOpChain: null,
        sampleEntryId: null,
        samplePickerOpen: false,
        repeatEditor: null,
        repeatSaveTimer: null,
        seamInfo: null,
        seamPinned: false,
        seamClearTimer: null,
        pickerOpen: false,
        pickerSwapRepeat: false,
        pickerInsertIndex: 0,
        pickerContainer: '',
        pickerKind: 'component',
        pickerComponents: null,
        pickerQuery: '',
        publishProblems: [],
        publishFailure: null,
        publishConfirmOpen: false,
        licenseKeyDraft: '',
        licenseKeyProblem: false,
        licenseKeyProblemText: '',
        supporterKeyProblem: '',
        publishCard: null,
        publishCardTimer: null,

        // What the last publish said about the stored keys (a revoked
        // one, in the registry's words): the gate modal's line when the
        // window has ended, the card's note otherwise.
        publishNotices: [],
        pendingAbandon: null,
        abandonName: '',
        abandonBypass: false,
        saveConfirmOpen: false,
        saveProblems: [],
        commercialAssentOpen: false,
        hierarchyOffOpen: false,
        renameConfirmOpen: false,
        metaNameGuardOpen: false,
        metaNameGuardFile: null,
        collapsedPages: {},
        sortEpoch: 0,
        siteNameDraft: '',
        siteOriginDraft: '',
        siteOriginTouched: false,
        siteOriginTimer: null,
        siteOriginProblem: false,
        mediaPicker: null,
        mediaLibrary: null,
        mediaTrash: [],
        mediaView: 'library',
        mediaQuery: '',
        mediaBrowse: null,
        selectedMediaFile: null,
        mediaUploading: false,
        mediaLabelTimer: null,
        routePushTimer: null,
        usageRows: null,
        usageTarget: null,
        menuName: null,
        menuEditor: null,
        menuNameDraft: '',
        selectedMenuKey: null,
        menuAddOpen: false,
        menuKeySeq: 0,

        // The page lighting a template canvas's slot (SCHEMA 12.6).
        samplePageId: null,
        canvasFitHeight: 200,
        focusFreshPath: null,
        canvasDrag: null,
        pageTitleDraft: '',
        addressConfirmOpen: false,
        navCollapsed: { pages: false, collections: false, taxonomies: false, site: false },

        // The Pages workspace's view (pages or templates) and the Site
        // workspace's (partials or menus).
        pagesView: 'pages',
        userMenuOpen: false,
        profileOpen: false,
        supporterOpen: false,
        supporterIntroOpen: false,
        supporterKey: '',
        sponsorOpen: false,
        sponsorIntroOpen: false,
        sponsorKey: '',
        sponsorKeyProblem: '',
        avatarVersion: 0,
        profileDraft: { name: '', email: '', github: '' },
        supporterWallOpen: false,
        supporterWallDraft: { name: '', github: '' },

        // A scope selected on a page canvas (a partial, or a template's
        // own block): named in the sidebar with the way to its canvas.
        scopeSelection: null,

        // A create modal closing with something typed asks first
        // (Mikey): which modal is waiting on the answer.
        discardPrompt: null,

        // Named entry layouts (Mikey, 2026-09-02): the layout the shared
        // canvas edits, and the Layouts view's selected row.
        layoutName: 'default',
        layoutsRowName: null,

        // The inline edit in progress on the canvas (EDITOR 3): the
        // block, the field, and for markdown the source range the
        // element owns, kept current as keystrokes land.
        inlineEdit: null,

        // The pages table's selected row (Mikey): rows select into the
        // sidebar; edit opens the canvas.
        pagesRowId: null,
        siteView: 'partials',
        outlineOpen: false,
        outlineItems: [],
        remoteEditOpen: false,
        remoteDraft: '',

        // Connect GitHub (the device flow, held by the server).
        github: { phase: 'idle', userCode: '', verificationUri: '', error: '', repositories: [], installUrl: 'https://github.com/apps/casomer-cms/installations/new' },
        githubRepo: '',
        githubTimer: null,
        githubCodeCopied: false,
        githubCodeCopiedTimer: null,

        // Go live (SCHEMA 12.4): the card's editor, its test, its save.
        deployEditOpen: false,
        deployDraft: { host: '', port: '', user: '', path: '', password: '', keyFile: '' },
        deployTesting: false,
        deployTest: null,
        deployProblem: '',
        deployUploading: false,

        init ()
        {
            // The view survives a reload: the hash is the route, kept
            // current as state changes and re-applied on boot once the
            // site snapshot arrives. The boot veil holds until routing
            // settles - no flash of the default workspace - and stays
            // up a beat so a fast load never blinks it.
            const bootStarted = Date.now();

            void this.refresh().then( async () =>
            {
                await this.applyRoute();

                // Every settled route change is a real history entry
                // (Mikey: "back should work intuitively throughout").
                // Debounced so a compound navigation (enter
                // workspace, then its surface) spends ONE entry on
                // its final route; deduped so popstate landings and
                // reloads never double up.
                this.$watch( 'routeHash', ( hash ) =>
                {
                    clearTimeout( this.routePushTimer );
                    this.routePushTimer = setTimeout( () =>
                    {
                        if ( window.location.hash === hash ) { return; }

                        history.pushState( null, '', hash );
                    }, 80 );
                } );
                history.replaceState( null, '', this.routeHash );

                // Back after a usage jump: the entry we return to
                // carries the exact pre-jump spot; anything else
                // (Forward included) re-applies its route.
                window.addEventListener( 'popstate', ( event ) =>
                {
                    const spot = event.state?.casomerSpot ?? null;

                    if ( spot !== null ) { this.restoreSpot( spot ); }
                    else { void this.applyRoute(); }
                } );
                setTimeout( () =>
                {
                    this.booting = false;
                }, Math.max( 0, 450 - ( Date.now() - bootStarted ) ) );
            } );

            const events = new EventSource( '/api/events' );

            events.onmessage = () =>
            {
                // The canvas already shows our own writes through the
                // morph loop; reloading it for them would only flicker.
                // Anyone else's change (a hand edit, another session)
                // still reloads - including an open data workspace.
                if ( Date.now() >= this.suppressReloadUntil )
                {
                    this.contentVersion += 1;

                    if ( this.workspace === 'collection' ) { void this.loadCollection(); }
                    if ( this.workspace === 'taxonomy' ) { void this.loadTaxonomy(); }
                    if ( this.workspace === 'menu' ) { void this.refresh().then( () => this.syncMenuEditor() ); }
                }

                void this.refresh();
            };

            window.addEventListener( 'message', ( event ) =>
            {
                if ( event.data?.casomerStudio !== true ) { return; }

                if ( event.data.kind === 'size' )
                {
                    // Every canvas carries the bridge, so page canvases
                    // report sizes too - only the partial frame listens,
                    // or a page's height would leak into the next region
                    // visit as a stale tall frame.
                    if ( this.insetCanvasActive && typeof event.data.height === 'number' )
                    {
                        this.canvasFitHeight = Math.max( 96, Math.ceil( event.data.height ) );
                    }

                    return;
                }

                if ( event.data.kind === 'inline-start' )
                {
                    this.inlineStart( event.data );
                    return;
                }

                if ( event.data.kind === 'inline-input' )
                {
                    this.inlineInput( event.data );
                    return;
                }

                if ( event.data.kind === 'inline-split' )
                {
                    void this.inlineSplit( event.data );
                    return;
                }

                if ( event.data.kind === 'inline-end' )
                {
                    this.inlineEnd();
                    return;
                }

                // A click on chrome or layout from a page canvas (EDITOR 2):
                // open what owns it.
                if ( event.data.kind === 'jump' )
                {
                    if ( typeof event.data.partial === 'string' && ( this.snapshot?.partials ?? [] ).includes( event.data.partial ) ) { this.openPartial( event.data.partial ); }
                    else if ( typeof event.data.template === 'string' && this.templateNames.includes( event.data.template ) ) { this.openTemplate( event.data.template ); }

                    return;
                }

                if ( event.data.kind === 'remove-request' )
                {
                    if ( this.selectedBlock !== null && this.confirmTarget === null && this.blockInfoAt( this.selectedBlock )?.kind !== 'slot' ) { this.confirmTarget = 'block'; }

                    return;
                }

                this.onCanvasMessage( event.data );
            } );

            // Cross-session undo (EDITOR section 9, the edit journal):
            // outside text fields, undo and redo step the journal.
            // Inside a field, the browser's own text undo applies.
            window.addEventListener( 'keydown', ( event ) =>
            {
                if ( !( event.ctrlKey || event.metaKey ) || event.key.toLowerCase() !== 'z' ) { return; }

                const target = event.target;
                const editable = target instanceof HTMLElement
                    && ( target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable );

                if ( editable ) { return; }

                event.preventDefault();
                void this.stepJournal( event.shiftKey ? 'redo' : 'undo' );
            } );
        },

        onCanvasMessage ( message )
        {
            if ( message.kind === 'select' && message.scope !== undefined && message.scope !== null )
            {
                this.selectedBlock = null;
                this.blockEditor = null;
                this.repeatEditor = null;
                this.inlineEdit = null;
                this.scopeSelection = message.scope;
                this.selectionRect = message.rect;
                this.selectionRadius = message.radius;
                this.hoverChain = [];
                this.tab = 'content';
                return;
            }

            if ( message.kind === 'select' )
            {
                this.scopeSelection = null;

                // A repeat block lives in repeatEditor, not blockEditor:
                // comparing against the block editor alone made every
                // scroll re-report a "new" selection and refetch the
                // repeat, flickering its inspector (Mikey).
                const changed = message.path !== ( this.blockEditor?.path ?? this.repeatEditor?.path );

                if ( this.focusFreshPath !== null && message.path !== this.focusFreshPath ) { this.focusFreshPath = null; }

                this.selectedBlock = message.path;
                this.selectionRect = message.rect;
                this.selectionRadius = message.radius;
                this.hoverChain = [];

                // A re-select of the same block (the canvas reloading
                // after our own save) keeps the editing state; only a
                // genuinely new selection refetches.
                if ( changed ) { void this.loadBlock( message.path ); }
            }

            // A selection change on the canvas ends any inline edit that
            // was not on the new selection.
            if ( message.kind === 'deselect' || ( message.kind === 'select' && this.inlineEdit !== null && this.inlineEdit.path !== message.path ) ) { this.inlineEdit = null; }

            if ( message.kind === 'deselect' ) { this.applyDeselect(); }
            if ( message.kind === 'undo' || message.kind === 'redo' ) { void this.stepJournal( message.kind ); }
            if ( message.kind === 'palette' ) { this.togglePalette(); }

            // The add-block seam (EDITOR section 2, the AddBlock
            // board): the bridge reports when the pointer rests on a
            // boundary between top-level blocks; clears take a grace
            // period, and the seam pins while the pointer is on its
            // own plus button (which sits outside the iframe).
            if ( message.kind === 'seam' )
            {
                clearTimeout( this.seamClearTimer );
                this.seamInfo = {
                    container: message.container,
                    index: message.index,
                    orientation: message.orientation,
                    at: message.at,
                    crossStart: message.crossStart,
                    crossSize: message.crossSize,
                };
            }

            if ( message.kind === 'seam-clear' )
            {
                clearTimeout( this.seamClearTimer );
                this.seamClearTimer = setTimeout( () =>
                {
                    if ( !this.seamPinned ) { this.seamInfo = null; }
                }, 160 );
            }

            // Hover clears land on a short grace period: crossing the
            // gaps inside a section, or reaching the chrome-side
            // section handle, fires spurious leave/enter pairs that
            // would otherwise flicker the ring and the pill.
            if ( message.kind === 'hover' )
            {
                clearTimeout( this.hoverClearTimer );
                this.hoverChain = message.chain;

                // A pinned pill (the pointer rests on it) follows its
                // section when the canvas scrolls under it (Mikey): the
                // pin keeps the path, the chain brings the fresh rect.
                if ( this.pinnedHandle !== null )
                {
                    const fresh = message.chain.find( ( entry ) => entry.path === this.pinnedHandle.path );

                    if ( fresh !== undefined ) { this.pinnedHandle = fresh; }
                }
            }

            if ( message.kind === 'hover-clear' )
            {
                clearTimeout( this.hoverClearTimer );
                this.hoverClearTimer = setTimeout( () =>
                {
                    this.hoverChain = [];
                }, 120 );
            }
        },

        sendToCanvas ( message )
        {
            this.$refs.canvas?.contentWindow?.postMessage( { casomerStudio: true, ...message }, '*' );
        },

        // The canvas-reported deselect applies locally; only a
        // chrome-initiated clear also commands the canvas, so the two
        // sides never echo each other.
        applyDeselect ()
        {
            this.focusFreshPath = null;
            this.scopeSelection = null;
            this.selectedBlock = null;
            this.selectionRect = null;
            this.hoverChain = [];
            this.pinnedHandle = null;
            this.blockEditor = null;
            this.repeatEditor = null;
        },

        // While the pointer rests on the handle pill itself, the pill
        // stays put: entering it takes the pointer out of the canvas,
        // and without the pin the resulting hover-clear would remove
        // the very control being aimed at.
        pinHandle ()
        {
            this.pinnedHandle = this.sectionHandle;
        },

        unpinHandle ()
        {
            this.pinnedHandle = null;
        },

        selectHandle ()
        {
            const handle = this.sectionHandle;

            if ( handle === null ) { return; }

            this.pinnedHandle = null;
            this.sendToCanvas( { kind: 'select-path', path: handle.path } );
        },

        // An editor remembers the target it was loaded for (blockTarget
        // spread in): the same keys go back out on every write, so a
        // template surface, an entry layout, or a region never falls
        // through to pages.json with no page (edits vanished silently
        // on the template canvas until this).
        targetOfEditor ( editor )
        {
            // The loaded block carries its own "template" (the component's
            // template source), which would shadow a template surface's
            // name in the spread - so the target rides its own key.
            const source = editor.editorTarget ?? editor;
            const target = {};

            for ( const key of [ 'pageId', 'doc', 'surface', 'entry', 'region', 'template' ] )
            {
                if ( source[ key ] !== undefined && source[ key ] !== null ) { target[ key ] = source[ key ]; }
            }

            return target;
        },

        // The target half of every block request: the page, or the
        // collection surface, whichever canvas is up.
        get blockTarget ()
        {
            if ( this.surface === null ) { return { pageId: this.selectedPageId }; }
            if ( this.workspace === 'template' ) { return { template: this.surface }; }
            if ( this.workspace === 'settings' ) { return { region: this.surface }; }
            if ( this.surface === 'entry' ) { return { doc: this.stem, surface: 'entry', entry: this.sampleEntryId }; }
            if ( this.surface === 'template' && ( this.workspace === 'collection' || this.workspace === 'taxonomy' ) ) { return { doc: this.stem, surface: 'template', layout: this.layoutName }; }

            return { doc: this.stem, surface: this.surface };
        },

        async loadBlock ( path )
        {
            this.blockEditor = null;
            this.repeatEditor = null;
            this.loadSequence = ( this.loadSequence ?? 0 ) + 1;

            const sequence = this.loadSequence;
            let kind = this.blockInfoAt( path )?.kind;

            // A freshly inserted block is not in the snapshot yet -
            // the canvas reload beats the refresh here - so an unknown
            // path retries once against fresh data before giving up.
            if ( kind === undefined )
            {
                await this.refresh();

                if ( sequence !== this.loadSequence ) { return; }

                kind = this.blockInfoAt( path )?.kind;
            }

            if ( kind !== 'component' && kind !== 'repeat' && kind !== 'partial' && kind !== 'section' ) { return; }

            const query = this.surface === null
                ? new URLSearchParams( { page: this.selectedPageId, path } )
                : ( this.workspace === 'template'
                        ? new URLSearchParams( { template: this.surface, part: this.partOfPath( path ), path } )
                        : this.workspace === 'settings'
                            ? new URLSearchParams( { region: this.surface, path } )
                            : ( this.surface === 'entry'
                                    ? new URLSearchParams( { doc: this.stem, surface: 'entry', entry: this.sampleEntryId ?? '', path } )
                                    : new URLSearchParams( { doc: this.stem, surface: this.surface, path, ...( this.surface === 'template' && ( this.workspace === 'collection' || this.workspace === 'taxonomy' ) ? { layout: this.layoutName } : {} ) } ) ) );
            const response = await fetch( `/api/block?${query.toString()}` );

            // A newer load superseded this one while it was in flight.
            if ( sequence !== this.loadSequence ) { return; }

            if ( !response.ok ) { return; }

            const loaded = await response.json();

            // A section (SCHEMA 11): the Section inspector edits its
            // record; there are no fields, so no props to seed.
            if ( loaded.kind === 'section' )
            {
                this.blockEditor = { path, editorTarget: this.blockTarget, ...this.blockTarget, ...loaded, section: structuredClone( loaded.section ?? {} ), layout: structuredClone( loaded.layout ?? {} ) };
                return;
            }

            if ( loaded.kind === 'repeat' )
            {
                const repeat = structuredClone( loaded.repeat );

                // The wiring editors write straight into props; the
                // record must exist before a row stamps.
                repeat.props = repeat.props ?? {};
                this.repeatEditor = { path, editorTarget: this.blockTarget, ...this.blockTarget, ...loaded, repeat };
                return;
            }

            const props = structuredClone( loaded.props );

            for ( const [ key, field ] of Object.entries( loaded.fields ) )
            {
                if ( props[ key ] === undefined ) { props[ key ] = emptyValueFor( field ); }
            }

            this.blockEditor = { path, editorTarget: this.blockTarget, ...this.blockTarget, ...loaded, props };

            // Focus lands in the first field only for a NEWLY ADDED
            // block (Mikey's rule): selecting an existing component
            // is inspection, not editing. The marker is a PATH, not a
            // one-shot flag: the post-insert canvas reload re-runs
            // this load and rebuilds the editor, destroying the first
            // focus - so every rebuild of the fresh block refocuses,
            // until the user moves on or the window lapses.
            if ( this.focusFreshPath === path ) { this.focusInspector(); }
        },

        // The pure preview for whatever the canvas shows (Mikey:
        // anywhere there is a preview window, a way to pop the real
        // thing into a new tab). Null hides the button - regions and
        // partials have no standalone visitor page.
        get previewPopUrl ()
        {
            if ( this.workspace === 'pages' && this.pagesRow !== null )
            {
                return this.pagesRow.slug === '404' ? '/preview/--not-found--/' : `/preview${this.pageAddressOf( this.pagesRow.id )}`;
            }

            if ( this.workspace === 'page' && this.surface === null && this.selectedPage !== undefined )
            {
                const segments = this.pagePathOf( this.selectedPage.id );

                return `/preview/${segments.join( '/' )}${segments.length > 0 ? '/' : ''}`;
            }

            if ( this.workspace === 'settings' )
            {
                // Any address no page can own serves the authored
                // 404, status and all.
                return this.surface === 'notFound' ? '/preview/--not-found--/' : null;
            }

            if ( this.workspace === 'page' && this.selectedPage?.slug === '404' )
            {
                return '/preview/--not-found--/';
            }

            if ( this.workspace === 'template' && this.samplePage !== null )
            {
                if ( this.samplePage.slug === '404' ) { return '/preview/--not-found--/'; }

                const segments = this.pagePathOf( this.samplePage.id );

                return `/preview/${segments.join( '/' )}${segments.length > 0 ? '/' : ''}`;
            }

            if ( this.workspace === 'collection' && this.surface !== null )
            {
                if ( this.surface === 'index' )
                {
                    return this.collectionEditor?.index === false ? null : `/preview${this.collectionAddress}`;
                }

                const id = this.surface === 'entry' ? this.sampleEntryId : this.sampleEntry?.id;
                const address = id === undefined || id === null ? null : this.entryAddressOf( id );

                return address === null ? null : `/preview${address}`;
            }

            if ( this.workspace === 'taxonomy' && this.surface !== null )
            {
                if ( this.surface === 'index' )
                {
                    return this.taxonomyEditor?.index === false ? null : `/preview/${this.stem}/`;
                }

                const id = this.sampleTerm?.id;
                const address = id === undefined ? null : this.termAddressOf( id );

                return address === null ? null : `/preview${address}`;
            }

            return null;
        },

        // The Preview button never leaves the top bar (Mikey,
        // 2026-09-03): a view with a preview of its own opens that;
        // anywhere else opens the site's front door, the homepage.
        openPreview ()
        {
            window.open( this.previewPopUrl ?? '/preview/', '_blank' );
        },

        // Save records a version (EDITOR section 9): the edits join
        // history and can be returned to. Publishing is a separate,
        // later act.
        async saveVersion ( force = false )
        {
            if ( this.saveState === 'saving' ) { return; }

            // Save-level validation is a speed bump, not a wall
            // (Mikey's rule + the draft doctrine): incomplete content
            // asks before joining history, and "Save anyway" is always
            // there - a half-finished day is a legitimate version.
            if ( !force )
            {
                const check = await fetch( '/api/problems' );
                const found = check.ok ? ( await check.json() ).problems ?? [] : [];

                if ( found.length > 0 )
                {
                    this.saveProblems = found;
                    this.saveConfirmOpen = true;
                    return;
                }
            }

            this.saveConfirmOpen = false;
            this.saveState = 'saving';

            const response = await fetch( '/api/save', { method: 'POST' } );

            this.saveState = response.ok ? 'saved' : 'idle';
            void this.refresh();

            if ( this.saveState === 'saved' )
            {
                setTimeout( () =>
                {
                    this.saveState = 'idle';
                }, 1600 );
            }
        },

        get saveLabel ()
        {
            return t( this.saveState === 'saved' ? 'saved' : 'save' );
        },

        // The licensing facts (BUSINESS 5.3) the snapshot carries.
        get licensing ()
        {
            return this.snapshot?.licensing ?? { declaredUse: 'personal', phase: 'personal', daysLeft: 14, hasKey: false, siteKey: '' };
        },

        // A commercial site confirms its publish (the grace gate's
        // modal: the countdown, or the key once the window has
        // ended); a personal or licensed site publishes at once.
        get publishNeedsConfirm ()
        {
            return [ 'unstarted', 'grace', 'expired' ].includes( this.licensing.phase );
        },

        get licenseHost ()
        {
            const origin = this.siteOrigin;

            if ( origin !== '' )
            {
                try { return new URL( origin ).host; }
                catch { /* not an address */ }
            }

            return this.folderName;
        },

        get publishChangedLine ()
        {
            const n = ( this.snapshot?.changedPageIds ?? [] ).length;

            return `${tCount( 'publishChangedPages', n )} · ${this.licenseHost}`;
        },

        get graceLine ()
        {
            const state = this.licensing;

            if ( state.phase === 'unstarted' ) { return t( 'graceUnstartedLine' ); }
            if ( state.phase === 'grace' ) { return tCount( 'graceDaysLeft', state.daysLeft ); }
            if ( state.phase === 'expired' ) { return t( 'graceExpiredLine' ); }
            if ( state.phase === 'licensed' ) { return t( 'licenseLicensed' ); }

            return '';
        },

        get licenseKeyReady ()
        {
            return String( this.licenseKeyDraft ?? '' ).trim() !== '';
        },

        // A license binds to its address, so moving domains is a
        // transfer, and transfers go through support (Mikey,
        // 2026-09-03) - the card readies the email, subject and the
        // current binding prefilled, never a self-serve route.
        get licenseTransferMailto ()
        {
            const subject = encodeURIComponent( t( 'licenseTransferSubject' ) );
            const body = encodeURIComponent( tFill( 'licenseTransferBody', { host: this.licenseHost } ) );

            return `mailto:support@casomer.com?subject=${subject}&body=${body}`;
        },

        // The licensed card's copy (Mikey, 2026-09-03): the key comes
        // off this computer's own store on demand, lands on the
        // clipboard, and the button says "Copied" for a moment.
        async copyLicenseKey ()
        {
            const response = await fetch( '/api/license' );

            if ( !response.ok ) { return; }

            const body = await response.json().catch( () => ( {} ) );

            if ( typeof body.key !== 'string' || body.key === '' ) { return; }

            await copyText( body.key );
            this.licenseKeyCopied = true;
            clearTimeout( this.licenseKeyCopiedTimer );
            this.licenseKeyCopiedTimer = setTimeout( () => { this.licenseKeyCopied = false; }, 1400 );
        },

        openPublishConfirm ()
        {
            this.licenseKeyDraft = '';
            this.licenseKeyProblem = false;
            this.publishConfirmOpen = true;
        },

        closePublishConfirm ()
        {
            if ( this.licenseKeyReady ) { this.discardPrompt = 'publishConfirm'; }
            else { this.publishConfirmOpen = false; }
        },

        // The key from the gate modal or the License card: stored for
        // this site, then the snapshot's licensing follows.
        async saveLicenseKey ()
        {
            const key = String( this.licenseKeyDraft ?? '' ).trim();

            if ( key === '' ) { return false; }

            const response = await fetch( '/api/license', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { key } ),
            } );

            const body = await response.json().catch( () => ( {} ) );

            this.licenseKeyProblem = !response.ok;
            this.licenseKeyProblemText = response.ok ? '' : ( typeof body.error === 'string' ? body.error : t( 'licenseKeyProblem' ) );

            if ( response.ok )
            {
                if ( this.snapshot !== null && body.licensing !== undefined ) { this.snapshot.licensing = body.licensing; }

                this.licenseKeyDraft = '';
            }

            return response.ok;
        },

        // The modal's Publish: past the window it stores the key
        // first, then publishes like any confirmed publish.
        async confirmPublish ()
        {
            if ( this.licensing.phase === 'expired' && !( await this.saveLicenseKey() ) ) { return; }

            this.publishConfirmOpen = false;
            await this.publishNow( true );
        },

        async publishNow ( confirmed = false )
        {
            if ( this.publishState === 'publishing' ) { return; }

            if ( !confirmed && this.publishNeedsConfirm )
            {
                this.openPublishConfirm();
                return;
            }

            this.publishState = 'publishing';
            this.publishProblems = [];
            this.publishNotices = [];
            this.dismissPublishCard();
            this.suppressReloadUntil = Date.now() + 8000;

            // The spinner holds for a beat even when the publish is
            // quick: a state that flashes reads as a glitch.
            const startedAt = Date.now();
            let response = null;
            let body = {};

            try
            {
                response = await fetch( '/api/publish', { method: 'POST' } );
                body = await response.json().catch( () => ( {} ) );
            }
            catch
            {
                response = null;
            }

            const remaining = 900 - ( Date.now() - startedAt );

            if ( remaining > 0 ) { await new Promise( ( resolve ) => setTimeout( resolve, remaining ) ); }

            // A refused publish names its reasons (required fields,
            // unavailable components, a folder that is not its own
            // repository, a server that is gone): the enforcement moment
            // is here, never while drafting, so the reason is a MODAL
            // (Mikey, 2026-09-03) and the button simply returns.
            if ( response === null || !response.ok )
            {
                this.publishProblems = Array.isArray( body.issues ) ? body.issues : [];

                // The gate closed between the snapshot and the publish
                // (the window ended today): the key modal, not this one.
                if ( response !== null && response.status === 402 )
                {
                    if ( this.snapshot !== null && body.licensing !== undefined ) { this.snapshot.licensing = body.licensing; }

                    this.publishNotices = Array.isArray( body.notices ) ? body.notices.filter( ( notice ) => typeof notice === 'string' ) : [];
                    this.openPublishConfirm();
                }
                else
                {
                    this.publishFailure = {
                        error: response === null ? t( 'publishUnreachable' ) : ( typeof body.error === 'string' && body.error !== '' ? body.error : tFill( 'publishFailedStatus', { status: String( response.status ) } ) ),
                        issues: this.publishProblems,
                    };
                }

                this.publishState = 'idle';
                this.suppressReloadUntil = Date.now() + 1500;
                void this.refresh();
                return;
            }

            this.showPublishCard( body );
            this.publishState = 'published';
            this.suppressReloadUntil = Date.now() + 1500;
            void this.refresh();
            setTimeout( () =>
            {
                this.publishState = 'idle';
            }, 2200 );
        },

        // The publish confirmation card (EDITOR: the supporter moment):
        // what was published, and on a personal site's fifth or
        // fortieth publish one gentle line offering support, once
        // each. A plain card goes on its own; a card with the line
        // waits for its x.
        showPublishCard ( body )
        {
            const moment = body.supporterMoment === 5 || body.supporterMoment === 40 ? body.supporterMoment : null;

            const backup = body.backup === 'failed' || body.backup === 'conflict' || body.backup === 'expired' || body.backup === 'pushed' || body.backup === 'off' ? body.backup : 'none';

            this.publishCard = { pages: typeof body.pages === 'number' ? body.pages : 0, moment, backup, backupError: typeof body.backupError === 'string' ? body.backupError : '', changed: body.changed !== false, deploy: body.deploy === 'uploaded' || body.deploy === 'failed' || body.deploy === 'off' ? body.deploy : 'none', deployError: typeof body.deployError === 'string' ? body.deployError : '', deployUploaded: typeof body.deployUploaded === 'number' ? body.deployUploaded : 0, deployDeleted: typeof body.deployDeleted === 'number' ? body.deployDeleted : 0, notices: Array.isArray( body.notices ) ? body.notices.filter( ( notice ) => typeof notice === 'string' ) : [] };

            if ( this.snapshot !== null && body.licensing !== undefined ) { this.snapshot.licensing = body.licensing; }

            clearTimeout( this.publishCardTimer );

            // A card with the supporter line, with a backup that did
            // not go, or with a word about a key, waits for its x.
            if ( moment !== null || backup === 'failed' || backup === 'conflict' || backup === 'expired' || this.publishCard.deploy === 'failed' || this.publishCard.notices.length > 0 ) { return; }

            this.publishCardTimer = setTimeout( () =>
            {
                this.publishCard = null;
            }, 6000 );
        },

        dismissPublishCard ()
        {
            clearTimeout( this.publishCardTimer );
            this.publishCard = null;
        },

        // The card's first line: what was published, or - when nothing
        // was new and the click was for the backup's sake - what the
        // backup did.
        get publishCardTitle ()
        {
            const card = this.publishCard;

            if ( card === null ) { return ''; }
            if ( card.changed === false ) { return t( card.backup === 'pushed' ? 'publishNothingNewBackedUp' : 'publishNothingNew' ); }

            return tCount( 'publishedPages', card.pages );
        },

        get supporterMomentLine ()
        {
            return t( this.publishCard?.moment === 40 ? 'supporterMomentForty' : 'supporterMomentFive' );
        },

        // The support link on the card: the page, and the key modal
        // beside it, like the menu's row.
        supportFromCard ()
        {
            this.dismissPublishCard();
            this.userMenuGo( 'support' );
        },

        // Restored content (a journal step, a discard) morphs in -
        // never a reload, never a blank. The watcher's echo is
        // suppressed like an own save; the editor refetches directly.
        applyRestoredContent ()
        {
            // Pending debounced saves carry pre-restore state and
            // would resurrect what was just discarded - they die here,
            // draft timers included.
            clearTimeout( this.saveTimer );
            clearTimeout( this.themeSaveTimer );
            clearTimeout( this.metaSaveTimer );
            clearTimeout( this.entrySaveTimer );
            clearTimeout( this.menusSaveTimer );

            this.suppressReloadUntil = Date.now() + 1800;
            this.sendToCanvas( { kind: 'refresh' } );

            // A second refresh moments later is idempotent (the disk
            // is the truth) and absorbs any in-flight write racing
            // the restore.
            setTimeout( () => this.sendToCanvas( { kind: 'refresh' } ), 450 );

            this.blockEditor = null;

            // The open workspace's drafts resync once the fresh
            // snapshot lands - a restore is real only when the screen
            // shows it (Mikey's undo-a-color report). A restore can
            // also take the open document itself away (undoing the
            // create, Mikey 2026-09-03) - then the workspace ejects
            // to a surviving sibling, or the pages table when none
            // remain, never lingering inside a ghost.
            void this.refresh().then( () =>
            {
                if ( this.workspace === 'settings' ) { this.syncSettingsDrafts(); }
                if ( this.workspace === 'menu' ) { this.syncMenuEditor(); }

                if ( this.workspace === 'collection' || this.workspace === 'taxonomy' )
                {
                    const isTaxonomy = this.workspace === 'taxonomy';
                    const rows = isTaxonomy ? this.taxonomies : this.collections;

                    if ( !rows.some( ( row ) => row.file === this.workspaceFile ) )
                    {
                        const sibling = rows[ 0 ];

                        if ( sibling === undefined ) { this.openPagesWorkspace(); }
                        else if ( isTaxonomy ) { this.openTaxonomy( sibling.file ); }
                        else { this.openCollection( sibling.file ); }

                        return;
                    }

                    if ( isTaxonomy ) { void this.loadTaxonomy(); }
                    else { void this.loadCollection(); }
                }
            } );

            if ( this.selectedBlock !== null ) { void this.loadBlock( this.selectedBlock ); }
        },

        async stepJournal ( direction )
        {
            const response = await fetch( `/api/${direction}`, { method: 'POST' } );
            const step = await response.json();

            if ( step.stepped !== true ) { return; }

            this.applyRestoredContent();
        },

        async discardChanges ()
        {
            this.discardOpen = false;

            const response = await fetch( '/api/discard', { method: 'POST' } );

            if ( response.ok ) { this.applyRestoredContent(); }
        },

        get status ()
        {
            return this.snapshot?.status ?? '';
        },

        // The chip appears only when something needs the user: unsaved
        // edits, or saved work not yet published. A published, clean
        // site says nothing - quiet is the resting state.
        get statusLabel ()
        {
            if ( this.status === 'unsaved' ) { return t( 'statusUnsaved' ); }
            if ( this.status === 'saved' ) { return t( 'statusSaved' ); }
            if ( this.status === 'unpushed' ) { return t( 'statusUnpushed' ); }

            return '';
        },

        // The nav dots: which rows hold changes not yet in a saved
        // version. The server derives both lists from git on every
        // snapshot, so they clear on Save without bookkeeping here.
        pageIsDirty ( id )
        {
            return ( this.snapshot?.changedPageIds ?? [] ).includes( id );
        },

        fileIsDirty ( file )
        {
            return ( this.snapshot?.changedFiles ?? [] ).includes( file );
        },

        get statusDotClass ()
        {
            return this.status === 'unsaved' ? 'bg-amber' : 'bg-shell-muted';
        },

        get publishLabel ()
        {
            if ( this.publishState === 'publishing' ) { return t( 'publishing' ); }
            if ( this.publishState === 'published' ) { return t( 'published' ); }
            if ( this.publishState === 'failed' ) { return t( 'publishFailed' ); }

            return t( 'publish' );
        },

        // Every edit takes two paths: the morph is immediate (the
        // render-and-morph loop, DEVELOPMENT section 5) and the disk
        // write debounces behind it.
        markDirty ()
        {
            this.markBlockDirty();
        },

        markBlockDirty ()
        {
            this.dirty += 1;
            void this.renderAndMorph();
            clearTimeout( this.saveTimer );
            this.saveTimer = setTimeout( () => void this.saveBlock(), 400 );
        },

        // Inline text editing (EDITOR 3): the canvas asks which field a
        // double-clicked text belongs to. A mapped paragraph or heading
        // names a markdown field by its source range; other text is a
        // text field matched by value. Keystrokes write the field
        // through the block editor - the morph loop stays out while
        // the caret is live (the DOM already shows the edit) and the
        // debounced save lands as always.
        inlineStart ( message )
        {
            const editor = this.blockEditor;
            const reply = ( ok, key = null, mode = null ) => this.sendToCanvas( { kind: 'inline-edit', ok, key, mode, path: message.path } );

            if ( editor === null || editor.path !== message.path )
            {
                reply( false );
                return;
            }

            const fields = Object.entries( editor.fields ?? {} );
            const loose = ( value ) => String( value ?? '' ).replace( /[^\p{L}\p{N}]/gu, '' );

            if ( message.mode === 'markdown' && typeof message.range === 'string' )
            {
                const [ start, end ] = message.range.split( '-' ).map( Number );
                const candidates = fields.filter( ( [ key, field ] ) => field.type === 'markdown' && typeof editor.props[ key ] === 'string' && editor.props[ key ].length >= end );
                const match = candidates.find( ( [ key ] ) => loose( editor.props[ key ].slice( start, end ) ) === loose( message.text ) ) ?? candidates[ 0 ];

                if ( match === undefined )
                {
                    reply( false );
                    return;
                }

                this.inlineEdit = { path: message.path, key: match[ 0 ], mode: 'markdown', start, end };
                reply( true, match[ 0 ], 'markdown' );
                return;
            }

            const text = String( message.text ?? '' ).trim();
            const match = fields.find( ( [ key, field ] ) => [ 'text', 'textarea' ].includes( field.type ) && typeof editor.props[ key ] === 'string' && editor.props[ key ].trim() === text && text !== '' );

            if ( match === undefined )
            {
                reply( false );
                return;
            }

            this.inlineEdit = { path: message.path, key: match[ 0 ], mode: 'text', start: 0, end: 0 };
            reply( true, match[ 0 ], 'text' );
        },

        inlineInput ( message )
        {
            const editor = this.blockEditor;
            const edit = this.inlineEdit;

            if ( editor === null || edit === null || editor.path !== message.path ) { return; }

            if ( edit.mode === 'text' )
            {
                editor.props[ edit.key ] = String( message.text ?? '' );
            }
            else
            {
                const value = String( editor.props[ edit.key ] ?? '' );
                const markdown = String( message.markdown ?? '' );

                editor.props[ edit.key ] = value.slice( 0, edit.start ) + markdown + value.slice( edit.end );
                edit.end = edit.start + markdown.length;
            }

            this.dirty += 1;
            clearTimeout( this.saveTimer );
            this.saveTimer = setTimeout( () => void this.saveBlock(), 400 );
        },

        // Enter in a markdown field: the paragraph splits at the caret
        // into two (the Notion and Docs convention), the block
        // re-renders, and the caret lands at the start of the second.
        async inlineSplit ( message )
        {
            const editor = this.blockEditor;
            const edit = this.inlineEdit;

            if ( editor === null || edit === null || editor.path !== message.path || edit.mode !== 'markdown' ) { return; }

            const value = String( editor.props[ edit.key ] ?? '' );
            const before = String( message.before ?? '' ).replace( /\s+$/, '' );
            const after = String( message.after ?? '' ).replace( /^\s+/, '' );

            editor.props[ edit.key ] = value.slice( 0, edit.start ) + before + '\n\n' + after + value.slice( edit.end );

            const start = edit.start + before.length + 2;

            this.inlineEdit = { ...edit, start, end: start + after.length };
            this.dirty += 1;
            clearTimeout( this.saveTimer );
            this.saveTimer = setTimeout( () => void this.saveBlock(), 400 );
            await this.renderAndMorph();
            this.sendToCanvas( { kind: 'inline-focus', path: edit.path, range: `${start}-${start + after.length}` } );
        },

        inlineEnd ()
        {
            if ( this.inlineEdit === null ) { return; }

            this.inlineEdit = null;
            void this.renderAndMorph();
        },

        async renderAndMorph ()
        {
            const editor = this.blockEditor;

            if ( editor === null ) { return; }

            // Everything is captured BEFORE the await: a caller inside
            // a menu that closes itself (setBinding) has its element -
            // and with it this scope chain - torn down while the
            // renderer loads, and post-await lookups on a dead scope
            // silently resolve to nothing.
            // The getter builds a fresh object per read, so capturing
            // by reference is safe - and a JSON round-trip here would
            // flatten the bind-through String objects to primitives.
            const scope = this.surface !== null ? this.sampleEntryScope : null;
            const canvas = this.$refs.canvas ?? null;

            const renderer = await rendererFor(
                editor.reference,
                JSON.parse( JSON.stringify( editor.fields ) ),
                editor.template,
            );

            // On the template canvas, bound props morph through the
            // same sample entry the server previews with.
            let props = JSON.parse( JSON.stringify( editor.props ) );

            if ( scope !== null )
            {
                props = resolveBoundProps( props, scope );
            }

            const html = renderer.render( props );

            canvas?.contentWindow?.postMessage( { casomerStudio: true, kind: 'morph-block', path: editor.path, html }, '*' );
        },

        async saveBlock ()
        {
            const editor = this.blockEditor;

            if ( editor === null ) { return; }

            // Region blocks address by region name - without it the
            // write resolves no target and edits silently vanish.
            const target = this.targetOfEditor( editor );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/block', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( {
                    ...target,
                    path: editor.path,
                    props: JSON.parse( JSON.stringify( editor.props ) ),
                } ),
            } );

            // The morph loop is the instant view; the server render is
            // the truth. A refetch after the save catches what the
            // client renderer cannot show - list items, for one (Mikey:
            // repeater edits reached the canvas only on reload). Not
            // under a live caret: the refresh would replace the element
            // being typed in.
            if ( this.inlineEdit === null ) { this.sendToCanvas( { kind: 'refresh' } ); }
        },

        clearSelection ()
        {
            this.applyDeselect();
            this.sendToCanvas( { kind: 'deselect' } );
        },

        // ---- The repeat inspector (SCHEMA 13.5, the Repeat board) ----

        get repeatSource ()
        {
            return this.repeatEditor?.repeat?.source ?? {};
        },

        get repeatIsCurated ()
        {
            return Array.isArray( this.repeatSource.entries );
        },

        get repeatIsMenu ()
        {
            return typeof this.repeatSource.menu === 'string';
        },

        get repeatIsTaxonomy ()
        {
            return typeof this.repeatSource.taxonomy === 'string';
        },

        // One Source picker for every kind (Mikey: a repeater selects
        // from any source): collections, menus, and public
        // taxonomies, grouped, on every surface. The value encodes
        // kind and name.
        get repeatSourceChoice ()
        {
            if ( this.repeatIsMenu ) { return `menu:${this.repeatSource.menu}`; }
            if ( this.repeatIsTaxonomy ) { return `taxonomy:${this.repeatSource.taxonomy}`; }

            return `collection:${this.repeatSource.collection ?? ''}`;
        },

        setRepeatSourceChoice ( value )
        {
            const divider = value.indexOf( ':' );
            const kind = value.slice( 0, divider );
            const name = value.slice( divider + 1 );
            const source = this.repeatEditor.repeat.source;

            // Order and term scoping belong to collection sources;
            // limit carries across every kind.
            for ( const stale of [ 'collection', 'menu', 'taxonomy', 'entries', 'order', 'term' ] ) { delete source[ stale ]; }

            source[ kind ] = name;
            this.markRepeatDirty();
        },

        // The source's fields, for order and wiring options: a menu
        // wires from the fixed item shape, a taxonomy from the fixed
        // term shape, a collection from its own fields.
        get repeatCollectionFields ()
        {
            if ( this.repeatIsMenu ) { return this.repeatEditor?.menuFields ?? {}; }
            if ( this.repeatIsTaxonomy ) { return this.repeatEditor?.taxonomyFields ?? {}; }

            const stem = this.repeatSource.collection;

            return this.repeatEditor?.collections?.find( ( candidate ) => candidate.stem === stem )?.fields ?? {};
        },

        get repeatOrderField ()
        {
            return ( this.repeatSource.order ?? '' ).replace( /^-?entry\./, '' );
        },

        get repeatOrderDescending ()
        {
            return ( this.repeatSource.order ?? '' ).startsWith( '-' );
        },

        // The term-scoped repeat (SCHEMA 13.3): on a term template,
        // the source narrows to entries classified under the current
        // term (descendants included).
        get repeatTermScoped ()
        {
            return this.repeatSource.term === 'current';
        },

        toggleRepeatTermScope ()
        {
            const source = this.repeatEditor.repeat.source;

            if ( source.term === 'current' ) { delete source.term; }
            else { source.term = 'current'; }

            this.markRepeatDirty();
        },

        setRepeatOrder ( fieldKey, descending )
        {
            const source = this.repeatEditor.repeat.source;

            if ( fieldKey === '' ) { delete source.order; }
            else { source.order = `${descending ? '-' : ''}entry.${fieldKey}`; }

            this.markRepeatDirty();
        },

        // "filter" narrows the query with the conditions grammar
        // (SCHEMA 3.1); "empty" is the author-owned message when the
        // repeat matches nothing.
        setRepeatFilter ( raw )
        {
            const source = this.repeatEditor.repeat.source;

            if ( raw.trim() === '' ) { delete source.filter; }
            else { source.filter = raw.trim(); }

            this.markRepeatDirty();
        },

        setRepeatEmpty ( raw )
        {
            if ( raw === '' ) { delete this.repeatEditor.repeat.empty; }
            else { this.repeatEditor.repeat.empty = raw; }

            this.markRepeatDirty();
        },

        setRepeatLimit ( raw )
        {
            const source = this.repeatEditor.repeat.source;
            const limit = Number( raw );

            if ( Number.isInteger( limit ) && limit > 0 ) { source.limit = limit; }
            else { delete source.limit; }

            this.markRepeatDirty();
        },

        get repeatShownLabel ()
        {
            const editor = this.repeatEditor;

            if ( editor === null ) { return ''; }

            return tFill( 'repeatShown', { shown: editor.shownCount, total: editor.entryCount } );
        },

        // Wiring uses the ESTABLISHED field linking (Mikey): each
        // component field renders its normal editor with the link
        // control; linked draws per item from the source, unlinked
        // is a value used for every item. The rows live in
        // tpl-field-row - bindSourceFields is repeat-aware.
        wiringFieldLabel ( fieldKey )
        {
            return this.repeatCollectionFields[ fieldKey ]?.label ?? fieldKey;
        },

        markRepeatDirty ()
        {
            this.dirty += 1;
            clearTimeout( this.repeatSaveTimer );
            this.repeatSaveTimer = setTimeout( () => void this.saveRepeat(), 400 );
        },

        async saveRepeat ()
        {
            const editor = this.repeatEditor;

            if ( editor === null ) { return; }

            // Region repeats address by region name, like saveBlock.
            const target = this.targetOfEditor( editor );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/block', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...target, path: editor.path, repeat: JSON.parse( JSON.stringify( editor.repeat ) ) } ),
            } );

            // A repeat re-renders server-side; the bridge refetches and
            // morphs, so the canvas updates without a reload.
            this.sendToCanvas( { kind: 'refresh' } );
        },

        // ---- The add-block seam and the component picker ----

        pinSeam ()
        {
            this.seamPinned = true;
        },

        unpinSeam ()
        {
            this.seamPinned = false;
            this.seamInfo = null;
        },

        get canvasBlockCount ()
        {
            return this.surface !== null ? this.surfaceBlocks.length : ( this.selectedPage?.blocks ?? [] ).length;
        },

        async openPicker ( index, container = '' )
        {
            this.pickerInsertIndex = index;
            this.pickerContainer = container;
            this.pickerKind = 'component';
            this.pickerSwapRepeat = false;
            this.pickerQuery = '';
            this.pickerOpen = true;
            this.seamInfo = null;
            this.seamPinned = false;

            if ( this.pickerComponents === null )
            {
                const response = await fetch( '/api/components' );

                if ( response.ok ) { this.pickerComponents = ( await response.json() ).components; }
            }
        },

        // Swapping the repeated component (Mikey): the same picker,
        // in swap mode - the choice replaces repeat.component instead
        // of inserting a block. Wiring survives where it still fits.
        async openRepeatComponentSwap ()
        {
            if ( this.repeatEditor === null ) { return; }

            this.pickerKind = 'component';
            this.pickerSwapRepeat = true;
            this.pickerQuery = '';
            this.pickerOpen = true;

            if ( this.pickerComponents === null )
            {
                const response = await fetch( '/api/components' );

                if ( response.ok ) { this.pickerComponents = ( await response.json() ).components; }
            }
        },

        async swapRepeatComponent ( component )
        {
            this.pickerOpen = false;
            this.pickerSwapRepeat = false;

            const editor = this.repeatEditor;

            if ( editor === null || typeof component.reference !== 'string' || component.reference.startsWith( 'partial:' ) ) { return; }

            // Props whose key exists on the new component with the
            // same field type carry over - a title wire keeps
            // wiring; anything without a home drops.
            const kept = {};

            for ( const [ key, value ] of Object.entries( editor.repeat.props ?? {} ) )
            {
                const newType = component.fieldTypes?.[ key ];
                const oldType = editor.componentFields[ key ]?.type;

                if ( newType !== undefined && newType === oldType ) { kept[ key ] = value; }
            }

            editor.repeat.component = component.reference;
            editor.repeat.props = kept;
            clearTimeout( this.repeatSaveTimer );
            await this.saveRepeat();

            // The canvas re-renders through the new component and the
            // editor reloads so the wiring rows match its fields.
            this.contentVersion += 1;
            await this.loadBlock( editor.path );
        },

        // A repeat needs a collection to draw from; without one the
        // kind is offered disabled.
        get repeatKindAvailable ()
        {
            return this.collections.length > 0;
        },

        // Partials are a first-class kind (Mikey): a saved
        // arrangement of components, sections, and repeats, reused as
        // one block. Disabled until a partial exists; never offered
        // inside a partial's own canvas (self-nesting is a loop).
        get partialKindAvailable ()
        {
            // The 404 is a page-like surface; regions and partials
            // themselves never nest partials.
            return ( this.snapshot?.partials ?? [] ).length > 0
                && ( this.workspace !== 'settings' || this.surface === 'notFound' );
        },

        // The picker leads with the grammar (SCHEMA section 11): a
        // block is a component, a section, or a repeat. Components go
        // into sections; a repeat renders entries through a component,
        // so both component-ish kinds share the grid.
        choosePickerKind ( kind )
        {
            if ( kind === 'section' )
            {
                void this.insertPickedBlock( { section: {}, blocks: [] } );
                return;
            }

            if ( kind === 'repeat' && !this.repeatKindAvailable ) { return; }
            if ( kind === 'partial' && !this.partialKindAvailable ) { return; }

            this.pickerKind = kind;
        },

        // Every component earns a real-render ghost (Mikey,
        // 2026-09-03): an example when it declares one, else props
        // stood in from its fields. Only a partial pseudo-entry keeps
        // the plate glyph - it is not a component.
        componentHasGhost ( component )
        {
            return typeof component.reference === 'string' && !component.reference.startsWith( 'partial:' );
        },

        get pickerGroups ()
        {
            // Partials are their own picker kind (Mikey): the
            // component grid shows components, the partial grid shows
            // partials, inserted as { partial } blocks.
            const components = this.pickerKind === 'partial'
                ? ( this.snapshot?.partials ?? [] ).map( ( name ) => ( {
                        reference: `partial:${name}`,
                        title: name,
                        packageName: t( 'partialsGroupWord' ),
                        fieldTypes: {},
                    } ) )
                : ( this.pickerComponents ?? [] );
            const query = this.pickerQuery.trim().toLowerCase();
            const matching = query === ''
                ? components
                : components.filter( ( component ) =>
                        component.title.toLowerCase().includes( query ) || component.reference.toLowerCase().includes( query ) );
            const names = [ ...new Set( matching.map( ( component ) => component.packageName ) ) ]
                .sort( ( a, b ) => ( a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare( b ) ) );

            return names.map( ( name ) => ( {
                name,
                components: matching.filter( ( component ) => component.packageName === name ),
            } ) );
        },

        // A picked component becomes a component block, or - when the
        // picker was opened on the repeat kind - the component a new
        // repeat renders its entries through, seeded with the first
        // collection and its title wired to the first text-like prop.
        // At the ROOT a component lands wrapped in a section (Mikey's
        // rule: sections and repeats dictate the spacing around
        // components, never the components themselves); inside a
        // section it lands bare.
        async insertComponent ( component )
        {
            // Swap mode replaces the repeat's component in place.
            if ( this.pickerSwapRepeat )
            {
                await this.swapRepeatComponent( component );
                return;
            }

            // A partial inserts as its own block kind, top-level bare
            // (its blocks carry their own sections).
            if ( typeof component.reference === 'string' && component.reference.startsWith( 'partial:' ) )
            {
                await this.insertPickedBlock( { partial: component.reference.slice( 'partial:'.length ) } );
                return;
            }

            if ( this.pickerKind === 'repeat' )
            {
                const stem = ( this.collections[ 0 ]?.file ?? '' ).replace( /\.json$/, '' );
                const textProp = Object.entries( component.fieldTypes ?? {} )
                    .find( ( [ , type ] ) => [ 'text', 'markdown', 'textarea' ].includes( type ) )?.[ 0 ];

                // A collection surface repeats its own collection; a
                // taxonomy's term template seeds the term-scoped
                // filter (SCHEMA 13.3); a REGION seeds the primary
                // menu through the picked component - navigation in
                // one gesture (SCHEMA 12.5).
                const onTaxonomy = this.workspace === 'taxonomy';

                // The 404 surface is a page, not navigation chrome:
                // its repeats seed like a page's, not a menu.
                const onRegion = this.workspace === 'settings' && this.surface !== 'notFound';
                const own = this.surface !== null && !onTaxonomy && !onRegion ? this.stem : stem;

                if ( onRegion )
                {
                    const isLink = component.reference === 'core/link';

                    await this.insertPickedBlock( {
                        repeat: {
                            source: { menu: this.menuNames[ 0 ] ?? 'primary' },
                            component: component.reference,
                            props: isLink
                                ? { label: { $bind: 'entry.label' }, url: { $bind: 'entry.url' } }
                                : ( textProp === undefined ? {} : { [ textProp ]: { $bind: 'entry.label' } } ),
                        },
                    } );
                    return;
                }

                await this.insertPickedBlock( {
                    repeat: {
                        source: {
                            collection: own,
                            ...( onTaxonomy && this.surface === 'template' ? { term: 'current' } : {} ),
                        },
                        component: component.reference,
                        props: textProp === undefined ? {} : { [ textProp ]: { $bind: 'entry.title' } },
                    },
                } );
                return;
            }

            const componentBlock = { component: component.reference, props: component.exampleProps ?? {} };

            if ( this.pickerContainer === '' )
            {
                await this.insertPickedBlock( { section: {}, blocks: [ componentBlock ] }, '.blocks[0]' );
                return;
            }

            await this.insertPickedBlock( componentBlock );
        },

        async insertPickedBlock ( block, selectSuffix = '' )
        {
            // One insert per picker opening: a doubled click or a
            // replayed handler must never land the block twice.
            if ( !this.pickerOpen ) { return; }

            const index = this.pickerInsertIndex;
            const container = this.pickerContainer;

            this.pickerOpen = false;

            await fetch( '/api/block', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...this.blockTarget, container, index, block } ),
            } );

            // The watcher reloads the canvas; the new block selects
            // itself when the fresh document announces itself.
            const base = container === '' ? `blocks[${index}]` : `${container}.blocks[${index}]`;

            const freshPath = `${base}${selectSuffix}`;

            this.focusFreshPath = freshPath;
            setTimeout( () =>
            {
                if ( this.focusFreshPath === freshPath ) { this.focusFreshPath = null; }
            }, 4000 );
            this.selectedBlock = freshPath;

            if ( this.workspace === 'collection' ) { await this.loadCollection(); }

            void this.refresh();
        },

        // The tag's trash: the same confirm the inspector's trash and
        // the Delete key use. The content slot is not removable.
        requestRemoveSelected ()
        {
            if ( this.selectedBlock !== null && this.confirmTarget === null && this.blockInfoAt( this.selectedBlock )?.kind !== 'slot' ) { this.confirmTarget = 'block'; }
        },

        // ---- The Section inspector and the Layout card (SCHEMA 11;
        // Mikey, 2026-09-03: sections dictate the spacing outside and
        // inside and the span of their children) ----

        // The editor holding the selected block's wrapper layout: the
        // block editor for a component or section, the repeat editor
        // for a repeat.
        get layoutEditor ()
        {
            return this.blockEditor ?? this.repeatEditor;
        },

        get layoutValues ()
        {
            return this.layoutEditor?.layout ?? {};
        },

        get sectionValues ()
        {
            return this.blockEditor?.kind === 'section' ? ( this.blockEditor.section ?? {} ) : {};
        },

        // A value that is a breakpoint map stays the file's business
        // for now: the select shows its base and a note says so.
        layoutValueBase ( value )
        {
            if ( value === null || value === undefined ) { return ''; }
            if ( typeof value === 'object' ) { return String( value.base ?? '' ); }

            return String( value );
        },

        layoutValueResponsive ( value )
        {
            return value !== null && typeof value === 'object';
        },

        get sectionTokens ()
        {
            return this.blockEditor?.tokens ?? this.repeatEditor?.tokens ?? {};
        },

        get sectionSpacingTokens ()
        {
            return this.sectionTokens.spacing ?? this.spacingTokenNames;
        },

        get sectionWidthTokens ()
        {
            return this.sectionTokens.widths ?? this.widthTokenNames;
        },

        // The selected block's depth (the page is 0) and its parent's
        // flow, for the Size control: only a row parent hands out
        // widths; a column parent stacks full-width rows.
        get selectedDepth ()
        {
            return this.selectedBlock === null ? 0 : ( this.selectedBlock.match( /(?:blocks|header|footer)\[\d+\]/g ) ?? [] ).length;
        },

        get parentFlow ()
        {
            if ( this.selectedBlock === null ) { return 'column'; }

            const parentPath = this.selectedBlock.replace( /\.?(?:blocks|header|footer)\[\d+\]$/, '' );
            const parentDepth = this.selectedDepth - 1;

            if ( parentPath === '' || parentPath === 'header' || parentPath === 'footer' ) { return 'column'; }

            const info = this.blockInfoAt( parentPath );
            const explicit = typeof info?.direction === 'string' ? info.direction : null;

            return explicit ?? ( parentDepth % 2 === 1 ? 'row' : 'column' );
        },

        // What this section's children flow as when it says nothing.
        get sectionAutoFlow ()
        {
            return this.selectedDepth % 2 === 1 ? 'row' : 'column';
        },

        get layoutCardShown ()
        {
            return this.canvasActive && this.selectedBlock !== null && this.layoutEditor !== null && this.blockInfoAt( this.selectedBlock )?.kind !== 'slot';
        },

        get sizeOptions ()
        {
            return [ '1/4', '1/3', '1/2', '2/3', '3/4', 'full' ];
        },

        async saveSection ( key, value )
        {
            const editor = this.blockEditor;

            if ( editor === null || editor.kind !== 'section' ) { return; }

            const section = { ...( editor.section ?? {} ) };

            if ( value === '' || value === null || value === false ) { delete section[ key ]; }
            else { section[ key ] = value; }

            editor.section = section;
            await this.writeArrangement( { section: { [ key ]: value === '' ? null : value } } );
        },

        async saveLayout ( key, value )
        {
            const editor = this.layoutEditor;

            if ( editor === null ) { return; }

            editor.layout = { ...( editor.layout ?? {} ), [ key ]: value === '' ? null : value };
            await this.writeArrangement( { wrapper: { [ key ]: value === '' ? null : value } } );
        },

        // One write, then the canvas refreshes through the server:
        // arrangement is classes on wrappers, which the client
        // renderer does not produce.
        async writeArrangement ( patch )
        {
            const editor = this.layoutEditor;

            if ( editor === null ) { return; }

            const target = this.targetOfEditor( editor );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/block', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...target, path: editor.path, ...patch } ),
            } );
            this.sendToCanvas( { kind: 'refresh' } );
            void this.refresh();
        },

        get selectionCanMove ()
        {
            return this.selectedBlock !== null && this.blockInfoAt( this.selectedBlock )?.kind !== 'slot';
        },

        get canvasDragGhostStyle ()
        {
            const drag = this.canvasDrag;

            return drag === null ? {} : { left: `${drag.x + 14}px`, top: `${drag.y + 10}px` };
        },

        // Drag and drop in the preview (EDITOR 2; Mikey 2026-09-03):
        // the tag's grip captures the pointer, so every move reaches
        // the chrome even over the iframe; the chrome hands the
        // canvas-relative point to the bridge, whose seam machinery
        // (the same one the plus uses) says where the block would
        // land; the drop moves it there in one write and keeps it
        // selected at its new path. A press that travels under 4px
        // is a click, not a drag.
        beginCanvasDrag ( event )
        {
            if ( event.button !== 0 || this.selectedBlock === null || this.canvasDrag !== null ) { return; }

            const grip = event.currentTarget;
            const drag = { path: this.selectedBlock, label: this.selectionLabel, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
            const move = ( e ) => this.trackCanvasDrag( e );
            const finish = ( e ) =>
            {
                grip.removeEventListener( 'pointermove', move );
                grip.removeEventListener( 'pointerup', finish );
                grip.removeEventListener( 'pointercancel', cancel );
                void this.endCanvasDrag( e );
            };
            const cancel = () =>
            {
                grip.removeEventListener( 'pointermove', move );
                grip.removeEventListener( 'pointerup', finish );
                grip.removeEventListener( 'pointercancel', cancel );
                this.cancelCanvasDrag();
            };

            this.canvasDrag = drag;
            try { grip.setPointerCapture( event.pointerId ); }
            catch { /* a synthetic pointer has no capture; the listeners still ride the grip */ }
            grip.addEventListener( 'pointermove', move );
            grip.addEventListener( 'pointerup', finish );
            grip.addEventListener( 'pointercancel', cancel );
            event.preventDefault();
        },

        trackCanvasDrag ( event )
        {
            const drag = this.canvasDrag;

            if ( drag === null ) { return; }

            drag.x = event.clientX;
            drag.y = event.clientY;

            if ( !drag.active )
            {
                if ( Math.hypot( drag.x - drag.startX, drag.y - drag.startY ) < 4 ) { return; }

                drag.active = true;
                document.body.classList.add( 'canvas-dragging' );
                this.sendToCanvas( { kind: 'drag-start', path: drag.path } );
            }

            const frame = this.$refs.canvas?.getBoundingClientRect();

            if ( frame === undefined ) { return; }

            this.sendToCanvas( { kind: 'drag-at', x: drag.x - frame.left, y: drag.y - frame.top } );
        },

        cancelCanvasDrag ()
        {
            const drag = this.canvasDrag;

            this.canvasDrag = null;
            document.body.classList.remove( 'canvas-dragging' );

            if ( drag?.active === true )
            {
                this.sendToCanvas( { kind: 'drag-end' } );
                this.seamInfo = null;
            }
        },

        async endCanvasDrag ()
        {
            const drag = this.canvasDrag;
            const seam = this.seamInfo;

            this.cancelCanvasDrag();

            if ( drag === null || !drag.active || seam === null ) { return; }

            // Dropping on the block's own boundaries changes nothing.
            const parent = drag.path.replace( /\.?(?:blocks|header|footer)\[\d+\]$/, '' );
            const own = Number( /\[(\d+)\]$/.exec( drag.path )?.[ 1 ] ?? -1 );

            if ( seam.container === parent && ( seam.index === own || seam.index === own + 1 ) ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/block-move', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...this.blockTarget, path: drag.path, container: seam.container, index: seam.index } ),
            } );

            if ( !response.ok ) { return; }

            const body = await response.json().catch( () => ( {} ) );
            const freshPath = typeof body.path === 'string' ? body.path : null;

            // A structural change reloads the canvas; the moved block
            // selects itself again when the fresh document announces.
            this.contentVersion += 1;

            if ( freshPath !== null )
            {
                this.focusFreshPath = freshPath;
                this.selectedBlock = freshPath;
                setTimeout( () =>
                {
                    if ( this.focusFreshPath === freshPath ) { this.focusFreshPath = null; }
                }, 4000 );
            }

            if ( this.workspace === 'collection' ) { await this.loadCollection(); }

            void this.refresh();
        },

        async removeSelectedBlock ()
        {
            const path = this.selectedBlock;

            // The content slot is the template's fixture (SCHEMA 12.6).
            if ( path === null || this.blockInfoAt( path )?.kind === 'slot' ) { return; }

            await fetch( '/api/block', {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...this.blockTarget, path } ),
            } );

            // A structural change reloads the canvas explicitly: the
            // morph loop only covers prop edits, and the confirm flow
            // suppresses the watcher reload this used to lean on.
            this.contentVersion += 1;
            this.applyDeselect();

            if ( this.workspace === 'collection' ) { await this.loadCollection(); }

            void this.refresh();
        },

        async refresh ()
        {
            try
            {
                const response = await fetch( '/api/site' );

                if ( !response.ok ) { throw new Error( t( 'serverUnreachable' ) ); }

                const loaded = await response.json();

                this.snapshot = loaded;
                this.error = null;

                // The site name shows on the pages table's sidebar from
                // the first load (Mikey's report), not only after Site
                // settings opens; a name mid-edit keeps its keystrokes.
                if ( this.siteNameTouched !== true ) { this.siteNameDraft = loaded.config?.name ?? ''; }
                if ( this.siteOriginTouched !== true ) { this.siteOriginDraft = loaded.origin ?? ''; }

                if ( !loaded.pages.some( ( page ) => page.id === this.selectedPageId ) )
                {
                    this.selectedPageId = loaded.pages[ 0 ]?.id ?? null;
                    this.syncPageTitleDraft();
                }
            }
            catch ( failure )
            {
                this.error = failure.message;
            }
        },

        // The route, spelled as a hash: which workspace, which file,
        // which surface or view. Selection within a view is session
        // state and deliberately not routed.
        get routeHash ()
        {
            if ( this.workspace === 'pages' ) { return this.pagesRowId === null ? '#/pages' : `#/pages/${this.pagesRowId}`; }
            if ( this.workspace === 'site' ) { return `#/site/${this.siteView}`; }
            if ( this.workspace === 'theme' ) { return '#/theme'; }
            if ( this.workspace === 'template' && this.surface !== null ) { return `#/template/${this.surface}`; }

            if ( this.workspace === 'settings' )
            {
                // The settings surfaces (404, regions, partials) are
                // their own places: Back must return to settings
                // (Mikey's 404 report).
                return this.surface === null ? '#/settings' : `#/settings/${this.surface}`;
            }

            if ( this.workspace === 'media' ) { return this.mediaView === 'trash' ? '#/media/trash' : '#/media'; }

            if ( this.workspace === 'collection' && this.workspaceFile !== null )
            {
                if ( this.surface === 'entry' && this.sampleEntryId !== null ) { return `#/collection/${this.stem}/entry/${this.sampleEntryId}`; }
                if ( this.surface === 'template' ) { return `#/collection/${this.stem}/template/${this.layoutName}`; }
                if ( this.surface !== null ) { return `#/collection/${this.stem}/${this.surface}`; }
                if ( this.collectionView === 'fields' ) { return `#/collection/${this.stem}/fields`; }
                if ( this.collectionView === 'layouts' ) { return this.layoutsRowName === null ? `#/collection/${this.stem}/layouts` : `#/collection/${this.stem}/layouts/${this.layoutsRowName}`; }

                return `#/collection/${this.stem}`;
            }

            if ( this.workspace === 'taxonomy' && this.workspaceFile !== null )
            {
                if ( this.surface === 'template' ) { return `#/taxonomy/${this.stem}/template/${this.layoutName}`; }
                if ( this.surface !== null ) { return `#/taxonomy/${this.stem}/${this.surface}`; }

                if ( this.taxonomyView === 'layouts' ) { return this.layoutsRowName === null ? `#/taxonomy/${this.stem}/layouts` : `#/taxonomy/${this.stem}/layouts/${this.layoutsRowName}`; }

                return `#/taxonomy/${this.stem}`;
            }

            if ( this.workspace === 'menu' && this.menuName !== null ) { return `#/menu/${this.menuName}`; }

            return this.selectedPageId === null ? '#/' : `#/page/${this.selectedPageId}`;
        },

        async applyRoute ()
        {
            const parts = window.location.hash.replace( /^#\/?/, '' ).split( '/' ).filter( ( part ) => part !== '' );

            // A bare address opens the pages table, not the home page's
            // canvas (Mikey, 2026-09-05): the overview first.
            if ( parts.length === 0 )
            {
                this.openPagesWorkspace( 'pages' );
                return;
            }

            if ( parts[ 0 ] === 'settings' )
            {
                this.openSettings();

                if ( parts[ 1 ] !== undefined ) { this.openSurface( parts[ 1 ] ); }

                return;
            }

            if ( parts[ 0 ] === 'media' )
            {
                this.openMediaWorkspace();

                if ( parts[ 1 ] === 'trash' ) { this.setMediaView( 'trash' ); }

                return;
            }

            if ( parts[ 0 ] === 'pages' )
            {
                // Templates moved under Site (Mikey); the old address
                // still lands.
                if ( parts[ 1 ] === 'templates' ) { this.openSiteWorkspace( 'templates' ); }
                else
                {
                    this.openPagesWorkspace( 'pages' );

                    if ( parts[ 1 ] !== undefined && this.pages.some( ( page ) => page.id === parts[ 1 ] ) ) { this.selectPagesRow( parts[ 1 ] ); }
                }

                return;
            }

            if ( parts[ 0 ] === 'site' )
            {
                this.openSiteWorkspace( [ 'menus', 'templates' ].includes( parts[ 1 ] ) ? parts[ 1 ] : 'partials' );
                return;
            }

            if ( parts[ 0 ] === 'theme' )
            {
                this.openTheme();
                return;
            }

            if ( parts[ 0 ] === 'template' && this.templateNames.includes( parts[ 1 ] ) )
            {
                this.openTemplate( parts[ 1 ] );
                return;
            }

            if ( parts[ 0 ] === 'page' && this.pages.some( ( page ) => page.id === parts[ 1 ] ) )
            {
                // Back from the pages table lands here: the workspace
                // must follow, or the route hash disagrees with the
                // URL and every Back re-pushes it (Mikey: "the back
                // button gets stuck").
                this.enterWorkspace( 'page' );
                this.selectedPageId = parts[ 1 ];
                this.syncPageTitleDraft();
                this.applyDeselect();
                return;
            }

            if ( parts[ 0 ] === 'collection' && this.collections.some( ( candidate ) => candidate.file === `${parts[ 1 ]}.json` ) )
            {
                this.enterWorkspace( 'collection', `${parts[ 1 ]}.json` );
                await this.loadCollection();

                if ( parts[ 2 ] === 'fields' ) { this.openFields(); }
                if ( parts[ 2 ] === 'layouts' )
                {
                    this.showLayoutsView();

                    if ( parts[ 3 ] !== undefined ) { this.selectLayoutRow( parts[ 3 ] ); }
                }
                if ( parts[ 2 ] === 'template' && parts[ 3 ] !== undefined ) { this.layoutName = parts[ 3 ]; }
                if ( parts[ 2 ] === 'index' || parts[ 2 ] === 'template' ) { this.openSurface( parts[ 2 ] ); }
                if ( parts[ 2 ] === 'entry' && parts[ 3 ] !== undefined ) { this.openEntryLayout( parts[ 3 ] ); }

                return;
            }

            if ( parts[ 0 ] === 'taxonomy' && this.taxonomies.some( ( candidate ) => candidate.file === `${parts[ 1 ]}.json` ) )
            {
                this.openTaxonomy( `${parts[ 1 ]}.json` );

                if ( parts[ 2 ] === 'template' && parts[ 3 ] !== undefined ) { this.layoutName = parts[ 3 ]; }
                if ( parts[ 2 ] === 'index' || parts[ 2 ] === 'template' ) { this.openSurface( parts[ 2 ] ); }
                if ( parts[ 2 ] === 'layouts' )
                {
                    this.showTaxonomyLayoutsView();

                    if ( parts[ 3 ] !== undefined ) { this.selectLayoutRow( parts[ 3 ] ); }
                }
            }

            if ( parts[ 0 ] === 'menu' && this.menuNames.includes( parts[ 1 ] ) )
            {
                this.openMenu( parts[ 1 ] );
            }
        },

        // Switching pages clears the selection: a path from one page
        // means nothing on another. A content reload of the SAME page
        // keeps it - the canvas re-selects when the new document loads.
        selectPage ( id )
        {
            if ( !this.confirmEntryLeave( () => this.selectPage( id ) ) ) { return; }

            this.enterWorkspace( 'page' );

            if ( id === this.selectedPageId ) { return; }

            this.selectedPageId = id;
            this.syncPageTitleDraft();
            this.applyDeselect();
        },

        // The center is a workspace (EDITOR section 1): the canvas is
        // its usual tenant, and data surfaces - a collection head-on,
        // taxonomy terms, site settings - take the same room.
        enterWorkspace ( kind, file = null )
        {
            this.workspace = kind;
            this.workspaceFile = file;
            this.tab = 'content';
            this.collectionEditor = null;
            this.selectedEntryId = null;
            this.taxonomyEditor = null;
            this.selectedTermId = null;
            this.confirmTarget = null;
            this.surface = null;
            this.collectionView = 'entries';
            this.taxonomyView = 'terms';
            this.selectedFieldKey = null;
            this.fieldsDraft = null;
            this.sampleEntryId = null;
            this.samplePageId = null;
            this.samplePickerOpen = false;
            this.menuName = null;
            this.menuEditor = null;
            this.selectedMenuKey = null;
            this.menuAddOpen = false;
            this.outlineOpen = false;
            this.selectedMediaFile = null;

            if ( kind !== 'page' ) { this.applyDeselect(); }
        },

        get stem ()
        {
            return ( this.workspaceFile ?? '' ).replace( /\.json$/, '' );
        },

        // The canvas serves two masters: a page, or a collection's
        // index or template surface (EDITOR: one canvas, many rooms).
        get canvasActive ()
        {
            return this.workspace === 'page' || this.surface !== null;
        },

        openSurface ( kind )
        {
            if ( !this.confirmEntryLeave( () => this.openSurface( kind ) ) ) { return; }

            this.surface = kind;

            // A fresh partial starts small and grows to its content
            // once the region canvas reports in - never inheriting
            // whatever height the last surface left behind.
            if ( this.workspace === 'settings' || this.workspace === 'template' ) { this.canvasFitHeight = 200; }

            this.collectionView = 'entries';
            this.taxonomyView = 'terms';
            this.selectedEntryId = null;
            this.selectedFieldKey = null;
            this.confirmTarget = null;
            this.tab = 'content';
            this.samplePickerOpen = false;
            this.applyDeselect();
        },

        closeSurface ()
        {
            this.surface = null;
            this.samplePickerOpen = false;
            this.applyDeselect();
        },

        // Diverged-entry editing (SCHEMA 13.4, Mikey's "break out of
        // the mold"): divergence copies the CURRENT template into the
        // entry, then its own canvas opens; adopting returns it to
        // the template (the confirm flow owns the discard).
        async divergeEntry ( id )
        {
            const file = this.workspaceFile;

            if ( file === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/entry-layout', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, id, action: 'diverge' } ),
            } );
            await this.loadCollection();
            this.openEntryLayout( id );
            void this.refresh();
        },

        openPartialFromBlock ()
        {
            const name = this.blockEditor?.name;

            if ( typeof name !== 'string' ) { return; }

            this.openSettings();
            this.openSurface( name );
        },

        openEntryLayout ( id )
        {
            if ( !this.confirmEntryLeave( () => this.openEntryLayout( id ) ) ) { return; }

            this.openSurface( 'entry' );
            this.sampleEntryId = id;
        },

        // The template canvas renders through one sample entry; the
        // cap-bar chip picks which (EDITOR: "with data from ...").
        // The table's per-entry page actions (Mikey): the eye opens
        // the rendered page a visitor would see, the pencil opens the
        // template canvas through this entry's data. Row click stays
        // the data editor.
        openEntryPage ( id )
        {
            if ( !this.confirmEntryLeave( () => this.openEntryPage( id ) ) ) { return; }

            const entry = ( this.collectionEditor?.entries ?? [] ).find( ( candidate ) => candidate.id === id );

            this.layoutName = entry?.layout ?? 'default';
            this.openSurface( 'template' );
            this.sampleEntryId = id;
        },

        // Row previews open the HUMAN preview at the thing's real
        // address (Mikey): /preview/about/events/talk-of-the-town/,
        // never the internal per-id routes. The slug derivation
        // mirrors emission - title slug, collision suffixes in entry
        // order, drafts and page-less entries skipped.
        entryAddressOf ( id )
        {
            const editor = this.collectionEditor;
            const taken = new Set();
            let slug = null;

            for ( const entry of editor?.entries ?? [] )
            {
                if ( entry.draft === true ) { continue; }
                if ( entry.hasOwnBlocks !== true && editor?.templateBlocks === undefined ) { continue; }

                const base = String( entry.values?.title ?? '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ) || entry.id.slice( 0, 8 );
                let candidate = base;
                let suffix = 2;

                while ( taken.has( candidate ) )
                {
                    candidate = `${base}-${suffix}`;
                    suffix += 1;
                }

                taken.add( candidate );

                if ( entry.id === id ) { slug = candidate; }
            }

            return slug === null ? null : `${this.collectionAddress}${slug}/`;
        },

        termAddressOf ( id )
        {
            const terms = this.taxonomyEditor?.terms ?? [];
            const target = terms.find( ( term ) => term.id === id );

            if ( target === undefined ) { return null; }

            const slugOf = ( term ) => String( term.name ?? '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ) || term.id.slice( 0, 8 );
            const segments = [ slugOf( target ) ];
            const visited = new Set( [ id ] );
            let parent = target.parent;

            while ( parent !== undefined && !visited.has( parent ) )
            {
                visited.add( parent );

                const parentTerm = terms.find( ( term ) => term.id === parent );

                if ( parentTerm === undefined ) { break; }

                segments.unshift( slugOf( parentTerm ) );
                parent = parentTerm.parent;
            }

            return `/${[ this.stem, ...segments ].join( '/' )}/`;
        },

        previewTermPage ( id )
        {
            const address = this.termAddressOf( id );

            if ( address !== null ) { window.open( `/preview${address}`, '_blank' ); }
        },

        previewEntryPage ( id )
        {
            const address = this.entryAddressOf( id );

            if ( address === null ) { return; }

            window.open( `/preview${address}`, '_blank' );
        },

        // On a taxonomy's template canvas the sample is a TERM; the
        // sampleEntryId state doubles as the sample term id there.
        get sampleTerm ()
        {
            const terms = this.taxonomyEditor?.terms ?? [];

            return terms.find( ( term ) => term.id === this.sampleEntryId ) ?? terms[ 0 ] ?? null;
        },

        get sampleEntry ()
        {
            const entries = this.collectionEditor?.entries ?? [];

            return entries.find( ( entry ) => entry.id === this.sampleEntryId ) ?? entries[ 0 ] ?? null;
        },

        get sampleEntryLabel ()
        {
            if ( this.workspace === 'taxonomy' )
            {
                const name = this.sampleTerm?.name;

                return name === '' || name === undefined ? t( 'kindTerm' ) : name;
            }

            const title = this.sampleEntry?.values?.title;

            return title === undefined || title === '' ? t( 'kindEntry' ) : String( title );
        },

        chooseSampleEntry ( id )
        {
            this.sampleEntryId = id;
            this.samplePickerOpen = false;
            this.contentVersion += 1;
        },

        // A template canvas addresses its parts by the path's first
        // name: header[i], blocks[i], footer[i] (SCHEMA 12.6).
        partOfPath ( path )
        {
            return /^(header|footer)/.exec( String( path ?? '' ) )?.[ 1 ] ?? 'blocks';
        },

        get surfaceBlocks ()
        {
            if ( this.workspace === 'template' ) { return this.snapshot?.templates?.[ this.surface ]?.blocks ?? []; }
            if ( this.workspace === 'settings' ) { return this.snapshot?.regionBlocks?.[ this.surface ] ?? []; }

            const editor = this.workspace === 'taxonomy' ? this.taxonomyEditor : this.collectionEditor;

            if ( this.surface === 'template' ) { return editor?.layouts?.[ this.layoutName ]?.blocks ?? editor?.templateBlocks ?? []; }
            if ( this.surface === 'index' ) { return editor?.indexBlocks ?? []; }
            if ( this.surface === 'entry' ) { return editor?.entryLayouts?.[ this.sampleEntryId ] ?? []; }

            return [];
        },

        get surfaceLabel ()
        {
            if ( this.workspace === 'template' ) { return this.surface ?? ''; }
            if ( this.surface === 'header' ) { return t( 'surfaceHeader' ); }
            if ( this.surface === 'footer' ) { return t( 'surfaceFooter' ); }
            if ( this.surface === 'notFound' ) { return t( 'surfaceNotFound' ); }
            if ( this.surface === 'entry' ) { return t( 'surfaceEntryLayout' ); }
            if ( this.surface === 'index' ) { return t( 'surfaceIndex' ); }

            // A user-defined partial's surface speaks its own name.
            if ( this.workspace === 'settings' && this.surface !== null ) { return this.surface; }

            return t( this.workspace === 'taxonomy' ? 'surfaceTermTemplate' : 'surfaceTemplate' );
        },

        // The center header's meta line: "3 entries · index at /events/".
        get collectionMeta ()
        {
            const editor = this.collectionEditor;

            if ( editor === null ) { return ''; }

            if ( this.collectionView === 'fields' ) { return t( 'fieldsMeta' ); }

            const count = tCount( 'entriesMeta', editor.entries.length );
            const indexPart = editor.index === false ? t( 'noPublicIndex' ) : tFill( 'indexAt', { stem: this.collectionAddress.replace( /^\/|\/$/g, '' ) } );

            return `${count} · ${indexPart}`;
        },

        get taxonomyMeta ()
        {
            const editor = this.taxonomyEditor;

            return editor === null ? '' : tCount( 'termsMeta', editor.terms.length );
        },

        // How far a template edit reaches: the conforming entries.
        get templateReachLabel ()
        {
            const count = ( this.collectionEditor?.entries ?? [] ).filter( ( entry ) => entry.hasOwnBlocks !== true ).length;

            return tCount( 'templateReach', count );
        },

        // A field row's right-hand summary: "text · required · the
        // label", "taxonomy · Venue", "reference · Venues".
        fieldSummary ( fieldRow )
        {
            const parts = [ fieldRow.type ];

            if ( fieldRow.refTarget !== undefined && fieldRow.refTarget !== '' && this.fieldNeedsTarget( fieldRow ) )
            {
                const pool = fieldRow.type === 'taxonomy' ? this.taxonomyOptions : this.collectionRefOptions;

                parts.push( pool.find( ( option ) => option.stem === fieldRow.refTarget )?.label ?? fieldRow.refTarget );
            }

            if ( fieldRow.required ) { parts.push( t( 'fieldRequiredMark' ) ); }
            if ( fieldRow.help !== '' ) { parts.push( fieldRow.help ); }

            return parts.join( ' · ' );
        },

        openCollection ( file )
        {
            if ( !this.confirmEntryLeave( () => this.openCollection( file ) ) ) { return; }

            this.enterWorkspace( 'collection', file );
            void this.loadCollection();
        },

        async loadCollection ()
        {
            const file = this.workspaceFile;

            if ( file === null ) { return; }

            const query = new URLSearchParams( { file } );
            const response = await fetch( `/api/collection?${query.toString()}` );

            if ( !response.ok || this.workspaceFile !== file ) { return; }

            const loaded = await response.json();

            for ( const entry of loaded.entries )
            {
                for ( const [ key, field ] of Object.entries( loaded.fields ) )
                {
                    if ( entry.values[ key ] === undefined ) { entry.values[ key ] = emptyValueFor( field ); }
                }
            }

            this.collectionEditor = loaded;

            if ( this.selectedEntryId !== null && !loaded.entries.some( ( entry ) => entry.id === this.selectedEntryId ) )
            {
                this.selectedEntryId = null;
            }
        },

        get entryEditor ()
        {
            if ( this.collectionEditor === null || this.selectedEntryId === null ) { return null; }

            return this.collectionEditor.entries.find( ( entry ) => entry.id === this.selectedEntryId ) ?? null;
        },

        get entryFieldKeys ()
        {
            return Object.keys( this.collectionEditor?.fields ?? {} );
        },

        // The entry table's columns (SCHEMA section 13.1): the header's
        // table list when given, else the title plus the first scalar
        // fields; the layout-state column always rides along.
        get entryColumns ()
        {
            const editor = this.collectionEditor;

            if ( editor === null ) { return []; }
            if ( Array.isArray( editor.table ) ) { return editor.table; }

            const scalar = [ 'text', 'date', 'number', 'select', 'url', 'email' ];
            const extras = Object.entries( editor.fields )
                .filter( ( [ key, field ] ) => key !== 'title' && scalar.includes( field.type ) )
                .map( ( [ key ] ) => key )
                .slice( 0, 2 );

            return [ 'title', ...extras ];
        },

        columnLabel ( key )
        {
            return this.collectionEditor?.fields?.[ key ]?.label ?? key;
        },

        // References resolve to labels everywhere in the editor
        // (SCHEMA 13.3): an id never reaches the user's eyes - a term
        // shows its name, an entry its title.
        referenceLabelFor ( field, id )
        {
            // A multiple reference labels as its targets, joined.
            if ( Array.isArray( id ) )
            {
                return id.map( ( one ) => this.referenceLabelFor( field, one ) ).filter( ( name ) => name !== '' ).join( ', ' );
            }

            if ( typeof field.rules?.taxonomy === 'string' )
            {
                const taxonomy = this.collectionEditor?.taxonomies?.find( ( candidate ) => candidate.stem === field.rules.taxonomy );

                return taxonomy?.terms.find( ( term ) => term.id === id )?.name ?? '';
            }

            const target = this.collectionEditor?.collectionRefs?.find( ( candidate ) => candidate.stem === field.rules?.type );

            return target?.entries.find( ( entry ) => entry.id === id )?.title ?? '';
        },

        cellText ( entry, key )
        {
            const value = entry.values[ key ];

            if ( value === undefined || value === null || value === '' ) { return ''; }

            const field = this.collectionEditor?.fields?.[ key ];

            if ( field?.type === 'reference' )
            {
                return this.referenceLabelFor( field, value );
            }

            return String( value );
        },

        // ---- Abandon-level validation (Mikey's rule) ----
        // Leaving an entry whose required fields are empty stops for
        // a choice: keep it as a draft (publish will name it) or
        // discard it. Never a silent loss, never a silent keep. The
        // entry is already on disk - edits write through - so "keep"
        // costs nothing and "discard" is journal-undoable.

        get entryMissingRequired ()
        {
            const entry = this.entryEditor;
            const fields = this.collectionEditor?.fields;

            if ( entry === null || fields === undefined ) { return []; }

            return Object.entries( fields )
                .filter( ( [ key, field ] ) =>
                {
                    if ( field.required !== true ) { return false; }

                    const value = entry.values[ key ];

                    if ( value === undefined || value === null ) { return true; }
                    if ( typeof value === 'string' ) { return value.trim() === ''; }
                    if ( Array.isArray( value ) ) { return value.length === 0; }

                    return false;
                } )
                .map( ( [ , field ] ) => field.label );
        },

        // Returns true when leaving is fine; otherwise stashes the
        // navigation and opens the prompt. Callers begin with
        // `if ( !this.confirmEntryLeave( () => this.x() ) ) return;`.
        confirmEntryLeave ( retry )
        {
            if ( this.abandonBypass ) { return true; }
            if ( this.workspace !== 'collection' || this.surface !== null || this.entryEditor === null ) { return true; }
            if ( this.entryMissingRequired.length === 0 ) { return true; }

            const title = this.entryEditor.values?.title;

            this.abandonName = title === undefined || title === '' ? t( 'kindEntry' ) : String( title );
            this.pendingAbandon = retry;
            return false;
        },

        cancelAbandon ()
        {
            this.pendingAbandon = null;
        },

        get tFillAbandonTitle ()
        {
            return tFill( 'abandonTitle', { name: this.abandonName } );
        },

        get abandonMissingLine ()
        {
            return tFill( 'abandonMissing', { fields: this.entryMissingRequired.join( ', ' ) } );
        },

        // Keep draft is literal (Mikey's rule): the entry gains
        // "draft": true - kept, editable, and omitted from the
        // published site and from enforcement until the switch clears.
        async keepDraftAndGo ()
        {
            const retry = this.pendingAbandon;
            const file = this.workspaceFile;
            const id = this.selectedEntryId;

            this.pendingAbandon = null;

            if ( file !== null && id !== null )
            {
                this.suppressReloadUntil = Date.now() + 1500;
                await fetch( '/api/entry', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file, id, draft: true } ),
                } );
                await this.loadCollection();
            }

            this.abandonBypass = true;

            try { retry?.(); }
            finally { this.abandonBypass = false; }

            void this.refresh();
        },

        async toggleEntryDraft ()
        {
            const entry = this.entryEditor;

            if ( entry === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/entry', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, id: entry.id, draft: entry.draft !== true } ),
            } );
            await this.loadCollection();
            void this.refresh();
        },

        async togglePageDraft ()
        {
            const page = this.selectedPage;

            if ( page === undefined ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/page', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { id: page.id, patch: { draft: page.draft !== true } } ),
            } );
            void this.refresh();
        },

        async discardEntryAndGo ()
        {
            await fetch( '/api/entry', {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, id: this.selectedEntryId } ),
            } );
            this.selectedEntryId = null;
            await this.loadCollection();
            this.keepDraftAndGo();
            void this.refresh();
        },

        selectEntry ( id )
        {
            if ( id !== this.selectedEntryId && !this.confirmEntryLeave( () => this.selectEntry( id ) ) ) { return; }

            this.selectedEntryId = id;
            this.collectionView = 'entries';
            this.selectedFieldKey = null;
            this.tab = 'content';
            this.confirmTarget = null;
            void this.loadUsage( id, { kind: 'entry', id } );
            this.focusInspector();
        },

        // Creation always begins in a modal (Mikey's rule, matching
        // the boards): the essential name first, then the right-side
        // bar - which is for EDITING existing things - takes over.
        // An entry's create modal carries the WHOLE form (Mikey's
        // preference): every field, required nags included, so an
        // entry can be born complete.
        openCreate ( kind )
        {
            this.createKind = kind;
            this.createLabel = '';

            if ( kind === 'field' ) { this.createFieldDraft = { type: 'text', required: false, refTarget: '' }; }

            if ( kind === 'entry' )
            {
                const values = {};

                for ( const [ key, field ] of Object.entries( this.collectionEditor?.fields ?? {} ) )
                {
                    values[ key ] = emptyValueFor( field );
                }

                this.createValues = values;
            }

            this.focusCreateForm();
        },

        focusCreateForm ()
        {
            const attempt = ( delay ) => setTimeout( () =>
            {
                const target = this.$refs.createForm?.querySelector( 'input:not([type="color"]), textarea, select' );

                if ( target !== undefined && target !== null && document.activeElement !== target )
                {
                    target.focus();
                }
            }, delay );

            attempt( 120 );
            attempt( 400 );
        },

        get createTitleLine ()
        {
            const titles = { page: t( 'createPageTitle' ), entry: t( 'createEntryTitle' ), term: t( 'createTermTitle' ), field: t( 'createFieldTitle' ) };

            return titles[ this.createKind ] ?? '';
        },

        get createPlaceholder ()
        {
            const placeholders = { page: t( 'pageTitlePlaceholder' ), entry: t( 'entryTitlePlaceholder' ), term: t( 'termNamePlaceholder' ), field: t( 'fieldNamePlaceholder' ) };

            return placeholders[ this.createKind ] ?? '';
        },

        get createConfirmLine ()
        {
            const labels = { page: t( 'createPageConfirm' ), entry: t( 'createEntryConfirm' ), term: t( 'createTermConfirm' ), field: t( 'addField' ) };

            return labels[ this.createKind ] ?? '';
        },

        get createSlugPreview ()
        {
            if ( this.createKind !== 'page' ) { return ''; }

            const slug = this.createLabel.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

            return slug === '' ? '' : tFill( 'createPageSlugNote', { slug } );
        },

        async submitCreate ()
        {
            const kind = this.createKind;
            const label = kind === 'entry' ? String( this.createValues.title ?? '' ).trim() : this.createLabel.trim();

            if ( kind === null || label === '' ) { return; }

            this.createKind = null;

            // A field never leaves the chrome here: it joins the
            // fields draft and rides the debounced fields save.
            if ( kind === 'field' )
            {
                const draft = this.createFieldDraft ?? { type: 'text', required: false, refTarget: '' };
                const words = label.toLowerCase().replace( /[^a-z0-9]+/g, ' ' ).trim().split( ' ' ).filter( ( word ) => word !== '' );
                const base = words.map( ( word, index ) => index === 0 ? word : word.charAt( 0 ).toUpperCase() + word.slice( 1 ) ).join( '' ) || 'field';
                let key = base;
                let suffix = 2;

                while ( this.fieldsDraft?.some( ( field ) => field.key === key ) )
                {
                    key = `${base}${suffix}`;
                    suffix += 1;
                }

                this.fieldsDraft?.push( { key, label, type: draft.type, required: draft.required, help: '', column: false, refTarget: draft.refTarget, format: '' } );
                this.selectField( key );
                this.markFieldsDirty();
                this.createFieldDraft = null;
                return;
            }

            this.suppressReloadUntil = Date.now() + 1500;

            if ( kind === 'page' )
            {
                const response = await fetch( '/api/page', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { title: label } ),
                } );

                if ( !response.ok ) { return; }

                const created = await response.json();

                await this.refresh();
                this.selectPage( created.id );
                return;
            }

            if ( kind === 'entry' )
            {
                const response = await fetch( '/api/entry', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, values: JSON.parse( JSON.stringify( this.createValues ) ) } ),
                } );

                if ( !response.ok ) { return; }

                const created = await response.json();

                await this.loadCollection();
                this.selectEntry( created.id );
                void this.refresh();
                return;
            }

            const response = await fetch( '/api/term', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, name: label } ),
            } );

            if ( !response.ok ) { return; }

            const created = await response.json();

            await this.loadTaxonomy();
            this.selectTerm( created.id );
            void this.refresh();
        },

        // Choosing to edit something focuses its first input. The
        // inspector's field templates stamp asynchronously and the
        // surrounding refresh can re-render right after, so it tries
        // once early and once after the churn settles - the second
        // pass only acts if the first got stomped.
        focusInspector ()
        {
            const attempt = ( delay ) => setTimeout( () =>
            {
                // The user beat us to a field - never fight them
                // (Mikey: clicking Description lost to the delayed
                // name autofocus). Any focused control or the canvas
                // itself means their hands are already somewhere.
                const active = document.activeElement;

                if ( active instanceof HTMLElement
                    && active.matches( 'input, textarea, select, [contenteditable], iframe' ) ) { return; }

                const target = this.$refs.inspectorContent
                    ?.querySelector( 'input:not([type="color"]), textarea, select' );

                if ( target !== undefined && target !== null && document.activeElement !== target )
                {
                    target.focus();
                }
            }, delay );

            attempt( 120 );
            attempt( 450 );
        },

        markEntryDirty ()
        {
            this.dirty += 1;
            clearTimeout( this.entrySaveTimer );
            this.entrySaveTimer = setTimeout( () => void this.saveEntry(), 400 );
        },

        async saveEntry ()
        {
            const entry = this.entryEditor;

            if ( entry === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/entry', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( {
                    file: this.workspaceFile,
                    id: entry.id,
                    values: JSON.parse( JSON.stringify( entry.values ) ),
                } ),
            } );
            void this.refresh();
        },

        // The Settings tab owns what the creation modal offered
        // (Mikey's rule): the name and the public-index choice live
        // there, editable after the fact. Renaming changes the label
        // people see; the file keeps its stem.
        markMetaDirty ()
        {
            this.dirty += 1;

            // The nav follows the rename instantly - the snapshot row
            // is patched optimistically, the debounced write and the
            // refresh confirm it a moment later.
            const isTaxonomy = this.workspace === 'taxonomy';
            const label = isTaxonomy ? this.taxonomyEditor?.label : this.collectionEditor?.label;
            const rows = isTaxonomy ? this.snapshot?.taxonomies : this.snapshot?.collections;
            const row = rows?.find( ( candidate ) => candidate.file === this.workspaceFile );

            if ( row !== undefined && typeof label === 'string' && label.trim() !== '' ) { row.label = label.trim(); }

            clearTimeout( this.metaSaveTimer );
            this.metaSaveTimer = setTimeout( () => void this.saveMeta(), 500 );
        },

        async saveMeta ()
        {
            const isTaxonomy = this.workspace === 'taxonomy';
            const label = isTaxonomy ? this.taxonomyEditor?.label : this.collectionEditor?.label;

            if ( typeof label !== 'string' || label.trim() === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( isTaxonomy ? '/api/taxonomy' : '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { label: label.trim() } } ),
            } );
            void this.refresh();
        },

        // The name is required (it is how the collection or taxonomy
        // is listed everywhere). Emptying it never persists - saveMeta
        // refuses blanks - so blurring an emptied name raises a guard
        // that either restores the last good name or refocuses the
        // input to finish typing a new one.
        get metaNameMissing ()
        {
            if ( this.workspace === 'page' )
            {
                return this.selectedPage !== undefined && typeof this.pageTitleDraft === 'string' && this.pageTitleDraft.trim() === '';
            }

            const label = this.workspace === 'taxonomy' ? this.taxonomyEditor?.label : this.collectionEditor?.label;

            return typeof label === 'string' && label.trim() === '';
        },

        get metaLastGoodLabel ()
        {
            // The snapshot only ever holds valid names - an empty one
            // never persists - so it is the restore point everywhere.
            if ( this.workspace === 'page' ) { return this.selectedPage?.title ?? ''; }

            const rows = this.workspace === 'taxonomy' ? this.snapshot?.taxonomies : this.snapshot?.collections;
            const row = rows?.find( ( candidate ) => candidate.file === this.workspaceFile );

            if ( typeof row?.label === 'string' && row.label.trim() !== '' ) { return row.label; }

            return ( this.workspaceFile ?? '' ).replace( /\.json$/, '' );
        },

        // What the rest of the chrome speaks while the name is being
        // edited (Mikey's rule): an emptied name never leaks - the
        // breadcrumbs, headers, titles, and confirms keep the last
        // valid name until a real one replaces it.
        get collectionDisplayLabel ()
        {
            const label = this.collectionEditor?.label;

            if ( typeof label === 'string' && label.trim() !== '' ) { return label; }

            const row = this.snapshot?.collections?.find( ( candidate ) => candidate.file === this.workspaceFile );

            if ( typeof row?.label === 'string' && row.label.trim() !== '' ) { return row.label; }

            return this.stem ?? '';
        },

        get taxonomyDisplayLabel ()
        {
            const label = this.taxonomyEditor?.label;

            if ( typeof label === 'string' && label.trim() !== '' ) { return label; }

            const row = this.snapshot?.taxonomies?.find( ( candidate ) => candidate.file === this.workspaceFile );

            if ( typeof row?.label === 'string' && row.label.trim() !== '' ) { return row.label; }

            return this.stem ?? '';
        },

        get nameRequiredTitleLine ()
        {
            const kind = this.workspace === 'page' ? 'kindPage' : this.workspace === 'taxonomy' ? 'kindTaxonomy' : 'kindCollection';

            return tFill( 'nameRequiredTitle', { kind: t( kind ) } );
        },

        get restoreNameLine ()
        {
            return tFill( 'restoreName', { name: this.metaLastGoodLabel } );
        },

        metaNameBlurred ()
        {
            if ( this.metaNameMissing )
            {
                this.metaNameGuardFile = this.workspace === 'page' ? this.selectedPageId : this.workspaceFile;
                this.metaNameGuardOpen = true;
            }
        },

        revertMetaName ()
        {
            // A click that navigated away in the same gesture as the
            // blur leaves the guard aimed at the old workspace; the
            // restore only applies while it is still the one on screen.
            if ( this.workspace === 'page' )
            {
                if ( this.selectedPageId === this.metaNameGuardFile ) { this.pageTitleDraft = this.metaLastGoodLabel; }

                this.metaNameGuardOpen = false;
                return;
            }

            const editor = this.workspace === 'taxonomy' ? this.taxonomyEditor : this.collectionEditor;

            if ( editor !== null && editor !== undefined && this.workspaceFile === this.metaNameGuardFile )
            {
                editor.label = this.metaLastGoodLabel;
                this.markMetaDirty();
            }

            this.metaNameGuardOpen = false;
        },

        keepEditingMetaName ()
        {
            // Captured before the flag flips: the modal button unmounts
            // itself, and $refs resolved after that lands in the dead
            // scope (DEVELOPMENT section 6, the post-await gotcha).
            const input = this.$refs.metaNameInput;

            this.metaNameGuardOpen = false;
            setTimeout( () => input?.focus(), 50 );
        },

        // The page's name rides the same rules as a collection's: the
        // input edits a draft, only valid names reach the nav and the
        // disk, and the required guard covers the rest.
        syncPageTitleDraft ()
        {
            this.pageTitleDraft = this.pages.find( ( page ) => page.id === this.selectedPageId )?.title ?? '';
        },

        markPageTitleDirty ()
        {
            const title = typeof this.pageTitleDraft === 'string' ? this.pageTitleDraft.trim() : '';
            const page = this.selectedPage;

            if ( title === '' || page === undefined ) { return; }

            page.title = title;

            const id = page.id;

            clearTimeout( this.pageTitleTimer );
            this.pageTitleTimer = setTimeout( () => void this.savePageTitle( id, title ), 500 );
        },

        async savePageTitle ( id, title )
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/page', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { id, patch: { title } } ),
            } );
            void this.refresh();
        },

        // The offered address change (SCHEMA 13.6: renames move
        // subtrees - offered, never silent): when the title's slug
        // and the page's address diverge, Settings offers the move.
        get pageAddressOffer ()
        {
            const page = this.selectedPage;

            if ( page === undefined || page.slug === 'home' ) { return ''; }

            const slug = ( page.title ?? '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

            if ( slug === '' || slug === page.slug ) { return ''; }
            if ( this.pages.some( ( candidate ) => candidate.id !== page.id && candidate.slug === slug ) ) { return ''; }

            return slug;
        },

        pageAddressWith ( slug )
        {
            const segments = this.selectedPage === undefined ? [] : this.pagePathOf( this.selectedPage.id );

            if ( segments.length === 0 ) { return `/${slug}/`; }

            return '/' + [ ...segments.slice( 0, -1 ), slug ].join( '/' ) + '/';
        },

        get addressOfferLine ()
        {
            return tFill( 'addressOffer', { path: this.pageAddressWith( this.pageAddressOffer ) } );
        },

        get addressTitleLine ()
        {
            return tFill( 'addressTitle', {
                old: this.pageAddressWith( this.selectedPage?.slug ?? '' ),
                new: this.pageAddressWith( this.pageAddressOffer ),
            } );
        },

        async confirmAddressChange ()
        {
            this.addressConfirmOpen = false;

            const id = this.selectedPageId;
            const slug = this.pageAddressOffer;

            if ( id === null || slug === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/page', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { id, patch: { slug } } ),
            } );
            void this.refresh();
        },

        // Deleting a page refuses while anything is nested under it
        // (server-enforced too); the chrome says so up front.
        get pageHasNested ()
        {
            const id = this.selectedPageId;

            if ( id === null ) { return false; }

            return this.pages.some( ( page ) => page.parent === id )
                || this.collections.some( ( collection ) => collection.parent === id );
        },

        // The offered file rename (SCHEMA 13.3: offer, never
        // silently): when the label's slug and the file's stem
        // diverge, Settings offers the move; accepting rewrites every
        // repeat and reference that names the old stem, one undo
        // reverses it all.
        get renameOfferFile ()
        {
            const label = this.workspace === 'taxonomy' ? this.taxonomyEditor?.label : this.collectionEditor?.label;

            if ( typeof label !== 'string' || label.trim() === '' ) { return ''; }

            const slug = label.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

            if ( slug === '' || `${slug}.json` === this.workspaceFile ) { return ''; }

            return `${slug}.json`;
        },

        get tFillRenameOffer ()
        {
            return tFill( 'renameOffer', { file: this.renameOfferFile } );
        },

        get renameTitleLine ()
        {
            return tFill( 'renameTitle', { old: this.workspaceFile ?? '', new: this.renameOfferFile } );
        },

        get renameBodyLine ()
        {
            if ( this.workspace === 'taxonomy' ) { return t( 'renameBodyTaxonomy' ); }

            return tFill( 'renameBodyCollection', {
                oldStem: this.stem,
                newStem: this.renameOfferFile.replace( /\.json$/, '' ),
            } );
        },

        async confirmRename ()
        {
            this.renameConfirmOpen = false;

            const isTaxonomy = this.workspace === 'taxonomy';

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( isTaxonomy ? '/api/taxonomy' : '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { renameFile: true } } ),
            } );

            if ( response.ok )
            {
                const body = await response.json();

                if ( typeof body.file === 'string' ) { this.workspaceFile = body.file; }
            }

            if ( isTaxonomy ) { await this.loadTaxonomy(); }
            else { await this.loadCollection(); }

            void this.refresh();
        },

        async toggleTaxonomySetting ()
        {
            const editor = this.taxonomyEditor;

            if ( editor === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/taxonomy', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { index: editor.index === false } } ),
            } );
            await this.loadTaxonomy();
        },

        // Hierarchy turns on freely; turning it off is locked while
        // any term is nested (the server refuses it too) - structure
        // is never severed silently.
        // Off with nested terms asks first (Mikey, 2026-09-05): the
        // terms flatten to the top level in one journaled write, so
        // undo brings the nesting back.
        async toggleTaxonomyHierarchical ( confirmed = false )
        {
            const editor = this.taxonomyEditor;

            if ( editor === null ) { return; }

            if ( editor.hierarchical === true && this.taxonomyHasNested && !confirmed )
            {
                this.hierarchyOffOpen = true;
                return;
            }

            this.hierarchyOffOpen = false;
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/taxonomy', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { hierarchical: editor.hierarchical !== true, ...( editor.hierarchical === true ? { flatten: true } : {} ) } } ),
            } );
            await this.loadTaxonomy();
            void this.refresh();
        },

        async toggleCollectionSetting ( key )
        {
            const editor = this.collectionEditor;

            if ( editor === null ) { return; }

            const patch = key === 'index'
                ? { index: editor.index === false }
                : { locked: editor.locked !== true };

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch } ),
            } );
            await this.loadCollection();
        },

        // The Fields workspace (EDITOR section 5): the collection's
        // shape as an editable list. The draft carries the simple keys
        // (label, type, required, help, table column); a field's
        // options or nested fields stay in the file, untouched.
        openFields ()
        {
            if ( !this.confirmEntryLeave( () => this.openFields() ) ) { return; }

            this.collectionView = 'fields';
            this.selectedEntryId = null;
            this.selectedFieldKey = null;
            this.confirmTarget = null;
            this.buildFieldsDraft();
        },

        buildFieldsDraft ()
        {
            const editor = this.collectionEditor;

            if ( editor === null )
            {
                this.fieldsDraft = null;
                return;
            }

            const columns = Array.isArray( editor.table ) ? editor.table : this.entryColumns;

            // The chrome speaks two types where the schema has one
            // (Mikey's vocabulary): "taxonomy" pulls a taxonomy's
            // terms, "reference" pulls a collection's entries - both
            // stored as the reference type with the matching rule.
            this.fieldsDraft = Object.entries( editor.fields ).map( ( [ key, field ] ) => ( {
                key,
                label: field.label,
                type: field.type === 'reference' && typeof field.rules?.taxonomy === 'string' ? 'taxonomy' : field.type,
                required: field.required === true,
                help: field.help ?? '',
                column: columns.includes( key ),
                refTarget: field.rules?.taxonomy ?? field.rules?.type ?? '',
                format: field.rules?.format ?? '',
                multiple: field.rules?.multiple === true,
            } ) );
        },

        setFieldDateFormat ( value )
        {
            if ( this.fieldEditor === null ) { return; }

            this.fieldEditor.format = value;
            this.markFieldsDirty();
        },

        // The key IS a slug of the label (Mikey): when the label
        // input settles, the key follows - "Location / Venue" becomes
        // locationVenue, collisions suffix to locationVenue2 - and
        // the server sweeps every reference (binds, inline tokens,
        // order, entry values, table, conditions). Title stays title:
        // it is the contract key. The whole sequence rides the fields
        // chain so no debounced save interleaves it.
        async syncFieldKey ()
        {
            const from = this.fieldEditor?.key;
            const file = this.workspaceFile;

            if ( from === undefined || file === null || from === 'title' ) { return; }

            clearTimeout( this.fieldsSaveTimer );

            await this.queueFieldsOp( async () =>
            {
                // Re-read inside the chain: an earlier queued rename
                // may have already moved this field.
                const editor = this.fieldsDraft?.find( ( field ) => field.key === from );

                if ( editor === undefined || this.workspaceFile !== file ) { return; }

                const words = editor.label.toLowerCase().replace( /[^a-z0-9]+/g, ' ' ).trim().split( ' ' ).filter( ( word ) => word !== '' );
                const target = words.map( ( word, index ) => ( index === 0 ? word : word.charAt( 0 ).toUpperCase() + word.slice( 1 ) ) ).join( '' );

                if ( target === '' || !/^[a-z]/.test( target ) || target === from ) { return; }

                let unique = target;
                let suffix = 2;

                while ( this.fieldsDraft?.some( ( field ) => field.key === unique ) )
                {
                    unique = `${target}${suffix}`;
                    suffix += 1;
                }

                // The pending label save settles first, so the rename
                // lands on the document it expects.
                await this.saveFields();

                this.suppressReloadUntil = Date.now() + 1500;

                const response = await fetch( '/api/field-rename', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file, from, to: unique } ),
                } );

                if ( !response.ok ) { return; }

                await this.loadCollection();
                this.buildFieldsDraft();

                if ( this.selectedFieldKey === from ) { this.selectedFieldKey = unique; }

                void this.refresh();
            } );
        },

        get fieldEditor ()
        {
            if ( this.fieldsDraft === null || this.selectedFieldKey === null ) { return null; }

            return this.fieldsDraft.find( ( field ) => field.key === this.selectedFieldKey ) ?? null;
        },

        // The field's tag as a layout would write it; the line under
        // the name copies it on click (Mikey, 2026-09-03) and says
        // "Copied" for a moment in its place.
        get fieldTag ()
        {
            return this.fieldEditor === null ? '' : `{{ $entry.${this.fieldEditor.key} }}`;
        },

        async copyFieldTag ()
        {
            const tag = this.fieldTag;

            if ( tag === '' ) { return; }

            await copyText( tag );
            this.fieldTagCopied = true;
            clearTimeout( this.fieldTagCopiedTimer );
            this.fieldTagCopiedTimer = setTimeout( () => { this.fieldTagCopied = false; }, 1400 );
        },

        // The simple types a field can become from the chrome; select,
        // list, and group keep their richer shape and stay put. Two of
        // these are the chrome's spelling of SCHEMA 13.3 references:
        // "taxonomy" (term picker) and "reference" (entry picker).
        get simpleFieldTypes ()
        {
            return [ 'text', 'textarea', 'markdown', 'number', 'date', 'url', 'email', 'toggle', 'image', 'taxonomy', 'reference' ];
        },

        fieldTypeEditable ( field )
        {
            return this.simpleFieldTypes.includes( field.type );
        },

        get taxonomyOptions ()
        {
            return this.collectionEditor?.taxonomies ?? [];
        },

        get collectionRefOptions ()
        {
            return this.collectionEditor?.collectionRefs ?? [];
        },

        // What the selected field's References picker offers: the
        // taxonomies for a taxonomy field, the OTHER collections for a
        // reference field (an entry never references its own shape).
        get fieldTargetOptions ()
        {
            if ( this.fieldEditor?.type === 'taxonomy' )
            {
                return this.taxonomyOptions.map( ( option ) => ( { value: option.stem, label: option.label } ) );
            }

            return this.collectionRefOptions
                .filter( ( option ) => option.stem !== this.stem )
                .map( ( option ) => ( { value: option.stem, label: option.label } ) );
        },

        fieldNeedsTarget ( field )
        {
            return field.type === 'taxonomy' || field.type === 'reference';
        },

        get createFieldTargetOptions ()
        {
            if ( this.createFieldDraft?.type === 'taxonomy' )
            {
                return this.taxonomyOptions.map( ( option ) => ( { value: option.stem, label: option.label } ) );
            }

            return this.collectionRefOptions
                .filter( ( option ) => option.stem !== this.stem )
                .map( ( option ) => ( { value: option.stem, label: option.label } ) );
        },

        setCreateFieldType ( value )
        {
            const draft = this.createFieldDraft;

            if ( draft === null ) { return; }

            draft.type = value;

            if ( this.fieldNeedsTarget( draft ) )
            {
                const valid = this.createFieldTargetOptions.some( ( option ) => option.value === draft.refTarget );

                if ( !valid ) { draft.refTarget = this.createFieldTargetOptions[ 0 ]?.value ?? ''; }
            }
        },

        setFieldType ( value )
        {
            const field = this.fieldEditor;

            if ( field === null ) { return; }

            field.type = value;

            if ( this.fieldNeedsTarget( field ) )
            {
                const valid = this.fieldTargetOptions.some( ( option ) => option.value === field.refTarget );

                if ( !valid ) { field.refTarget = this.fieldTargetOptions[ 0 ]?.value ?? ''; }
            }

            this.markFieldsDirty();
        },

        setFieldReferenceTarget ( value )
        {
            const field = this.fieldEditor;

            if ( field === null ) { return; }

            field.refTarget = value;
            this.markFieldsDirty();
        },

        // Header and footer are every site's partials (SCHEMA 12.5):
        // they empty, never delete.
        partialIsReserved ( name )
        {
            return name === 'header' || name === 'footer';
        },

        // A layout's page template (SCHEMA 12.6, Mikey): the index page
        // and the entry or term template each render through one;
        // "default" clears the choice.
        async setLayoutTemplate ( layout, name )
        {
            const taxonomy = this.workspace === 'taxonomy';
            const key = layout === 'index' ? 'indexTemplate' : ( taxonomy ? 'termTemplate' : 'entryTemplate' );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( taxonomy ? '/api/taxonomy' : '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { [ key ]: name === 'default' ? null : name } } ),
            } );

            if ( taxonomy ) { await this.loadTaxonomy(); }
            else { await this.loadCollection(); }

            this.contentVersion += 1;
        },

        showEntriesView ()
        {
            this.collectionView = 'entries';
            this.selectedFieldKey = null;
        },

        // Layouts (Mikey): the canvases a collection or taxonomy renders
        // through - its index page and its entry or term template -
        // as a third view beside the rows and the fields, each row
        // opening the same surface the inspector's Structure card
        // opens.
        showLayoutsView ()
        {
            if ( !this.confirmEntryLeave( () => this.showLayoutsView() ) ) { return; }

            this.collectionView = 'layouts';
            this.layoutsRowName = null;
            this.selectedEntryId = null;
            this.selectedFieldKey = null;
            this.confirmTarget = null;
        },

        showTermsView ()
        {
            this.taxonomyView = 'terms';
        },

        showTaxonomyLayoutsView ()
        {
            this.taxonomyView = 'layouts';
            this.layoutsRowName = null;
            this.selectedTermId = null;
        },

        toggleFieldFlag ( flag )
        {
            const field = this.fieldEditor;

            if ( field === null ) { return; }

            field[ flag ] = field[ flag ] !== true;
            this.markFieldsDirty();
        },

        selectField ( key )
        {
            this.selectedFieldKey = key;
            this.tab = 'content';
            this.confirmTarget = null;
            this.focusInspector();
        },

        addField ()
        {
            if ( this.fieldsDraft === null ) { return; }

            let suffix = this.fieldsDraft.length + 1;

            while ( this.fieldsDraft.some( ( field ) => field.key === `field${suffix}` ) ) { suffix += 1; }

            const key = `field${suffix}`;

            this.fieldsDraft.push( { key, label: t( 'newFieldLabel' ), type: 'text', required: false, help: '', column: false, refTarget: '' } );
            this.selectField( key );
            this.markFieldsDirty();
        },

        removeField ( key )
        {
            if ( this.fieldsDraft === null || key === 'title' ) { return; }

            this.fieldsDraft = this.fieldsDraft.filter( ( field ) => field.key !== key );

            if ( this.selectedFieldKey === key ) { this.selectedFieldKey = null; }

            this.markFieldsDirty();
        },

        markFieldsDirty ()
        {
            this.dirty += 1;
            clearTimeout( this.fieldsSaveTimer );
            this.fieldsSaveTimer = setTimeout( () => this.queueFieldsOp( () => this.saveFields() ), 500 );
        },

        // Every fields write rides ONE chain (Mikey's split-rename
        // incident): the debounced whole-record save and the key
        // rename both mutate the same document, and interleaving them
        // let a stale draft resurrect a renamed key - fields said
        // field4 while the entries said image. Serialized, each
        // operation sees the previous one's finished document.
        queueFieldsOp ( operation )
        {
            this.fieldsOpChain = ( this.fieldsOpChain ?? Promise.resolve() ).then( operation ).catch( () => undefined );
            return this.fieldsOpChain;
        },

        async saveFields ()
        {
            const draft = this.fieldsDraft;

            if ( draft === null ) { return; }

            // The chrome's taxonomy/reference pair both store as the
            // schema's reference type, distinguished by the rule.
            const fields = Object.fromEntries( draft.map( ( field ) => [ field.key, {
                type: field.type === 'taxonomy' ? 'reference' : field.type,
                label: field.label,
                required: field.required,
                ...( field.help === '' ? {} : { help: field.help } ),
                ...( field.type === 'taxonomy' && field.refTarget !== '' ? { taxonomy: field.refTarget } : {} ),
                ...( field.type === 'reference' && field.refTarget !== '' ? { collection: field.refTarget } : {} ),
                ...( field.type === 'date' && ( field.format ?? '' ) !== '' ? { format: field.format } : {} ),
                ...( ( field.type === 'reference' || field.type === 'taxonomy' ) && field.multiple === true ? { multiple: true } : {} ),
            } ] ) );
            const table = draft.filter( ( field ) => field.column ).map( ( field ) => field.key );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { fields, table } } ),
            } );
            await this.loadCollection();
        },

        openTaxonomy ( file )
        {
            if ( !this.confirmEntryLeave( () => this.openTaxonomy( file ) ) ) { return; }

            this.enterWorkspace( 'taxonomy', file );
            void this.loadTaxonomy();
        },

        async loadTaxonomy ()
        {
            const file = this.workspaceFile;

            if ( file === null ) { return; }

            const query = new URLSearchParams( { file } );
            const response = await fetch( `/api/taxonomy?${query.toString()}` );

            if ( !response.ok || this.workspaceFile !== file ) { return; }

            this.taxonomyEditor = await response.json();

            if ( this.selectedTermId !== null && !this.taxonomyEditor.terms.some( ( term ) => term.id === this.selectedTermId ) )
            {
                this.selectedTermId = null;
            }
        },

        // The terms in display order: tree order with depths for a
        // hierarchical taxonomy, stored order (all depth 0) otherwise.
        get termRows ()
        {
            const editor = this.taxonomyEditor;

            if ( editor === null ) { return []; }

            if ( editor.hierarchical !== true )
            {
                return editor.terms.map( ( term ) => ( { term, depth: 0 } ) );
            }

            return termTree( editor.terms );
        },

        get taxonomyHasNested ()
        {
            return ( this.taxonomyEditor?.terms ?? [] ).some( ( term ) => term.parent !== undefined );
        },

        // Parent options for the selected term: every term except
        // itself and its own descendants - a hierarchy is a tree.
        // The derived slug (SCHEMA 13.3: from the name, entry-slug
        // rules, never stored) and the address it produces - shown
        // only while term pages are public.
        get termSlug ()
        {
            const name = this.termEditor?.name ?? '';
            const slug = name.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

            return slug === '' ? ( this.termEditor?.id ?? '' ).slice( 0, 8 ) : slug;
        },

        get termAddress ()
        {
            const segments = [ this.termSlug ];
            const terms = this.taxonomyEditor?.terms ?? [];
            const visited = new Set( [ this.termEditor?.id ] );
            let parent = this.termEditor?.parent;

            while ( parent !== undefined && !visited.has( parent ) )
            {
                visited.add( parent );

                const parentTerm = terms.find( ( term ) => term.id === parent );
                const name = parentTerm?.name ?? '';

                segments.unshift( name.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ) || ( parent ?? '' ).slice( 0, 8 ) );
                parent = parentTerm?.parent;
            }

            return '/' + [ this.stem, ...segments ].join( '/' ) + '/';
        },

        get termAddressLine ()
        {
            return tFill( 'termAddressLabel', { address: this.termAddress } );
        },

        get termParentOptions ()
        {
            const editor = this.termEditor;

            if ( editor === null ) { return []; }

            const excluded = new Set( [ editor.id ] );
            let grew = true;

            while ( grew )
            {
                grew = false;

                for ( const term of this.taxonomyEditor?.terms ?? [] )
                {
                    if ( term.parent !== undefined && excluded.has( term.parent ) && !excluded.has( term.id ) )
                    {
                        excluded.add( term.id );
                        grew = true;
                    }
                }
            }

            return this.termRows.filter( ( row ) => !excluded.has( row.term.id ) );
        },

        async setTermParent ( value )
        {
            const term = this.termEditor;

            if ( term === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/term', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, id: term.id, parent: value === '' ? null : value } ),
            } );
            await this.loadTaxonomy();
            void this.refresh();
        },

        get termEditor ()
        {
            if ( this.taxonomyEditor === null || this.selectedTermId === null ) { return null; }

            return this.taxonomyEditor.terms.find( ( term ) => term.id === this.selectedTermId ) ?? null;
        },

        selectTerm ( id )
        {
            this.selectedTermId = id;
            this.tab = 'content';
            this.confirmTarget = null;
            this.focusInspector();
            void this.loadUsage( id, { kind: 'term', id } );
        },

        // The relational "used by" list (Mikey): what references the
        // selected thing, as jump links. Self-mentions filter out -
        // a term's own definition is not a use of it.
        async loadUsage ( target, self = null )
        {
            this.usageRows = null;
            this.usageTarget = typeof target === 'string' ? target : null;

            if ( typeof target !== 'string' || target.length < 4 ) { return; }

            const response = await fetch( `/api/usage?${new URLSearchParams( { target } ).toString()}` );

            if ( !response.ok ) { return; }

            const rows = ( await response.json() ).rows ?? [];

            this.usageRows = rows.filter( ( row ) => !( self !== null && row.kind === self.kind && row.id === self.id ) );
        },

        get usageTabAvailable ()
        {
            return ( this.usageRows ?? [] ).length > 0
                && ( ( this.workspace === 'taxonomy' && this.termEditor !== null )
                    || ( this.workspace === 'collection' && this.entryEditor !== null ) );
        },

        usageRowTitle ( row )
        {
            if ( row.kind === 'site' )
            {
                if ( row.area === 'header' ) { return t( 'usageAreaHeader' ); }
                if ( row.area === 'footer' ) { return t( 'usageAreaFooter' ); }
                if ( row.area === 'notFound' ) { return t( 'usageAreaNotFound' ); }
                if ( String( row.area ).startsWith( 'partial:' ) ) { return String( row.area ).slice( 'partial:'.length ); }

                return t( 'navSiteSettings' );
            }

            return String( row.title ?? '' ) || t( `kind${row.kind.charAt( 0 ).toUpperCase()}${row.kind.slice( 1 )}` );
        },

        usageRowKind ( row )
        {
            if ( row.kind === 'site' )
            {
                return String( row.area ?? '' ).startsWith( 'partial:' ) ? t( 'kindPartial' ) : t( 'kindSite' );
            }

            return t( `kind${row.kind.charAt( 0 ).toUpperCase()}${row.kind.slice( 1 )}` );
        },

        // The landing flash (Mikey): after a usage jump, find the
        // rendered field rows whose value carries the traced target,
        // scroll the first into view, and bloom the wash behind them.
        // Sweeping the DOM after arrival - with retries while the
        // destination loads - works whether the inspector re-stamped
        // its rows or reused them.
        flashUsageLanding ( traced )
        {
            if ( typeof traced !== 'string' || traced === '' ) { return; }

            let attempts = 0;
            const sweep = () =>
            {
                attempts += 1;

                const rows = [ ...document.querySelectorAll( '[x-component="tpl-field-row"]' ) ].filter( ( el ) =>
                {
                    if ( el.offsetParent === null ) { return false; }

                    try
                    {
                        return JSON.stringify( window.Alpine.$data( el ).value ?? null ).includes( traced );
                    }
                    catch
                    {
                        return false;
                    }
                } );

                if ( rows.length === 0 )
                {
                    if ( attempts < 12 ) { setTimeout( sweep, 250 ); }

                    return;
                }

                rows[ 0 ].scrollIntoView( { behavior: 'smooth', block: 'center' } );

                for ( const el of rows )
                {
                    el.classList.remove( 'cs-jump-flash' );

                    // Restart the animation even on a repeated jump
                    // to the same row.
                    void el.offsetWidth;
                    el.classList.add( 'cs-jump-flash' );
                    setTimeout( () => el.classList.remove( 'cs-jump-flash' ), 2800 );
                }
            };

            setTimeout( sweep, 350 );
        },

        // Where the user is RIGHT NOW, precisely enough to return:
        // routes deliberately do not carry selection, so a jump
        // checkpoints it onto the current history entry instead.
        currentSpot ()
        {
            return {
                workspace: this.workspace,
                file: this.workspaceFile,
                pageId: this.selectedPageId,
                entryId: this.selectedEntryId,
                termId: this.selectedTermId,
                menuName: this.menuName,
                mediaView: this.mediaView,
                mediaFile: this.selectedMediaFile,
                surface: this.surface,
                sampleEntryId: this.sampleEntryId,
            };
        },

        restoreSpot ( spot )
        {
            if ( spot.workspace === 'settings' )
            {
                this.openSettings();

                if ( typeof spot.surface === 'string' ) { this.openSurface( spot.surface ); }

                return;
            }

            if ( spot.workspace === 'media' )
            {
                this.openMediaWorkspace();

                if ( spot.mediaView === 'trash' ) { this.setMediaView( 'trash' ); }
                if ( typeof spot.mediaFile === 'string' ) { this.selectMediaFile( spot.mediaFile ); }

                return;
            }

            if ( spot.workspace === 'collection' && typeof spot.file === 'string' )
            {
                this.openCollection( spot.file );

                if ( spot.surface === 'entry' && typeof spot.sampleEntryId === 'string' ) { this.openEntryLayout( spot.sampleEntryId ); }
                else if ( typeof spot.surface === 'string' ) { this.openSurface( spot.surface ); }
                else if ( typeof spot.entryId === 'string' ) { this.selectEntry( spot.entryId ); }

                return;
            }

            if ( spot.workspace === 'taxonomy' && typeof spot.file === 'string' )
            {
                this.openTaxonomy( spot.file );

                if ( typeof spot.surface === 'string' ) { this.openSurface( spot.surface ); }
                else if ( typeof spot.termId === 'string' ) { this.selectTerm( spot.termId ); }

                return;
            }

            if ( spot.workspace === 'menu' && typeof spot.menuName === 'string' )
            {
                this.openMenu( spot.menuName );
                return;
            }

            if ( typeof spot.pageId === 'string' )
            {
                this.selectPage( spot.pageId );
                return;
            }

            void this.applyRoute();
        },

        openUsageRow ( row )
        {
            // The current entry remembers the exact pre-jump spot
            // (routes omit selection); the route watcher pushes the
            // jump's own entry - so Back returns precisely.
            history.replaceState( { casomerSpot: this.currentSpot() }, '', this.routeHash );

            this.flashUsageLanding( this.usageTarget );

            if ( row.kind === 'page' )
            {
                this.selectPage( row.id );
                return;
            }

            if ( row.kind === 'entry' )
            {
                this.openCollection( row.file );
                this.selectEntry( row.id );
                return;
            }

            if ( row.kind === 'collection' )
            {
                this.openCollection( row.file );
                return;
            }

            if ( row.kind === 'term' )
            {
                this.openTaxonomy( row.file );
                this.selectTerm( row.id );
                return;
            }

            if ( row.kind === 'taxonomy' )
            {
                this.openTaxonomy( row.file );
                return;
            }

            const area = String( row.area ?? '' );

            if ( area === 'header' || area === 'footer' || area === 'notFound' )
            {
                this.openSettings();
                this.openSurface( area );
                return;
            }

            if ( area.startsWith( 'partial:' ) )
            {
                this.openSettings();
                this.openSurface( area.slice( 'partial:'.length ) );
                return;
            }

            this.openSettings();
        },

        // Drag-and-drop sort order (Mikey): rows lift and the list
        // shuffles live underneath (Alpine's sort plugin, vendored;
        // the same pattern as the yw-webapp steps list). The DOM
        // order after the drop IS the new sort order - read it,
        // mirror it into state, persist it.
        get sortConfig ()
        {
            return {
                animation: 220,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                forceFallback: true,

                // The clone rides on <body>: appended inside the
                // overflow-hidden card it positions against the wrong
                // ancestor and floats offset from the cursor.
                fallbackOnBody: true,
                fallbackClass: 'sort-drag-clone',
                ghostClass: 'sort-drop-slot',

                // This replaces the sort plugin's own filter (config
                // spreads after its options), so its rules are restated:
                // nothing under x-sort:ignore or a pinned row drags, nor outside
                // an x-sort:item row. One addition (Mikey): a list of ONE
                // row does not drag - there is nothing to reorder - and
                // the stylesheet hides its grip for the same case.
                onMove: ( event ) =>
                {
                    const related = event.related;

                    if ( related === null || related === undefined || !related.hasAttribute( 'data-sort-pinned' ) ) { return true; }

                    const rows = [ ...event.to.querySelectorAll( ':scope > [data-sort-id]' ) ];

                    if ( related === rows[ 0 ] ) { return event.willInsertAfter === true; }
                    if ( related === rows[ rows.length - 1 ] ) { return event.willInsertAfter !== true; }

                    return true;
                },

                filter: ( event, target, sortable ) =>
                {
                    if ( event.target.closest( '[x-sort\\:ignore], [data-sort-pinned]' ) !== null ) { return true; }

                    if ( sortable.el.querySelectorAll( '[x-sort\\:item]' ).length < 2 ) { return true; }

                    return event.target.closest( '[x-sort\\:item]' ) === null;
                },
            };
        },

        rowIndent ( depth )
        {
            return treeRowIndent( depth );
        },

        sortedIdsIn ( container )
        {
            return [ ...container.querySelectorAll( '[data-sort-id]' ) ].map( ( row ) => row.dataset.sortId );
        },

        applyRowOrder ( list, key, ids )
        {
            const byId = new Map( list.map( ( item ) => [ String( item[ key ] ), item ] ) );
            const ordered = ids.map( ( id ) => byId.get( id ) ).filter( ( item ) => item !== undefined );
            const rest = list.filter( ( item ) => !ordered.includes( item ) );

            list.splice( 0, list.length, ...ordered, ...rest );
        },

        // A term dropped in a hierarchical taxonomy: the same rule as
        // the pages table. The family (the term and its descendants)
        // lands whole; the slot's depth, clamped to what the neighbours
        // allow, becomes the parent; siblings keep their order. A flat
        // taxonomy is the plain sorter.
        async sortTermRows ( key, container )
        {
            const editor = this.taxonomyEditor;

            if ( editor === null ) { return; }
            if ( editor.hierarchical !== true )
            {
                await this.sortRows( 'term', container );
                return;
            }

            const moved = editor.terms.find( ( term ) => term.id === key );

            if ( moved === undefined )
            {
                this.sortEpoch += 1;
                return;
            }

            const descendants = new Set();
            const collect = ( id ) =>
            {
                for ( const term of editor.terms )
                {
                    if ( term.parent === id && !descendants.has( term.id ) )
                    {
                        descendants.add( term.id );
                        collect( term.id );
                    }
                }
            };

            collect( key );

            const domRows = [ ...container.querySelectorAll( '[data-sort-id]' ) ].filter( ( row ) => row.dataset.sortId === key || !descendants.has( row.dataset.sortId ) );
            const self = domRows.find( ( row ) => row.dataset.sortId === key );

            if ( self === undefined )
            {
                this.sortEpoch += 1;
                return;
            }

            const at = domRows.indexOf( self );
            const above = domRows[ at - 1 ] ?? null;
            const below = domRows[ at + 1 ] ?? null;
            const min = below === null ? 0 : Number( below.dataset.depth );
            const max = above === null ? 0 : Number( above.dataset.depth ) + 1;
            const requested = self.dataset.dropDepth === undefined ? min : Number( self.dataset.dropDepth );
            const depth = Math.min( max, Math.max( min, requested ) );

            self.dataset.dropped = '1';

            const family = this.termRows.filter( ( row ) => row.term.id === key || descendants.has( row.term.id ) );
            const rootDepth = family[ 0 ]?.depth ?? 0;
            const flat = [];

            for ( const row of domRows )
            {
                if ( row === self )
                {
                    for ( const member of family ) { flat.push( { id: member.term.id, depth: member.depth - rootDepth + depth } ); }
                    continue;
                }

                flat.push( { id: row.dataset.sortId, depth: Number( row.dataset.depth ) } );
            }

            // Depths become parents: the nearest earlier row one level up.
            const stack = [];
            const parents = new Map();
            const order = [];

            for ( const entry of flat )
            {
                while ( stack.length > entry.depth ) { stack.pop(); }

                parents.set( entry.id, entry.depth > 0 ? stack[ entry.depth - 1 ] : undefined );
                order.push( entry.id );
                stack[ entry.depth ] = entry.id;
                stack.length = entry.depth + 1;
            }

            const before = moved.parent;
            const after = parents.get( key );

            // The list takes the new shape at once; the writes land
            // behind it (the parent, then the order) and the reload
            // confirms.
            if ( after === undefined ) { delete moved.parent; }
            else { moved.parent = after; }

            this.applyRowOrder( editor.terms, 'id', order );
            this.sortEpoch += 1;
            this.suppressReloadUntil = Date.now() + 1500;

            if ( before !== after )
            {
                await fetch( '/api/term', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, id: key, parent: after === undefined ? null : after } ),
                } );
            }

            await fetch( '/api/taxonomy', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { termOrder: editor.terms.map( ( term ) => term.id ) } } ),
            } );
            await this.loadTaxonomy();
            void this.refresh();
        },

        async sortRows ( kind, container )
        {
            const ids = this.sortedIdsIn( container );

            // The MDP pattern (yw-webapp gotcha 2): Sortable moved the
            // DOM nodes; busting every x-for key makes Alpine rebuild
            // the rows from data order instead of trusting them.
            this.sortEpoch += 1;

            if ( kind === 'field' && this.fieldsDraft !== null )
            {
                this.applyRowOrder( this.fieldsDraft, 'key', ids );
                this.markFieldsDirty();
                return;
            }

            if ( kind === 'term' && this.taxonomyEditor !== null )
            {
                this.applyRowOrder( this.taxonomyEditor.terms, 'id', ids );
                this.suppressReloadUntil = Date.now() + 1500;
                await fetch( '/api/taxonomy', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, patch: { termOrder: this.taxonomyEditor.terms.map( ( term ) => term.id ) } } ),
                } );
                void this.refresh();
                return;
            }

            if ( kind === 'entry' && this.collectionEditor !== null )
            {
                this.applyRowOrder( this.collectionEditor.entries, 'id', ids );
                this.suppressReloadUntil = Date.now() + 1500;
                await fetch( '/api/collection', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, patch: { entryOrder: this.collectionEditor.entries.map( ( entry ) => entry.id ) } } ),
                } );
                void this.refresh();
            }
        },

        markTermDirty ()
        {
            this.dirty += 1;
            clearTimeout( this.entrySaveTimer );
            this.entrySaveTimer = setTimeout( () => void this.saveTerm(), 400 );
        },

        async saveTerm ()
        {
            const term = this.termEditor;

            if ( term === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/term', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                // The image rides only when the editor actually holds
                // one: absent leaves the document's value alone, so a
                // hand-authored image survives a rename (the picker UI
                // arrives with the media work).
                body: JSON.stringify( {
                    file: this.workspaceFile,
                    id: term.id,
                    name: term.name,
                    description: term.description ?? '',
                    ...( typeof term.image?.src === 'string' && term.image.src !== '' ? { image: term.image } : {} ),
                } ),
            } );
            void this.refresh();
        },

        // The Pages workspace (EDITOR 5): the tree as a table - title,
        // address, template, draft - with the tree kept in the rail.
        openPagesWorkspace ( view = null )
        {
            if ( !this.confirmEntryLeave( () => this.openPagesWorkspace( view ) ) ) { return; }

            this.enterWorkspace( 'pages' );
            this.pagesRowId = null;

            if ( view !== null ) { this.pagesView = view; }
        },

        get templatesMeta ()
        {
            return tCount( 'templatesMeta', this.templateNames.length );
        },

        // The Site workspace (Mikey): partials, menus, and templates as
        // tables, no specific one in the rail. Templates live here
        // because they wrap everything - pages, collection indices
        // and entries, taxonomy indices and terms.
        openSiteWorkspace ( view = null )
        {
            if ( !this.confirmEntryLeave( () => this.openSiteWorkspace( view ) ) ) { return; }

            this.enterWorkspace( 'site' );

            if ( view !== null ) { this.siteView = view; }
        },

        menuItemCount ( name )
        {
            return ( this.snapshot?.config?.menus?.[ name ]?.items ?? [] ).length;
        },

        pageHasChildren ( id )
        {
            return this.pages.some( ( page ) => page.parent === id );
        },

        // The user chip's menu (Mikey): who is editing, the site-level
        // rooms, and which Studio this is. Identity, not accounts.
        get userName ()
        {
            return this.snapshot?.user?.name || t( 'userLocal' );
        },

        get userEmail ()
        {
            return this.snapshot?.user?.email || t( 'userNoEmail' );
        },

        userMenuGo ( where )
        {
            this.userMenuOpen = false;

            if ( where === 'profile' )
            {
                this.profileDraft = { name: this.snapshot?.user?.name ?? '', email: this.snapshot?.user?.email ?? '', github: this.snapshot?.user?.github ?? '' };
                this.profileOpen = true;
                return;
            }

            // The support row (Mikey, 2026-09-03): an intro first, never
            // the site straight away - a word on what supporting means,
            // and a way to say "already one" without leaving.
            if ( where === 'support' )
            {
                this.supporterIntroOpen = true;
                return;
            }

            // The sponsor row, the commercial sibling: the intro says
            // sponsorship is a conversation and readies the email; the
            // key modal waits behind "I already have a key".
            if ( where === 'sponsor' )
            {
                this.sponsorIntroOpen = true;
                return;
            }

            // The License row (Mikey, 2026-09-03): straight to the
            // License card in Site settings, flashed so the eye lands.
            if ( where === 'license' )
            {
                this.openSettings();
                this.flashLicenseCard();
                return;
            }

            if ( where === 'settings' ) { this.openSettings(); }
            else if ( where === 'theme' ) { this.openTheme(); }
            else { this.openMediaWorkspace(); }
        },

        flashLicenseCard ()
        {
            let attempts = 0;
            const attempt = () =>
            {
                attempts += 1;

                const card = document.querySelector( '[data-license-card]' );

                if ( card === null )
                {
                    if ( attempts < 12 ) { setTimeout( attempt, 250 ); }

                    return;
                }

                card.scrollIntoView( { behavior: 'smooth', block: 'center' } );
                card.classList.remove( 'cs-jump-flash', 'cs-jump-flash-card' );
                void card.offsetWidth;
                card.classList.add( 'cs-jump-flash', 'cs-jump-flash-card' );
                setTimeout( () => card.classList.remove( 'cs-jump-flash', 'cs-jump-flash-card' ), 2800 );
            };

            setTimeout( attempt, 150 );
        },

        // "I'm already a supporter": straight to the key.
        openSupporterKey ()
        {
            this.supporterIntroOpen = false;
            this.supporterKey = '';
            this.supporterOpen = true;
        },

        // "Become a supporter": the link opens the page in a new tab
        // on its own; the key modal waits here for the key the email
        // brings.
        becomeSupporter ()
        {
            this.openSupporterKey();
        },

        closeSupporter ()
        {
            if ( String( this.supporterKey ?? '' ).trim() !== '' ) { this.discardPrompt = 'supporter'; }
            else { this.supporterOpen = false; }
        },

        // "I'm already a sponsor": straight to the key, from the intro
        // or the settings card.
        openSponsorKey ()
        {
            this.sponsorIntroOpen = false;
            this.sponsorKey = '';
            this.sponsorKeyProblem = '';
            this.sponsorOpen = true;
        },

        closeSponsor ()
        {
            if ( String( this.sponsorKey ?? '' ).trim() !== '' ) { this.discardPrompt = 'sponsor'; }
            else { this.sponsorOpen = false; }
        },

        // Verify the sponsor key: stored as sponsorConfirm the way the
        // supporter key is stored, with no wall step after - sponsor
        // recognition is workspace-shaped and arrives later (BUSINESS
        // 5.5).
        async verifySponsor ()
        {
            const key = String( this.sponsorKey ?? '' ).trim();

            if ( key === '' ) { return; }

            const response = await fetch( '/api/sponsor', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { key } ),
            } );

            if ( !response.ok )
            {
                const failed = await response.json().catch( () => ( {} ) );

                this.sponsorKeyProblem = typeof failed.error === 'string' ? failed.error : t( 'supporterKeyProblem' );
                return;
            }

            this.sponsorKeyProblem = '';
            this.sponsorOpen = false;
            void this.refresh();
        },

        // Verify (EDITOR: the account badge): the key goes into the user
        // config as supporterConfirm. The real verification call, made
        // with the person's consent, is owed before go-live
        // (DEVELOPMENT); until then any stored key counts.
        async verifySupporter ()
        {
            const key = String( this.supporterKey ?? '' ).trim();

            if ( key === '' ) { return; }

            const response = await fetch( '/api/supporter', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { key } ),
            } );

            // A key that does not check out keeps the modal open and
            // says why, in the server's words.
            if ( !response.ok )
            {
                const failed = await response.json().catch( () => ( {} ) );

                this.supporterKeyProblem = typeof failed.error === 'string' ? failed.error : t( 'supporterKeyProblem' );
                return;
            }

            this.supporterKeyProblem = '';
            this.supporterOpen = false;

            // Once the key passes, the supporter wall is offered (Mikey,
            // 2026-09-03): a second modal showing what would be sent,
            // prefilled from the profile. Someone already on the wall is
            // not asked again.
            if ( this.snapshot?.user?.wall !== true ) { this.openSupporterWall(); }

            void this.refresh();
        },

        // The wall modal, prefilled from the profile: after Verify, and
        // again from the menu's supporter row (Mikey, 2026-09-03) so a
        // decline can be revisited and an entry edited or left.
        openSupporterWall ()
        {
            this.userMenuOpen = false;
            this.supporterWallDraft = { name: this.snapshot?.user?.name ?? '', github: this.snapshot?.user?.github ?? '' };
            this.supporterWallOpen = true;
        },

        get isOnWall ()
        {
            return this.snapshot?.user?.wall === true;
        },

        get supporterWallReady ()
        {
            return String( this.supporterWallDraft.name ?? '' ).trim() !== '' && String( this.supporterWallDraft.github ?? '' ).trim() !== '';
        },

        get supporterWallDirty ()
        {
            return String( this.supporterWallDraft.name ?? '' ).trim() !== String( this.snapshot?.user?.name ?? '' ).trim()
                || String( this.supporterWallDraft.github ?? '' ).trim() !== String( this.snapshot?.user?.github ?? '' ).trim();
        },

        // Closing without deciding: an edited entry asks first, like
        // every form; an untouched one just closes.
        closeSupporterWall ()
        {
            if ( this.supporterWallDirty ) { this.discardPrompt = 'supporterWall'; }
            else { this.supporterWallOpen = false; }
        },

        // Not now, or Leave the wall (Mikey, 2026-09-05: a toggle here,
        // never an email): either way the person stays on the wall as a
        // private supporter, and the server sends the removal when an
        // entry was up.
        async declineSupporterWall ()
        {
            await fetch( '/api/supporter-wall', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { join: false } ),
            } );
            this.supporterWallOpen = false;
            void this.refresh();
        },

        async joinSupporterWall ()
        {
            if ( !this.supporterWallReady ) { return; }

            await fetch( '/api/supporter-wall', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { join: true, name: String( this.supporterWallDraft.name ?? '' ).trim(), github: String( this.supporterWallDraft.github ?? '' ).trim() } ),
            } );
            this.supporterWallOpen = false;
            void this.refresh();
        },

        get avatarSrc ()
        {
            return `/api/avatar?v=${this.avatarVersion}`;
        },

        // The avatar: stored beside config.json in the user config
        // directory and named by its "avatar" key.
        async uploadAvatar ( event )
        {
            const file = event.target.files?.[ 0 ];

            if ( file === undefined ) { return; }

            await fetch( '/api/profile-avatar', {
                method: 'POST',
                headers: { 'content-type': file.type },
                body: file,
            } );
            event.target.value = '';
            this.avatarVersion += 1;
            void this.refresh();
        },

        async removeAvatar ()
        {
            await fetch( '/api/profile-avatar', { method: 'DELETE' } );
            this.avatarVersion += 1;
            void this.refresh();
        },

        // The profile (EDITOR: name and basics in the user-level config,
        // no account needed) so Studio greets a person.
        async saveProfile ()
        {
            await fetch( '/api/profile', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { name: String( this.profileDraft.name ?? '' ).trim(), email: String( this.profileDraft.email ?? '' ).trim(), github: String( this.profileDraft.github ?? '' ).trim() } ),
            } );
            this.profileOpen = false;
            void this.refresh();
        },

        // Appearance (EDITOR): System, Light, or Dark for the chrome only,
        // a person's preference in the browser, never a site's.
        get themeMode ()
        {
            let stored = null;

            try { stored = localStorage.getItem( 'studio-theme' ); }
            catch { /* storage blocked */ }

            void this.themeTick;

            return stored === 'dark' || stored === 'light' ? stored : 'system';
        },

        setThemeMode ( mode )
        {
            const dark = mode === 'dark' || ( mode === 'system' && matchMedia( '(prefers-color-scheme: dark)' ).matches );

            this.themeDark = dark;

            if ( dark ) { document.documentElement.dataset.theme = 'dark'; }
            else { delete document.documentElement.dataset.theme; }

            try
            {
                if ( mode === 'system' ) { localStorage.removeItem( 'studio-theme' ); }
                else { localStorage.setItem( 'studio-theme', mode ); }
            }
            catch
            {
                /* storage blocked */
            }

            this.themeTick += 1;
        },

        // A confirmed supporter (BUSINESS 5.5): the user config's flag,
        // set by the supporter confirmation flow (pre-launch).
        get isSupporter ()
        {
            return this.snapshot?.user?.supporter === true;
        },

        // A confirmed sponsor (BUSINESS 5.5): the commercial sibling
        // of the supporter flag, lit by a verified sponsor key.
        get isSponsor ()
        {
            return this.snapshot?.user?.sponsor === true;
        },

        // A monthly supporter (Mikey, 2026-09-04): the registry said a
        // subscription stands behind the key, so the menu offers
        // Manage subscription, a link into Stripe's customer portal.
        get hasSubscription ()
        {
            return this.isSupporter && this.snapshot?.user?.subscription === true;
        },

        // The split (Mikey, 2026-09-04): asks follow the site, status
        // follows the person. One ask at most, in the site's voice, and
        // only to someone holding no key of either kind - the ask never
        // targets someone already giving (BUSINESS 5.5).
        get supportAsk ()
        {
            if ( this.isSupporter || this.isSponsor ) { return null; }

            return this.licensing.declaredUse === 'commercial' ? 'sponsor' : 'supporter';
        },

        // The settings card's title follows what the card holds.
        get supportCardTitle ()
        {
            if ( this.isSupporter && this.isSponsor ) { return t( 'supportCardTitleBoth' ); }
            if ( this.isSponsor || this.supportAsk === 'sponsor' ) { return t( 'sponsorCardTitle' ); }

            return t( 'supporterCardTitle' );
        },

        // Projects needing a license (EDITOR: the badge's one reason to
        // light): this site, when its evaluation has ended without a
        // key. Studio knows one site at a time.
        get licensesNeeded ()
        {
            return this.licensing.phase === 'expired' ? 1 : 0;
        },

        get licensesNeededLine ()
        {
            return tCount( 'licensesNeeded', this.licensesNeeded );
        },

        // The per-site publish count (the snapshot has carried it
        // since the supporter moments; the supporter card is the
        // first chrome surface to show it).
        get publishCount ()
        {
            return this.snapshot?.publishCount ?? 0;
        },

        get publishCountLine ()
        {
            return tCount( 'publishCountLine', this.publishCount );
        },

        get studioVersionLine ()
        {
            const version = this.snapshot?.studioVersion ?? '';

            return version === '' ? 'Casomer Studio' : `Casomer Studio ${version}`;
        },

        // The entry behind a layout canvas: the rogue entry on its own
        // canvas, or the sample entry the shared layout renders with.
        get canvasEntry ()
        {
            if ( this.workspace !== 'collection' || this.sampleEntryId === null ) { return null; }
            if ( this.surface !== 'entry' && this.surface !== 'template' ) { return null; }

            return ( this.collectionEditor?.entries ?? [] ).find( ( entry ) => entry.id === this.sampleEntryId ) ?? null;
        },

        get layoutRows ()
        {
            const layouts = ( this.workspace === 'taxonomy' ? this.taxonomyEditor?.layouts : this.collectionEditor?.layouts ) ?? {};
            const names = Object.keys( layouts ).sort( ( a, b ) => ( a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare( b ) ) );

            return names.map( ( name ) => ( { name, ...layouts[ name ] } ) );
        },

        get layoutsRow ()
        {
            const viewing = ( this.workspace === 'collection' && this.collectionView === 'layouts' ) || ( this.workspace === 'taxonomy' && this.taxonomyView === 'layouts' );

            if ( !viewing ) { return null; }

            // The index page is a row too (Mikey): its template and its
            // edit live in the sidebar like a layout's.
            if ( this.layoutsRowName === 'index' )
            {
                const editor = this.workspace === 'taxonomy' ? this.taxonomyEditor : this.collectionEditor;

                return editor === null ? null : { name: 'index', index: true, template: editor.indexTemplate ?? null, off: editor.index === false };
            }

            return this.layoutRows.find( ( layout ) => layout.name === this.layoutsRowName ) ?? null;
        },

        createIndexLayout ()
        {
            if ( this.workspace === 'taxonomy' ) { void this.toggleTaxonomySetting(); }
            else { void this.toggleCollectionSetting( 'index' ); }
        },

        layoutFollowersLine ( layout )
        {
            return tCount( this.workspace === 'taxonomy' ? 'layoutFollowersTerms' : 'layoutFollowers', layout.entries ?? 0 );
        },

        // The editor behind the layouts: the collection's or the
        // taxonomy's, reloaded the same way.
        async reloadLayoutOwner ()
        {
            if ( this.workspace === 'taxonomy' ) { await this.loadTaxonomy(); }
            else { await this.loadCollection(); }
        },

        async chooseTermLayout ( id, value )
        {
            const file = this.workspaceFile;

            if ( file === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/term', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, id, layout: value } ),
            } );
            await this.loadTaxonomy();
            this.contentVersion += 1;
        },

        selectLayoutRow ( name )
        {
            this.layoutsRowName = name;
            this.tab = 'content';
        },

        openLayoutCanvas ( name )
        {
            if ( !this.confirmEntryLeave( () => this.openLayoutCanvas( name ) ) ) { return; }

            this.layoutName = name;
            this.openSurface( 'template' );
        },

        async setNamedLayoutTemplate ( name, template )
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( this.workspace === 'taxonomy' ? '/api/taxonomy' : '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { layoutTemplates: { [ name ]: template === 'default' ? null : template } } } ),
            } );
            await this.reloadLayoutOwner();
            this.contentVersion += 1;
        },

        // An entry chooses a layout, or goes rogue ("__own"): choosing a
        // name adopts first when the entry had its own blocks.
        async chooseEntryLayout ( id, value )
        {
            const file = this.workspaceFile;

            if ( file === null ) { return; }

            if ( value === '__own' )
            {
                await this.divergeEntry( id );
                return;
            }

            this.suppressReloadUntil = Date.now() + 1500;

            const entry = ( this.collectionEditor?.entries ?? [] ).find( ( candidate ) => candidate.id === id );

            if ( entry?.hasOwnBlocks === true )
            {
                await fetch( '/api/entry-layout', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file, id, action: 'adopt' } ),
                } );
            }

            await fetch( '/api/entry', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, id, layout: value } ),
            } );
            await this.loadCollection();

            if ( this.surface === 'entry' || this.surface === 'template' )
            {
                this.layoutName = value;
                this.openSurface( 'template' );
                this.sampleEntryId = id;
            }

            this.contentVersion += 1;
        },

        get createModalDirty ()
        {
            return Object.values( this.createValues ?? {} ).some( ( value ) => value !== '' && value !== null && value !== undefined && value !== false );
        },

        closeCreate ()
        {
            if ( this.createModalDirty ) { this.discardPrompt = 'create'; }
            else { this.createKind = null; }
        },

        closeNavCreate ()
        {
            const fieldWork = this.navCreateFields.some( ( row ) => row.label.trim() !== '' );

            if ( String( this.navCreateLabel ?? '' ).trim() !== '' || fieldWork ) { this.discardPrompt = 'navCreate'; }
            else { this.navCreate = null; }
        },

        keepEditing ()
        {
            this.discardPrompt = null;
        },

        confirmDiscard ()
        {
            if ( this.discardPrompt === 'create' ) { this.createKind = null; }
            if ( this.discardPrompt === 'navCreate' ) { this.navCreate = null; }
            if ( this.discardPrompt === 'supporter' ) { this.supporterOpen = false; }
            if ( this.discardPrompt === 'sponsor' ) { this.sponsorOpen = false; }
            if ( this.discardPrompt === 'supporterWall' ) { this.supporterWallOpen = false; }
            if ( this.discardPrompt === 'publishConfirm' ) { this.publishConfirmOpen = false; }

            this.discardPrompt = null;
        },

        get pagesRow ()
        {
            return this.workspace === 'pages' ? ( this.pages.find( ( page ) => page.id === this.pagesRowId ) ?? null ) : null;
        },

        // A row selects into the sidebar: the page's settings, with
        // edit and trash up top. The canvas page follows so the
        // settings pane's own wiring (title, slug, template, draft,
        // delete) works unchanged.
        selectPagesRow ( id )
        {
            this.pagesRowId = id;
            this.selectedPageId = id;
            this.syncPageTitleDraft();
            this.tab = 'settings';
        },

        previewPage ( id )
        {
            const page = this.pages.find( ( candidate ) => candidate.id === id );

            if ( page === undefined ) { return; }

            window.open( page.slug === '404' ? '/preview/--not-found--/' : `/preview${this.pageAddressOf( id )}`, '_blank' );
        },

        deletePageRow ( id )
        {
            this.selectPagesRow( id );
            this.confirmTarget = 'page';
        },

        get availableTabCount ()
        {
            return [ this.contentTabAvailable, this.settingsTabAvailable, this.usageTabAvailable ].filter( Boolean ).length;
        },

        get pageTableRows ()
        {
            const rows = [];
            const visited = new Set();
            const childrenOf = ( parentId ) => this.pages.filter( ( page ) => page.parent === parentId );
            const walk = ( page, depth ) =>
            {
                if ( visited.has( page.id ) ) { return; }

                visited.add( page.id );
                rows.push( { page, depth, address: this.pageAddressOf( page.id ), template: page.template ?? 'default' } );

                for ( const child of childrenOf( page.id ) ) { walk( child, depth + 1 ); }
            };

            for ( const page of this.pinnedPageOrder )
            {
                const orphaned = page.parent !== undefined && !this.pages.some( ( candidate ) => candidate.id === page.parent );

                if ( page.parent === undefined || orphaned ) { walk( page, 0 ); }
            }

            return rows;
        },

        // Home first, the 404 last, everything else in page order.
        get pinnedPageOrder ()
        {
            const home = this.pages.filter( ( page ) => page.slug === 'home' );
            const notFound = this.pages.filter( ( page ) => page.slug === '404' );
            const rest = this.pages.filter( ( page ) => page.slug !== 'home' && page.slug !== '404' );

            return [ ...home, ...rest, ...notFound ];
        },

        // The pages table's drag (Mikey): the same tree rules as the menu
        // - a family travels whole, the slot bounds the landing depth,
        // a sideways pull picks within it - with Home pinned first and
        // the 404 last, neither draggable nor a parent. The new order
        // and parents write in one call; the rows rebuild from the
        // snapshot.
        async sortPageRows ( key, element )
        {
            const moved = this.pages.find( ( page ) => page.id === key );

            if ( moved === undefined || this.pageIsReserved( moved ) )
            {
                this.sortEpoch += 1;
                return;
            }

            const descendants = new Set();
            const collect = ( id ) =>
            {
                for ( const page of this.pages )
                {
                    if ( page.parent === id && !descendants.has( page.id ) )
                    {
                        descendants.add( page.id );
                        collect( page.id );
                    }
                }
            };

            collect( key );

            const domRows = [ ...element.querySelectorAll( '[data-sort-id]' ) ].filter( ( row ) => row.dataset.sortId === key || !descendants.has( row.dataset.sortId ) );
            const self = domRows.find( ( row ) => row.dataset.sortId === key );
            let at = domRows.indexOf( self );
            const isSlug = ( row, slug ) => this.pages.find( ( page ) => page.id === row?.dataset.sortId )?.slug === slug;

            // Never above Home, never below the 404 (the move guard
            // keeps the slot off those ends; this is the belt).
            if ( at === 0 && isSlug( domRows[ 1 ], 'home' ) )
            {
                domRows.splice( at, 1 );
                domRows.splice( 1, 0, self );
                at = 1;
            }

            if ( at === domRows.length - 1 && isSlug( domRows[ at - 1 ], '404' ) )
            {
                domRows.splice( at, 1 );
                domRows.splice( at - 1, 0, self );
                at -= 1;
            }

            const above = domRows[ at - 1 ] ?? null;
            const below = domRows[ at + 1 ] ?? null;
            const min = below === null || isSlug( below, '404' ) ? 0 : Number( below.dataset.depth );
            const max = above === null || isSlug( above, 'home' ) ? 0 : Number( above.dataset.depth ) + 1;
            const requested = self.dataset.dropDepth === undefined ? min : Number( self.dataset.dropDepth );
            const depth = Math.min( max, Math.max( min, requested ) );

            self.dataset.dropped = '1';

            // The flat tree in DOM order, depths from the rows, the
            // moved family re-inserted at its landing depth.
            const family = this.pageTableRows.filter( ( row ) => row.page.id === key || descendants.has( row.page.id ) );
            const rootDepth = family[ 0 ]?.depth ?? 0;
            const flat = [];

            for ( const row of domRows )
            {
                if ( row === self )
                {
                    for ( const member of family ) { flat.push( { id: member.page.id, depth: member.depth - rootDepth + depth } ); }
                    continue;
                }

                flat.push( { id: row.dataset.sortId, depth: Number( row.dataset.depth ) } );
            }

            // Depths become parents: the nearest earlier row one level up.
            const order = [];
            const stack = [];

            for ( const entry of flat )
            {
                while ( stack.length > entry.depth ) { stack.pop(); }

                const parent = entry.depth > 0 ? stack[ entry.depth - 1 ] : undefined;

                order.push( { id: entry.id, ...( parent === undefined ? {} : { parent } ) } );
                stack[ entry.depth ] = entry.id;
                stack.length = entry.depth + 1;
            }

            // The table and the rail tree take the new order at once
            // (Mikey: a second's wait for the round trip read as lag);
            // the write lands behind it and the refresh confirms.
            if ( this.snapshot !== null )
            {
                const byId = new Map( this.pages.map( ( page ) => [ page.id, page ] ) );

                this.snapshot.pages = order.map( ( entry ) =>
                {
                    const { parent: _dropped, ...page } = byId.get( entry.id );

                    return entry.parent === undefined ? page : { ...page, parent: entry.parent };
                } );
            }

            this.sortEpoch += 1;
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/pages-order', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { pages: order } ),
            } );
            this.contentVersion += 1;
            void this.refresh();
        },

        pageAddressOf ( id )
        {
            const segments = this.pagePathOf( id );

            if ( this.pages.find( ( page ) => page.id === id )?.slug === '404' ) { return '/404.html'; }

            return segments.length === 0 ? '/' : `/${segments.join( '/' )}/`;
        },

        get pagesMeta ()
        {
            return tCount( 'pagesMeta', this.pages.length );
        },

        // The Theme workspace (Mikey: settings should hold less
        // look-and-feel): the token cards, on their own.
        openTheme ()
        {
            if ( !this.confirmEntryLeave( () => this.openTheme() ) ) { return; }

            this.enterWorkspace( 'theme' );
            this.syncSettingsDrafts();
        },

        // Page templates (SCHEMA 12.6): the STRUCTURE group's rows open
        // a template on its own canvas, lit by a sample page.
        get templateNames ()
        {
            return Object.keys( this.snapshot?.templates ?? {} );
        },

        templatePagesCount ( name )
        {
            return this.snapshot?.templates?.[ name ]?.pages ?? 0;
        },

        get templatePagesLine ()
        {
            return tCount( 'templatePagesLine', this.templatePagesCount( this.surface ?? '' ) );
        },

        openTemplate ( name )
        {
            if ( !this.confirmEntryLeave( () => this.openTemplate( name ) ) ) { return; }

            if ( this.workspace !== 'template' ) { this.enterWorkspace( 'template' ); }

            this.openSurface( name );
        },

        openPartial ( name )
        {
            this.openSettings();
            this.openSurface( name );
        },

        // The 404 is a reserved page (SCHEMA 13.6): the old surface
        // opener lands on it.
        openNotFoundSurface ()
        {
            const page = this.notFoundPage;

            if ( page !== undefined ) { this.selectPage( page.id ); }
        },

        get notFoundPage ()
        {
            return this.pages.find( ( page ) => page.slug === '404' );
        },

        // Home and the 404 are reserved: pinned first and last, never
        // nested, never draft, never deleted, never dragged.
        pageIsReserved ( page )
        {
            return page !== undefined && page !== null && ( page.slug === 'home' || page.slug === '404' );
        },

        // The template canvas previews with a page's content only
        // when one is chosen (Mikey: default None; the slot is then an
        // empty, stamped space).
        get samplePage ()
        {
            return this.pages.find( ( page ) => page.id === this.samplePageId ) ?? null;
        },

        get samplePageLabel ()
        {
            return this.samplePage?.title || t( 'sampleNone' );
        },

        chooseSamplePage ( id )
        {
            this.samplePageId = id;
            this.samplePickerOpen = false;
            this.contentVersion += 1;
        },

        openSamplePage ()
        {
            const page = this.samplePage;

            this.samplePickerOpen = false;

            if ( page !== null ) { this.selectPage( page.id ); }
        },

        async renameTemplate ( raw )
        {
            const from = this.surface;
            const to = String( raw ?? '' ).trim();

            if ( from === null || from === 'default' || to === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/template-rename', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { from, to } ),
            } );

            if ( !response.ok ) { return; }

            const renamed = await response.json();

            await this.refresh();
            this.surface = renamed.renamed;
        },

        // The page's Layout card: a name adopts (a custom page confirms
        // first - its own copy goes), default clears, detach copies.
        async setPageTemplate ( value )
        {
            const page = this.selectedPage;

            if ( page === undefined || value === '' ) { return; }

            if ( page.template === 'custom' )
            {
                this.confirmRowId = value;
                this.confirmTarget = 'pageTemplate';
                return;
            }

            await this.patchPageTemplate( { template: value } );
        },

        async detachPageTemplate ()
        {
            await this.patchPageTemplate( { detach: true } );
        },

        async patchPageTemplate ( patch )
        {
            const id = this.selectedPageId;

            if ( id === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/page', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { id, patch } ),
            } );
            this.contentVersion += 1;
            void this.refresh();
        },

        openSettings ()
        {
            if ( !this.confirmEntryLeave( () => this.openSettings() ) ) { return; }

            this.enterWorkspace( 'settings' );
            this.syncSettingsDrafts();
            void this.loadMediaLibrary();
        },

        // The media library is a first-class workspace in the left
        // rail (Mikey): browse, upload, rename, inspect usage - and a
        // TRASH view (Mikey's model): library deletes move to trash/,
        // restorable until someone empties it. Binaries are never
        // journaled; labels in site.json are the tracked metadata.
        openMediaWorkspace ()
        {
            if ( !this.confirmEntryLeave( () => this.openMediaWorkspace() ) ) { return; }

            this.enterWorkspace( 'media' );
            this.mediaView = 'library';
            this.mediaQuery = '';
            void this.loadMediaLibrary();
        },

        setMediaView ( view )
        {
            this.mediaView = view;
            this.selectedMediaFile = null;
            this.usageRows = null;
        },

        selectMediaFile ( file )
        {
            this.selectedMediaFile = file;
            this.usageRows = null;

            if ( this.mediaView === 'library' ) { void this.loadUsage( `/media/${file}` ); }
        },

        get selectedMedia ()
        {
            const list = this.mediaView === 'trash' ? this.mediaTrash : this.mediaLibrary;

            return ( list ?? [] ).find( ( file ) => file.file === this.selectedMediaFile ) ?? null;
        },

        mediaLabelOf ( mediaFile )
        {
            return mediaFile.label ?? mediaFile.file;
        },

        mediaMatches ( mediaFile, query )
        {
            return this.mediaLabelOf( mediaFile ).toLowerCase().includes( query )
                || mediaFile.file.toLowerCase().includes( query );
        },

        get filteredMedia ()
        {
            const query = this.mediaQuery.trim().toLowerCase();
            const list = ( this.mediaView === 'trash' ? this.mediaTrash : this.mediaLibrary ) ?? [];

            return query === '' ? list : list.filter( ( file ) => this.mediaMatches( file, query ) );
        },

        get mediaCountLine ()
        {
            if ( this.mediaView === 'trash' ) { return tFill( 'mediaCountFiles', { count: ( this.mediaTrash ?? [] ).length } ); }

            const count = ( this.mediaLibrary ?? [] ).length;
            const unused = this.unusedMediaCount;

            return unused === 0
                ? tFill( 'mediaCountFiles', { count } )
                : tFill( 'mediaCountFilesUnused', { count, unused } );
        },

        async uploadLibraryFile ( event )
        {
            const file = event?.target?.files?.[ 0 ];

            if ( file === undefined || file === null ) { return; }

            this.mediaUploading = true;
            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/media', {
                method: 'POST',
                headers: {
                    'content-type': file.type === '' ? 'application/octet-stream' : file.type,
                    'x-casomer-name': encodeURIComponent( file.name ),
                },
                body: file,
            } );

            this.mediaUploading = false;
            event.target.value = '';

            if ( !response.ok ) { return; }

            const body = await response.json();

            await this.loadMediaLibrary();
            this.mediaView = 'library';
            this.selectMediaFile( String( body.src ?? '' ).split( '/' ).pop() ?? '' );
        },

        // The media library (SCHEMA 13.4): what lives in media/, its
        // labels, usage counts, and what waits in the trash.
        async loadMediaLibrary ()
        {
            const response = await fetch( '/api/media-library' );

            if ( !response.ok ) { return; }

            const body = await response.json();

            this.mediaLibrary = body.files;
            this.mediaTrash = body.trash ?? [];
        },

        // The media-tracking choice (Mikey: "let the user decide"):
        // off keeps binaries out of git via managed .gitignore lines;
        // labels and metadata always version.
        get mediaTracked ()
        {
            return this.snapshot?.config?.media?.track !== false;
        },

        async toggleMediaTracking ()
        {
            const track = !this.mediaTracked;

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/media-tracking', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { track } ),
            } );
            void this.refresh();
        },

        // Label edits propagate on the KEYSTROKE (Mikey: "can that be
        // more responsive?"): the local library entry updates
        // immediately - card, header, and search react live - and the
        // journaled write debounces behind it.
        setMediaLabel ( file, label )
        {
            const entry = ( this.mediaLibrary ?? [] ).find( ( candidate ) => candidate.file === file );

            if ( entry !== undefined )
            {
                if ( label.trim() === '' ) { delete entry.label; }
                else { entry.label = label; }
            }

            this.suppressReloadUntil = Date.now() + 1500;
            clearTimeout( this.mediaLabelTimer );
            this.mediaLabelTimer = setTimeout( () => void this.saveMediaLabel( file, label ), 400 );
        },

        async saveMediaLabel ( file, label )
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/media', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, label } ),
            } );
        },

        // Moving to trash is reversible, so it asks no confirm; the
        // permanent verbs in the trash view do.
        async trashMedia ( file )
        {
            await fetch( '/api/media', {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file } ),
            } );
            await this.loadMediaLibrary();

            if ( this.selectedMediaFile === file && this.mediaView === 'library' ) { this.selectedMediaFile = null; }
        },

        async trashUnusedMedia ()
        {
            for ( const file of ( this.mediaLibrary ?? [] ).filter( ( candidate ) => candidate.references === 0 ) )
            {
                await this.trashMedia( file.file );
            }
        },

        async restoreMedia ( file )
        {
            await fetch( '/api/media-trash', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, action: 'restore' } ),
            } );
            await this.loadMediaLibrary();

            if ( this.selectedMediaFile === file ) { this.selectedMediaFile = null; }
        },

        mediaSizeLabel ( size )
        {
            if ( size < 1024 ) { return `${size} B`; }
            if ( size < 1024 * 1024 ) { return `${Math.round( size / 1024 )} KB`; }

            return `${( size / ( 1024 * 1024 ) ).toFixed( 1 )} MB`;
        },

        mediaIsImage ( name )
        {
            return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test( name );
        },

        get unusedMediaCount ()
        {
            return ( this.mediaLibrary ?? [] ).filter( ( file ) => file.references === 0 ).length;
        },

        // The settings drafts read from the snapshot. Split out of
        // openSettings so a journal undo can resync them in place
        // (Mikey's report: a restored color came back on disk but not
        // on screen until a reload).
        syncSettingsDrafts ()
        {
            this.siteNameDraft = this.snapshot?.config?.name ?? '';
            this.siteOriginDraft = this.snapshot?.origin ?? '';

            const theme = this.snapshot?.config?.theme;

            const textDraft = {};

            for ( const element of [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ] )
            {
                textDraft[ element ] = {
                    size: theme?.text?.[ element ]?.size ?? '',
                    font: theme?.text?.[ element ]?.font ?? '',
                };
            }

            this.themeDraft = {
                colors: JSON.parse( JSON.stringify( theme?.families?.colors ?? {} ) ),
                spacing: JSON.parse( JSON.stringify( theme?.families?.spacing ?? {} ) ),
                layout: {
                    gutter: theme?.layout?.gutter ?? '',
                    width: theme?.layout?.width ?? '',
                },
                text: textDraft,
                resources: JSON.parse( JSON.stringify( theme?.resources ?? [] ) ),
                pendingColors: [],
                removedColors: [],
            };
        },

        // ---- Site meta: the creation-time choices, revisitable ----

        // Site identity (Mikey's note): a display name that overrides
        // the folder-derived project name everywhere and joins every
        // page's document title, and the one-square-image site icon.
        // The media picker (SCHEMA 13.4): one modal for every image
        // and file field - drop or browse, caption and alt for
        // images, and the derived-alt chain previewed honestly.
        openMediaPicker ( kind, target, key, notify )
        {
            const current = target[ key ];
            const value = current !== null && typeof current === 'object' ? current : {};

            this.mediaPicker = {
                kind,
                target,
                key,
                notify,
                uploading: false,
                dropActive: false,
                hadValue: typeof value.src === 'string' && value.src !== '',
                draft: {
                    src: typeof value.src === 'string' ? value.src : '',
                    alt: typeof value.alt === 'string' ? value.alt : '',
                    caption: typeof value.caption === 'string' ? value.caption : '',
                    name: typeof value.name === 'string' ? value.name : '',
                    size: typeof value.size === 'number' ? value.size : 0,
                },
            };
            void this.loadMediaLibrary();
        },

        // The library inside the picker (SCHEMA 13.4's owed piece):
        // pick an existing upload instead of re-uploading. Image
        // slots offer only images; file slots offer everything.
        get mediaPickerLibrary ()
        {
            const files = this.mediaLibrary ?? [];

            return this.mediaPicker?.kind === 'file' ? files : files.filter( ( file ) => this.mediaIsImage( file.file ) );
        },

        pickLibraryMedia ( mediaFile )
        {
            const picker = this.mediaPicker;

            if ( picker === null ) { return; }

            picker.draft.src = mediaFile.url;
            picker.draft.name = this.mediaLabelOf( mediaFile );
            picker.draft.size = mediaFile.size;
        },

        // "Choose from media library" (Mikey): a button on the picker
        // opening a searchable modal of every library thumb.
        openMediaBrowse ()
        {
            this.mediaBrowse = { query: '' };
            void this.loadMediaLibrary();
            this.$nextTick( () => this.$refs.mediaBrowseInput?.focus() );
        },

        get mediaBrowseResults ()
        {
            const query = ( this.mediaBrowse?.query ?? '' ).trim().toLowerCase();

            return query === ''
                ? this.mediaPickerLibrary
                : this.mediaPickerLibrary.filter( ( file ) => this.mediaMatches( file, query ) );
        },

        chooseBrowseMedia ( mediaFile )
        {
            this.pickLibraryMedia( mediaFile );
            this.mediaBrowse = null;
        },

        async mediaFileChosen ( chosen )
        {
            const picker = this.mediaPicker;
            const file = chosen instanceof File ? chosen : chosen?.target?.files?.[ 0 ];

            if ( picker === null || file === undefined || file === null ) { return; }

            picker.uploading = true;

            const response = await fetch( '/api/media', {
                method: 'POST',
                headers: {
                    'content-type': file.type === '' ? 'application/octet-stream' : file.type,
                    'x-casomer-name': encodeURIComponent( file.name ),
                },
                body: file,
            } );

            picker.uploading = false;

            if ( !response.ok ) { return; }

            const body = await response.json();

            picker.draft.src = body.src;
            picker.draft.name = body.name;
            picker.draft.size = body.size;
        },

        mediaDropped ( event )
        {
            const file = event.dataTransfer?.files?.[ 0 ];

            if ( this.mediaPicker !== null ) { this.mediaPicker.dropActive = false; }
            if ( file !== undefined ) { void this.mediaFileChosen( file ); }
        },

        applyMediaPicker ()
        {
            const picker = this.mediaPicker;

            if ( picker === null || picker.draft.src === '' ) { return; }

            const draft = picker.draft;

            picker.target[ picker.key ] = picker.kind === 'file'
                ? { src: draft.src, name: draft.name, ...( draft.size > 0 ? { size: draft.size } : {} ) }
                : {
                        src: draft.src,
                        ...( draft.name === '' ? {} : { name: draft.name } ),
                        ...( draft.alt.trim() === '' ? {} : { alt: draft.alt.trim() } ),
                        ...( draft.caption.trim() === '' ? {} : { caption: draft.caption.trim() } ),
                    };
            picker.notify();
            this.mediaPicker = null;
        },

        clearMediaPicker ()
        {
            const picker = this.mediaPicker;

            if ( picker === null ) { return; }

            picker.target[ picker.key ] = { src: '' };
            picker.notify();
            this.mediaPicker = null;
        },

        // What a screen reader would actually get, spoken up front:
        // the same chain the compiler derives at render time.
        get mediaAltPreview ()
        {
            const draft = this.mediaPicker?.draft;

            if ( draft === undefined ) { return ''; }

            const spoken = draft.alt.trim() !== ''
                ? draft.alt.trim()
                : ( draft.caption.trim() !== '' ? draft.caption.trim() : this.humanizedMediaName( draft.name ) );

            return spoken === '' ? t( 'mediaAltSilent' ) : tFill( 'mediaAltHear', { alt: spoken } );
        },

        humanizedMediaName ( name )
        {
            if ( typeof name !== 'string' ) { return ''; }

            const base = name.replace( /\.[A-Za-z0-9]+$/, '' );

            if ( /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test( base ) ) { return ''; }

            const spoken = base.replace( /[-_]+/g, ' ' ).trim();

            return /[a-zA-Z]/.test( spoken ) ? spoken : '';
        },

        // ---- Menus (SCHEMA 12.5): their own workspace, like ----
        // collections and taxonomies. The nav lists every menu; the
        // center shows one menu's item tree; the inspector edits the
        // selected item. Items nest freely: rows indent by depth,
        // drag reorders (a family travels with its parent), and the
        // indent/outdent buttons nest and un-nest.
        get menuNames ()
        {
            return Object.keys( this.snapshot?.config?.menus ?? {} );
        },

        openMenu ( name )
        {
            if ( !this.confirmEntryLeave( () => this.openMenu( name ) ) ) { return; }

            this.enterWorkspace( 'menu' );
            this.menuName = name;
            this.syncMenuEditor();
        },

        // The draft mirrors the stored record with transient row keys
        // (x-for and Sortable both need stable identities). The
        // pre-nesting spelling - a bare item array - reads as items.
        syncMenuEditor ()
        {
            // A resync mid-drag would rebuild the rows under Sortable's
            // feet (the file watcher fires on every save); it waits
            // for the release instead.
            if ( typeof document !== 'undefined' && document.querySelector( '.sort-drag-clone' ) !== null )
            {
                clearTimeout( this.menuSyncTimer );
                this.menuSyncTimer = setTimeout( () => this.syncMenuEditor(), 300 );
                return;
            }

            const record = this.snapshot?.config?.menus?.[ this.menuName ];

            if ( record === undefined )
            {
                this.menuEditor = null;
                return;
            }

            const tag = ( items ) => ( Array.isArray( items ) ? items : [] ).map( ( item ) => ( {
                key: `mi-${this.menuKeySeq += 1}`,
                page: item.page ?? '',
                collection: item.collection ?? '',
                taxonomy: item.taxonomy ?? '',
                label: item.label ?? '',
                url: item.url ?? '',
                auto: item.auto ?? '',
                items: tag( item.items ),
            } ) );

            this.menuEditor = {
                topLevelPages: !Array.isArray( record ) && record.topLevelPages === true,
                childPages: !Array.isArray( record ) && record.childPages === true,
                collectionIndexes: !Array.isArray( record ) && record.collectionIndexes === true,
                taxonomyIndexes: !Array.isArray( record ) && record.taxonomyIndexes === true,
                items: tag( Array.isArray( record ) ? record : record.items ),
            };
            this.menuNameDraft = this.menuName ?? '';
            this.applyMenuAutoRules();
        },

        // Materialize and prune (SCHEMA 12.5, Mikey: auto-included
        // items are real reorderable rows). Each rule adds rows the
        // user can reorder and relabel; a row whose target stops
        // qualifying for its rule is pruned. Nothing here marks the
        // editor dirty - the rows persist with the user's next edit.
        applyMenuAutoRules ()
        {
            const editor = this.menuEditor;

            if ( editor === null ) { return; }

            const freshItem = ( fields ) => ( {
                key: `mi-${this.menuKeySeq += 1}`,
                page: '',
                collection: '',
                taxonomy: '',
                label: '',
                url: '',
                auto: '',
                items: [],
                ...fields,
            } );
            const pageQualifies = ( id, topLevel ) =>
            {
                const page = this.pages.find( ( candidate ) => candidate.id === id );

                return page !== undefined && page.draft !== true && ( !topLevel || page.parent === undefined );
            };
            const prune = ( items ) =>
            {
                for ( let index = items.length - 1; index >= 0; index -= 1 )
                {
                    const item = items[ index ];

                    prune( item.items );

                    const stale
                        = ( item.auto === 'topLevelPages' && !pageQualifies( item.page, true ) )
                            || ( item.auto === 'childPages' && !pageQualifies( item.page, false ) )
                            || ( item.auto === 'collectionIndexes' && !this.collections.some( ( doc ) => doc.file === `${item.collection}.json` && doc.index !== false ) )
                            || ( item.auto === 'taxonomyIndexes' && !this.taxonomies.some( ( doc ) => doc.file === `${item.taxonomy}.json` && doc.index !== false ) );

                    if ( stale ) { items.splice( index, 1 ); }
                }
            };

            prune( editor.items );

            const referencedPages = new Set();
            const referencedCollections = new Set();
            const referencedTaxonomies = new Set();
            const collect = ( items ) =>
            {
                for ( const item of items )
                {
                    if ( item.page !== '' ) { referencedPages.add( item.page ); }
                    if ( item.collection !== '' ) { referencedCollections.add( item.collection ); }
                    if ( item.taxonomy !== '' ) { referencedTaxonomies.add( item.taxonomy ); }

                    collect( item.items );
                }
            };

            collect( editor.items );

            if ( editor.childPages )
            {
                for ( const item of editor.items )
                {
                    if ( item.page === '' ) { continue; }

                    for ( const page of this.pages )
                    {
                        if ( page.parent !== item.page || referencedPages.has( page.id ) || page.draft === true ) { continue; }

                        item.items.push( freshItem( { page: page.id, auto: 'childPages' } ) );
                        referencedPages.add( page.id );
                    }
                }
            }

            if ( editor.topLevelPages )
            {
                for ( const page of this.pages )
                {
                    if ( page.parent !== undefined || page.draft === true || referencedPages.has( page.id ) ) { continue; }

                    editor.items.push( freshItem( { page: page.id, auto: 'topLevelPages' } ) );
                    referencedPages.add( page.id );
                }
            }

            if ( editor.collectionIndexes )
            {
                for ( const doc of this.collections )
                {
                    const stem = doc.file.replace( '.json', '' );

                    if ( doc.index === false || referencedCollections.has( stem ) ) { continue; }

                    editor.items.push( freshItem( { collection: stem, auto: 'collectionIndexes' } ) );
                    referencedCollections.add( stem );
                }
            }

            if ( editor.taxonomyIndexes )
            {
                for ( const doc of this.taxonomies )
                {
                    const stem = doc.file.replace( '.json', '' );

                    if ( doc.index === false || referencedTaxonomies.has( stem ) ) { continue; }

                    editor.items.push( freshItem( { taxonomy: stem, auto: 'taxonomyIndexes' } ) );
                    referencedTaxonomies.add( stem );
                }
            }
        },

        get menuMeta ()
        {
            const count = this.menuRows.length;

            return tFill( count === 1 ? 'menuMetaOne' : 'menuMetaMany', { count } );
        },

        get menuRows ()
        {
            const rows = [];
            const walk = ( items, depth ) =>
            {
                for ( const item of items )
                {
                    rows.push( { item, depth } );
                    walk( item.items, depth + 1 );
                }
            };

            walk( this.menuEditor?.items ?? [], 0 );
            return rows;
        },

        menuFind ( key, items = null, parent = null )
        {
            const list = items ?? this.menuEditor?.items ?? [];

            for ( const [ index, item ] of list.entries() )
            {
                if ( item.key === key ) { return { item, list, index, parent }; }

                const found = this.menuFind( key, item.items, item );

                if ( found !== null ) { return found; }
            }

            return null;
        },

        get selectedMenuItem ()
        {
            return this.selectedMenuKey === null ? null : this.menuFind( this.selectedMenuKey )?.item ?? null;
        },

        menuItemKind ( item )
        {
            if ( item.page !== '' ) { return 'page'; }
            if ( item.collection !== '' ) { return 'collection'; }
            if ( item.taxonomy !== '' ) { return 'taxonomy'; }
            if ( item.url !== '' || this.menuItemIsLink( item ) ) { return 'url'; }

            return 'group';
        },

        // A custom-link row stays a link while its url is still being
        // typed; the marker keeps it from reading as a group.
        menuItemIsLink ( item )
        {
            return item.isLink === true;
        },

        // The row's display name: the override, or the target's own.
        menuItemTitle ( item )
        {
            if ( item.label !== '' ) { return item.label; }

            const kind = this.menuItemKind( item );

            if ( kind === 'page' ) { return this.pages.find( ( page ) => page.id === item.page )?.title ?? t( 'kindPage' ); }
            if ( kind === 'collection' ) { return this.collections.find( ( candidate ) => candidate.file === `${item.collection}.json` )?.label ?? item.collection; }
            if ( kind === 'taxonomy' ) { return this.taxonomies.find( ( candidate ) => candidate.file === `${item.taxonomy}.json` )?.label ?? item.taxonomy; }
            if ( kind === 'url' ) { return item.url; }

            return t( 'menuGroupWord' );
        },

        // The row's second line: the public address, or the kind.
        menuItemNote ( item )
        {
            const kind = this.menuItemKind( item );

            if ( kind === 'page' )
            {
                const path = this.pagePathOf( item.page );

                return path.length === 0 ? '/' : `/${path.join( '/' )}/`;
            }

            if ( kind === 'collection' )
            {
                const doc = this.collections.find( ( candidate ) => candidate.file === `${item.collection}.json` );
                const segments = typeof doc?.parent === 'string' ? this.pagePathOf( doc.parent ) : [];

                return `/${[ ...segments, item.collection ].join( '/' )}/`;
            }

            if ( kind === 'taxonomy' ) { return `/${item.taxonomy}/`; }
            if ( kind === 'url' ) { return item.url === '' ? t( 'menuUrlPlaceholder' ) : item.url; }

            return t( 'menuGroupNote' );
        },

        // Only public targets are offered: a private index has no
        // address for a menu to point at (13.5).
        get menuAddCollections ()
        {
            return this.collections.filter( ( candidate ) => candidate.index !== false );
        },

        get menuAddTaxonomies ()
        {
            return this.taxonomies.filter( ( candidate ) => candidate.index !== false );
        },

        addMenuEntry ( kind, value = '' )
        {
            if ( this.menuEditor === null ) { return; }

            const item = {
                key: `mi-${this.menuKeySeq += 1}`,
                page: kind === 'page' ? value : '',
                collection: kind === 'collection' ? value : '',
                taxonomy: kind === 'taxonomy' ? value : '',
                label: kind === 'group' ? t( 'menuNewGroup' ) : '',
                url: '',
                auto: '',
                ...( kind === 'url' ? { isLink: true } : {} ),
                items: [],
            };

            this.menuEditor.items.push( item );
            this.selectMenuRow( item.key );
            this.menuAddOpen = false;
            this.sortEpoch += 1;
            this.markMenuEditorDirty();
        },

        selectMenuRow ( key )
        {
            this.selectedMenuKey = key;
            this.tab = 'content';
        },

        // The item's TYPE lives on its Settings tab (Mikey): page,
        // collection, taxonomy, custom link, heading. Switching keeps
        // the label and the family, resets the target, and makes an
        // auto row an ordinary one.
        get menuKindOptions ()
        {
            return [
                { kind: 'page', label: t( 'typePage' ), available: this.pages.length > 0 },
                { kind: 'collection', label: t( 'typeCollection' ), available: this.menuAddCollections.length > 0 },
                { kind: 'taxonomy', label: t( 'typeTaxonomy' ), available: this.menuAddTaxonomies.length > 0 },
                { kind: 'url', label: t( 'typeCustom' ), available: true },
                { kind: 'group', label: t( 'typeHeading' ), available: true },
            ].filter( ( option ) => option.available );
        },

        setMenuItemKind ( kind )
        {
            const item = this.selectedMenuItem;

            if ( item === null || this.menuItemKind( item ) === kind ) { return; }

            item.page = kind === 'page' ? ( this.pages[ 0 ]?.id ?? '' ) : '';
            item.collection = kind === 'collection' ? ( this.menuAddCollections[ 0 ]?.file.replace( '.json', '' ) ?? '' ) : '';
            item.taxonomy = kind === 'taxonomy' ? ( this.menuAddTaxonomies[ 0 ]?.file.replace( '.json', '' ) ?? '' ) : '';
            item.url = '';
            item.isLink = kind === 'url';
            item.auto = '';

            if ( kind === 'group' && item.label === '' ) { item.label = t( 'menuNewGroup' ); }

            this.markMenuEditorDirty();
        },

        // The menu's name is a setting (Mikey): token-shaped, and a
        // rename sweeps every repeat source referencing it so nothing
        // strands. Empty, invalid, or colliding input restores the
        // current name quietly.
        async renameMenu ()
        {
            const from = this.menuName;
            const slug = this.menuNameDraft.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

            if ( from === null || slug === '' || slug === from )
            {
                this.menuNameDraft = from ?? '';
                return;
            }

            const existing = this.snapshot?.config?.menus ?? {};
            let unique = slug;
            let suffix = 2;

            while ( existing[ unique ] !== undefined )
            {
                unique = `${slug}-${suffix}`;
                suffix += 1;
            }

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/menu-rename', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { from, to: unique } ),
            } );

            if ( !response.ok )
            {
                this.menuNameDraft = from;
                return;
            }

            this.menuName = unique;
            this.menuNameDraft = unique;
            void this.refresh();
        },

        menuCanIndent ( key )
        {
            const found = this.menuFind( key );

            return found !== null && found.index > 0;
        },

        menuCanOutdent ( key )
        {
            return ( this.menuFind( key )?.parent ?? null ) !== null;
        },

        // Indent nests under the previous sibling; outdent lifts to a
        // following sibling of the parent. The family rides along.
        indentMenuRow ( key )
        {
            const found = this.menuFind( key );

            if ( found === null || found.index === 0 ) { return; }

            const previous = found.list[ found.index - 1 ];

            found.list.splice( found.index, 1 );
            previous.items.push( found.item );
            this.sortEpoch += 1;
            this.markMenuEditorDirty();
        },

        outdentMenuRow ( key )
        {
            const found = this.menuFind( key );

            if ( found === null || found.parent === null ) { return; }

            const parentFound = this.menuFind( found.parent.key );

            if ( parentFound === null ) { return; }

            found.list.splice( found.index, 1 );
            parentFound.list.splice( parentFound.index + 1, 0, found.item );
            this.sortEpoch += 1;
            this.markMenuEditorDirty();
        },

        // Drag semantics (Mikey): a family is ONE unit - it travels
        // with its parent, a level deeper or shallower with it, and
        // no drop can split one (its rows are collapsed while the
        // drag is on). The slot's vertical position bounds the
        // landing depth and the pointer's horizontal pull picks
        // within those bounds (previewSlot writes the pick on the
        // row as data-drop-depth): beneath a childless top-level row
        // the unit stays top-level unless pulled right, between a
        // parent and its first child it can only nest first, beneath
        // a whole family it sits top-level pulled left or as a child
        // pulled right. The unit lands before the row beneath when
        // that row is at the landing depth, else last in the list of
        // the row above's ancestor-or-self one level up.
        sortMenuRows ( key, element )
        {
            const found = this.menuFind( key );

            if ( found === null ) { return; }

            const family = new Set();
            const collect = ( item ) =>
            {
                family.add( item.key );
                for ( const child of item.items ) { collect( child ); }
            };

            collect( found.item );

            const rows = [ ...element.querySelectorAll( '[data-sort-id]' ) ].filter( ( row ) => row.dataset.sortId === key || !family.has( row.dataset.sortId ) );
            const at = rows.findIndex( ( row ) => row.dataset.sortId === key );
            const self = rows[ at ];
            const above = rows[ at - 1 ] ?? null;
            const below = rows[ at + 1 ] ?? null;
            const min = below === null ? 0 : Number( below.dataset.depth );
            const max = above === null ? 0 : Number( above.dataset.depth ) + 1;
            const requested = self.dataset.dropDepth === undefined ? min : Number( self.dataset.dropDepth );
            const depth = Math.min( max, Math.max( min, requested ) );

            self.dataset.dropped = '1';
            found.list.splice( found.index, 1 );

            let list = this.menuEditor.items;

            if ( depth > 0 )
            {
                let node = this.menuFind( above.dataset.sortId );

                for ( let level = Number( above.dataset.depth ); level > depth - 1; level -= 1 ) { node = this.menuFind( node.parent.key ); }

                list = node.item.items;
            }

            const belowItem = below !== null && Number( below.dataset.depth ) === depth ? this.menuFind( below.dataset.sortId )?.item : undefined;
            const position = belowItem === undefined ? -1 : list.indexOf( belowItem );

            if ( position === -1 ) { list.push( found.item ); }
            else { list.splice( position, 0, found.item ); }

            this.sortEpoch += 1;
            this.markMenuEditorDirty();
        },

        // An auto row is the rule's (Mikey, 2026-09-02): its target and
        // type are read-only; relabel and delete stay.
        menuItemIsAuto ( item )
        {
            return ( item?.auto ?? '' ) !== '';
        },

        menuRuleLabel ( rule )
        {
            return t( `menuRule_${rule}` );
        },

        get tFillMenuAutoNote ()
        {
            return tFill( 'menuAutoNote', { rule: this.menuRuleLabel( this.selectedMenuItem?.auto ?? '' ) } );
        },

        // One toggle per auto-include rule: on materializes the
        // rule's rows, off withdraws exactly that rule's rows.
        toggleMenuRule ( rule )
        {
            const editor = this.menuEditor;

            if ( editor === null ) { return; }

            editor[ rule ] = !editor[ rule ];

            if ( editor[ rule ] )
            {
                this.applyMenuAutoRules();
            }
            else
            {
                const strip = ( items ) =>
                {
                    for ( let index = items.length - 1; index >= 0; index -= 1 )
                    {
                        strip( items[ index ].items );

                        if ( items[ index ].auto === rule ) { items.splice( index, 1 ); }
                    }
                };

                strip( editor.items );
            }

            if ( this.selectedMenuKey !== null && this.menuFind( this.selectedMenuKey ) === null ) { this.selectedMenuKey = null; }

            this.sortEpoch += 1;
            this.markMenuEditorDirty();
        },

        markMenuEditorDirty ()
        {
            clearTimeout( this.menusSaveTimer );
            this.menusSaveTimer = setTimeout( () => void this.saveMenuEditor(), 500 );
        },

        // The whole menus record saves together: the open menu from
        // the draft (row keys stripped), every other menu passed
        // through - the server migrates any bare-array spellings.
        async saveMenuEditor ()
        {
            if ( this.menuEditor === null || this.menuName === null ) { return; }

            const strip = ( items ) => items.map( ( item ) => ( {
                ...( item.page === '' ? {} : { page: item.page } ),
                ...( item.collection === '' ? {} : { collection: item.collection } ),
                ...( item.taxonomy === '' ? {} : { taxonomy: item.taxonomy } ),
                ...( item.label === '' ? {} : { label: item.label } ),
                ...( item.url === '' ? {} : { url: item.url } ),
                ...( item.auto === '' ? {} : { auto: item.auto } ),
                ...( item.items.length === 0 ? {} : { items: strip( item.items ) } ),
            } ) );

            const menus = { ...( this.snapshot?.config?.menus ?? {} ) };

            menus[ this.menuName ] = {
                ...Object.fromEntries( [ 'topLevelPages', 'childPages', 'collectionIndexes', 'taxonomyIndexes' ]
                    .filter( ( rule ) => this.menuEditor[ rule ] === true )
                    .map( ( rule ) => [ rule, true ] ) ),
                items: strip( this.menuEditor.items ),
            };

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/menus', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { menus } ),
            } );
            void this.refresh();
        },

        get folderName ()
        {
            return this.snapshot?.folderName ?? '';
        },

        get siteIcon ()
        {
            return this.snapshot?.siteIcon ?? '';
        },

        get siteNameNoteLine ()
        {
            return tFill( 'siteNameNote', { folder: this.folderName } );
        },

        markSiteNameDirty ()
        {
            const draft = typeof this.siteNameDraft === 'string' ? this.siteNameDraft.trim() : '';

            if ( this.snapshot !== null ) { this.snapshot.projectName = draft === '' ? this.folderName : draft; }

            this.siteNameTouched = true;
            clearTimeout( this.siteNameTimer );
            this.siteNameTimer = setTimeout( () => void this.saveSiteName( this.siteNameDraft ), 500 );
        },

        // The public address (SCHEMA 12.3): saved on a pause like the
        // name; a refused one marks the field until the next keystroke.
        get siteOrigin ()
        {
            return this.snapshot?.origin ?? '';
        },

        // The license page with this site's address filled in
        // (casomer.com/license?site=<host>, the domain the key will
        // name), so the key is bought for the address the site
        // declares; the bare page without one.
        get licenseUrl ()
        {
            const page = 'https://casomer.com/license';

            try
            {
                return this.siteOrigin ? `${page}?site=${encodeURIComponent( new URL( this.siteOrigin ).host.toLowerCase() )}` : page;
            }
            catch
            {
                return page;
            }
        },

        markSiteOriginDirty ()
        {
            this.siteOriginTouched = true;
            this.siteOriginProblem = false;
            clearTimeout( this.siteOriginTimer );
            this.siteOriginTimer = setTimeout( () => void this.saveSiteOrigin( this.siteOriginDraft ), 600 );
        },

        async saveSiteOrigin ( origin )
        {
            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/site-meta', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { origin: typeof origin === 'string' ? origin : '' } ),
            } );

            this.siteOriginProblem = !response.ok;
            this.siteOriginTouched = false;

            if ( response.ok ) { void this.refresh(); }
        },

        async saveSiteName ( name )
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/site-meta', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { name: typeof name === 'string' ? name : '' } ),
            } );
            this.siteNameTouched = false;
            void this.refresh();
        },

        async uploadSiteIcon ( event )
        {
            const file = event.target.files?.[ 0 ];

            if ( file === undefined ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/site-icon', {
                method: 'POST',
                headers: { 'content-type': file.type },
                body: file,
            } );
            event.target.value = '';
            void this.refresh();
        },

        async removeSiteIcon ()
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/site-icon', { method: 'DELETE' } );
            void this.refresh();
        },

        get declaredUse ()
        {
            return this.snapshot?.declaredUse ?? 'personal';
        },

        // Switching to commercial repeats the micro-assent the CLI
        // collects at init (BUSINESS 5.4); back to personal is direct.
        requestUseChange ( value, element = null )
        {
            if ( value === this.declaredUse ) { return; }

            if ( value === 'commercial' )
            {
                // The select shows the current use until the assent
                // lands (Mikey: Cancel left it on "commercial"); a
                // confirm moves declaredUse and the binding follows.
                if ( element !== null ) { element.value = this.declaredUse; }

                this.commercialAssentOpen = true;
                return;
            }

            void this.setDeclaredUse( 'personal' );
        },

        async setDeclaredUse ( value )
        {
            this.commercialAssentOpen = false;
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/site-meta', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { use: value } ),
            } );
            void this.refresh();
        },

        get remoteUrl ()
        {
            return this.snapshot?.remoteUrl ?? '';
        },

        openRemoteEdit ()
        {
            this.remoteDraft = this.remoteUrl;
            this.remoteEditOpen = true;
            this.github = { ...this.github, phase: 'idle', error: '', repositories: [] };
            void this.checkGitHub();
        },

        // Step 1 is done when a token is on hand (this Studio, or caso init
        // earlier): the steps open at the right one.
        get githubGrantedLine ()
        {
            const n = this.github.repositories.length;

            return n === 0 ? t( 'githubGrantedNone' ) : tCount( 'githubGranted', n );
        },

        get githubAuthorized ()
        {
            return this.github.phase === 'loading' || this.github.phase === 'pick';
        },

        async checkGitHub ()
        {
            try
            {
                const body = await ( await fetch( '/api/github' ) ).json();

                if ( body.connected === true && this.remoteEditOpen ) { await this.loadGitHubRepositories(); }
            }
            catch
            {
                /* the steps start at one */
            }
        },

        // Connect GitHub: the same device flow caso init runs. The
        // server holds the wait; this side shows the code and asks
        // every few seconds whether the person has authorized.
        // The code to the clipboard; the button says Copied for a moment.
        async copyGitHubCode ()
        {
            await copyText( this.github.userCode );
            this.githubCodeCopied = true;
            clearTimeout( this.githubCodeCopiedTimer );
            this.githubCodeCopiedTimer = setTimeout( () => { this.githubCodeCopied = false; }, 1400 );
        },

        async connectGitHub ()
        {
            this.github = { ...this.github, phase: 'asking', error: '' };

            try
            {
                const response = await fetch( '/api/github/connect', { method: 'POST' } );
                const body = await response.json().catch( () => ( {} ) );

                if ( !response.ok )
                {
                    this.github = { ...this.github, phase: 'idle', error: typeof body.error === 'string' ? body.error : t( 'githubUnreachable' ) };
                    return;
                }

                if ( body.connected === true )
                {
                    await this.loadGitHubRepositories();
                    return;
                }

                this.github = { ...this.github, phase: 'code', userCode: String( body.userCode ?? '' ), verificationUri: String( body.verificationUriComplete ?? body.verificationUri ?? 'https://github.com/login/device' ) };
                this.watchGitHub();
            }
            catch
            {
                this.github = { ...this.github, phase: 'idle', error: t( 'publishUnreachable' ) };
            }
        },

        watchGitHub ()
        {
            clearTimeout( this.githubTimer );
            this.githubTimer = setTimeout( async () =>
            {
                if ( this.github.phase !== 'code' || !this.remoteEditOpen ) { return; }

                try
                {
                    const body = await ( await fetch( '/api/github' ) ).json();

                    if ( body.connected === true )
                    {
                        await this.loadGitHubRepositories();
                        return;
                    }

                    if ( typeof body.error === 'string' && body.error !== '' )
                    {
                        this.github = { ...this.github, phase: 'idle', error: body.error };
                        return;
                    }
                }
                catch
                {
                    /* asked again in a moment */
                }

                this.watchGitHub();
            }, 3000 );
        },

        async loadGitHubRepositories ()
        {
            this.github = { ...this.github, phase: 'loading', error: '' };

            try
            {
                const response = await fetch( '/api/github/repositories' );
                const body = await response.json().catch( () => ( {} ) );

                if ( !response.ok )
                {
                    this.github = { ...this.github, phase: 'idle', error: typeof body.error === 'string' ? body.error : t( 'githubUnreachable' ) };
                    return;
                }

                const repositories = Array.isArray( body.repositories ) ? body.repositories : [];

                this.github = { ...this.github, phase: 'pick', repositories };

                const current = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec( this.remoteUrl )?.[ 1 ] ?? '';

                this.githubRepo = repositories.some( ( repository ) => repository.fullName === current ) ? current : ( repositories[ 0 ]?.fullName ?? '' );
            }
            catch
            {
                this.github = { ...this.github, phase: 'idle', error: t( 'publishUnreachable' ) };
            }
        },

        async useGitHubRepository ()
        {
            if ( this.githubRepo === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/github/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { fullName: this.githubRepo } ) } );
            const body = await response.json().catch( () => ( {} ) );

            if ( !response.ok )
            {
                this.github = { ...this.github, error: typeof body.error === 'string' ? body.error : t( 'publishUnreachable' ) };
                return;
            }

            this.remoteEditOpen = false;
            this.github = { ...this.github, phase: 'idle' };
            void this.refresh();
        },

        get deployState ()
        {
            return this.snapshot?.deploy ?? { git: { enabled: true, github: 'none' }, target: null, hasCredential: false, credential: null, keyFile: '', hostKeyTrusted: false, lastDeployedAt: '' };
        },

        // Pull & push on publish: the remote's presence and the switch.
        get gitDeployOn ()
        {
            return this.remoteUrl !== '' && this.deployState.git.enabled !== false;
        },

        get gitDeployExpired ()
        {
            return this.deployState.git.github === 'expired';
        },

        get gitDeployNote ()
        {
            if ( this.remoteUrl === '' ) { return t( 'goLiveGitNotSet' ); }
            if ( this.gitDeployExpired && this.deployState.git.enabled !== false ) { return t( 'goLiveGitExpired' ); }

            return this.deployState.git.enabled === false ? t( 'goLiveGitOff' ) : t( 'goLiveGitOn' );
        },

        async toggleGitDeploy ()
        {
            if ( this.remoteUrl === '' )
            {
                this.openRemoteEdit();
                return;
            }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/deploy/git', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { enabled: this.deployState.git.enabled === false } ) } );
            void this.refresh();
        },

        // "user@host:folder", the destination in one breath.
        get deployTargetLine ()
        {
            const target = this.deployState.target;

            return target === null ? '' : `${target.user}@${target.host}${target.port === 22 ? '' : ':' + target.port}:${target.path}`;
        },

        get deployNote ()
        {
            const state = this.deployState;

            if ( state.target === null ) { return t( 'goLiveNote' ); }
            if ( !state.target.enabled ) { return t( 'goLiveOffNote' ); }
            if ( !state.hasCredential ) { return t( 'goLiveNoSecret' ); }

            return tFill( 'goLiveOnNote', { target: this.deployTargetLine } );
        },

        get deployTestLine ()
        {
            const test = this.deployTest;

            if ( test === null ) { return ''; }
            if ( !test.ok ) { return test.error; }

            const path = this.deployDraft.path.trim() === '' ? '/' : this.deployDraft.path.trim();

            return ( test.entries === 0 ? tFill( 'deployConnectedEmpty', { path } ) : ( test.entries === 1 ? tFill( 'deployConnectedOne', { path } ) : tFill( 'deployConnected', { path, n: test.entries } ) ) ) + ( test.trusted === 'new' ? ' ' + t( 'deployTrustedNew' ) : '' );
        },

        openDeployEdit ()
        {
            const target = this.deployState.target;

            this.deployDraft = { host: target?.host ?? '', port: target === null || target.port === 22 ? '' : String( target.port ), user: target?.user ?? '', path: target?.path ?? '', password: '', keyFile: this.deployState.keyFile };
            this.deployTest = null;
            this.deployProblem = '';
            this.deployEditOpen = true;
        },

        closeDeployEdit ()
        {
            this.deployEditOpen = false;
            this.deployTest = null;
            this.deployProblem = '';
        },

        deployDraftBody ()
        {
            const draft = this.deployDraft;

            return {
                host: draft.host.trim(),
                port: draft.port.trim() === '' ? '' : Number( draft.port ),
                user: draft.user.trim(),
                path: draft.path.trim() === '' ? '/' : draft.path.trim(),
                ...( draft.password === '' ? {} : { password: draft.password } ),
                ...( draft.keyFile.trim() === '' ? {} : { keyFile: draft.keyFile.trim() } ),
            };
        },

        // Test what is typed, saved or not: the person sees "Connected"
        // before committing to anything.
        async testDeploy ()
        {
            if ( this.deployTesting ) { return; }

            this.deployTesting = true;
            this.deployTest = null;
            this.deployProblem = '';

            try
            {
                const response = await fetch( '/api/deploy/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify( this.deployDraftBody() ) } );
                const body = await response.json().catch( () => ( {} ) );

                this.deployTest = body.ok === true ? { ...body, host: this.deployDraft.host.trim() } : { ok: false, error: typeof body.error === 'string' ? body.error : t( 'publishUnreachable' ) };
            }
            catch
            {
                this.deployTest = { ok: false, error: t( 'publishUnreachable' ) };
            }

            this.deployTesting = false;
        },

        async saveDeploy ()
        {
            this.deployProblem = '';
            this.suppressReloadUntil = Date.now() + 1500;

            // A test that succeeded for this host hands its key to Save,
            // so "trusted" is true the moment the details are kept.
            const test = this.deployTest;
            const tested = test !== null && test.ok === true && test.host === this.deployDraft.host.trim() ? { hostKey: test.hostKey } : {};
            const response = await fetch( '/api/deploy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { ...this.deployDraftBody(), enabled: true, ...tested } ) } );
            const body = await response.json().catch( () => ( {} ) );

            if ( !response.ok )
            {
                this.deployProblem = typeof body.error === 'string' ? body.error : t( 'publishUnreachable' );
                return;
            }

            this.deployEditOpen = false;
            this.deployTest = null;
            void this.refresh();
        },

        async toggleDeploy ()
        {
            const target = this.deployState.target;

            if ( target === null )
            {
                this.openDeployEdit();
                return;
            }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/deploy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { enabled: !target.enabled } ) } );
            void this.refresh();
        },

        async forgetDeployHostKey ()
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/deploy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { forgetHostKey: true } ) } );
            this.deployTest = null;
            void this.refresh();
        },

        // Upload now: the retry after a publish whose upload failed.
        async uploadNow ()
        {
            if ( this.deployUploading ) { return; }

            this.deployUploading = true;

            try
            {
                const response = await fetch( '/api/deploy/run', { method: 'POST' } );
                const body = await response.json().catch( () => ( {} ) );

                if ( this.publishCard !== null )
                {
                    this.publishCard = { ...this.publishCard, deploy: body.ok === true ? 'uploaded' : 'failed', deployError: body.ok === true ? '' : ( typeof body.error === 'string' ? body.error : t( 'publishUnreachable' ) ), deployUploaded: typeof body.uploaded === 'number' ? body.uploaded : 0, deployDeleted: typeof body.deleted === 'number' ? body.deleted : 0 };
                }
            }
            catch
            {
                if ( this.publishCard !== null ) { this.publishCard = { ...this.publishCard, deploy: 'failed', deployError: t( 'publishUnreachable' ) }; }
            }

            this.deployUploading = false;
            void this.refresh();
        },

        get publishUploadLine ()
        {
            const card = this.publishCard;

            if ( card === null ) { return ''; }
            if ( card.deploy === 'off' ) { return t( 'publishUploadOff' ); }
            if ( card.deploy !== 'uploaded' ) { return ''; }

            const moved = card.deployUploaded + card.deployDeleted;

            return moved === 0 ? t( 'publishUploadedNone' ) : tCount( 'publishUploaded', moved );
        },

        async saveRemote ()
        {
            this.remoteEditOpen = false;
            await fetch( '/api/remote', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { url: this.remoteDraft.trim() } ),
            } );
            void this.refresh();
        },

        get lastPublishedLabel ()
        {
            const at = this.snapshot?.lastPublishedAt;

            if ( at === undefined || at === '' ) { return t( 'neverPublished' ); }

            return new Date( at ).toLocaleString();
        },

        get spacingTokenNames ()
        {
            return Object.keys( this.snapshot?.config?.theme?.families?.spacing ?? {} );
        },

        // Typography settings (Mikey): per-element size and font for
        // p and h1-h6, plus the third-party resources repeater.
        // Custom theme colors (Mikey): unbounded, custom-named; the
        // guaranteed three edit but never delete.
        get coreColorRoles ()
        {
            return [ 'primary', 'secondary', 'accent' ];
        },

        addThemeColor ()
        {
            this.themeDraft?.pendingColors?.push( { name: '', value: '#cccccc' } );
        },

        removePendingColor ( index )
        {
            this.themeDraft?.pendingColors?.splice( index, 1 );
        },

        removeThemeColor ( name )
        {
            if ( this.coreColorRoles.includes( name ) || this.themeDraft === null ) { return; }

            delete this.themeDraft.colors[ name ];
            this.themeDraft.removedColors.push( name );
            this.markThemeDirty();
        },

        get typeElements ()
        {
            return [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ];
        },

        typeElementLabel ( element )
        {
            return element === 'p' ? t( 'typeParagraph' ) : element.toUpperCase();
        },

        // The same formula the compiler uses for the default scale,
        // shown as placeholders so "default" is a number, not a word.
        typeDefaultSize ( element )
        {
            const raw = Number.parseFloat( this.snapshot?.config?.theme?.families?.typography?.scale ?? '1.25' );
            const scale = Number.isFinite( raw ) && raw > 1 ? raw : 1.25;
            const powers = { p: 0, h6: 0, h5: 1, h4: 2, h3: 3, h2: 4, h1: 5 };

            return `${Number( Math.pow( scale, powers[ element ] ?? 0 ).toFixed( 3 ) )}rem`;
        },

        get typeDefaultFont ()
        {
            return this.snapshot?.config?.theme?.families?.typography?.sans ?? 'sans-serif';
        },

        get typographyFontTokens ()
        {
            return Object.keys( this.snapshot?.config?.theme?.families?.typography ?? {} ).filter( ( token ) => token !== 'scale' );
        },

        addThemeResource ()
        {
            this.themeDraft?.resources?.push( '' );
        },

        removeThemeResource ( index )
        {
            this.themeDraft?.resources?.splice( index, 1 );
            this.markThemeDirty();
        },

        get widthTokenNames ()
        {
            return Object.keys( this.snapshot?.config?.theme?.families?.widths ?? {} );
        },

        markThemeDirty ()
        {
            this.dirty += 1;
            clearTimeout( this.themeSaveTimer );
            this.themeSaveTimer = setTimeout( () => void this.saveTheme(), 400 );
        },

        async saveTheme ()
        {
            const draft = this.themeDraft;

            if ( draft === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/theme', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( {
                    colors: {
                        ...JSON.parse( JSON.stringify( draft.colors ) ),
                        ...Object.fromEntries( ( draft.pendingColors ?? [] )
                            .filter( ( pending ) => /^[a-z][a-z0-9-]*$/.test( pending.name ) && draft.colors[ pending.name ] === undefined )
                            .map( ( pending ) => [ pending.name, pending.value ] ) ),
                    },
                    removeColors: JSON.parse( JSON.stringify( draft.removedColors ?? [] ) ),
                    families: { spacing: JSON.parse( JSON.stringify( draft.spacing ) ) },
                    layout: JSON.parse( JSON.stringify( draft.layout ) ),
                    text: JSON.parse( JSON.stringify( draft.text ?? {} ) ),
                    resources: ( draft.resources ?? [] ).map( ( url ) => String( url ).trim() ).filter( ( url ) => url !== '' ),
                } ),
            } );

            for ( const pending of draft.pendingColors ?? [] )
            {
                if ( /^[a-z][a-z0-9-]*$/.test( pending.name ) && draft.colors[ pending.name ] === undefined )
                {
                    draft.colors[ pending.name ] = pending.value;
                }
            }

            draft.pendingColors = ( draft.pendingColors ?? [] ).filter( ( pending ) => draft.colors[ pending.name ] === undefined );
            draft.removedColors = [];
            void this.refresh();
        },

        // Creating a collection or taxonomy: the + opens the creation
        // modal - a name, the public-index choice, and for a
        // collection its fields too (Mikey, 2026-09-03: the modal
        // carries the whole shape, the born-complete doctrine) - and
        // a new collection lands on its entry table.
        startNavCreate ( kind )
        {
            this.navCreate = kind;
            this.navCreateError = '';
            this.navCreateLabel = '';
            this.navCreateIndex = true;
            this.navCreateHierarchical = false;
            this.navCreateFields = [];
        },

        addNavCreateField ()
        {
            this.navCreateFields.push( { label: '', type: 'text', required: false, refTarget: '' } );
        },

        removeNavCreateField ( index )
        {
            this.navCreateFields.splice( index, 1 );
        },

        // The reference targets the modal can offer: every taxonomy,
        // or every EXISTING collection - the one being born is not in
        // the snapshot yet, so it never offers itself.
        navCreateFieldTargets ( row )
        {
            const pool = row.type === 'taxonomy' ? this.taxonomies : this.collections;

            return pool.map( ( option ) => ( { value: option.file.replace( /\.json$/, '' ), label: option.label } ) );
        },

        setNavCreateFieldType ( row, value )
        {
            row.type = value;

            if ( this.fieldNeedsTarget( row ) )
            {
                const options = this.navCreateFieldTargets( row );

                if ( !options.some( ( option ) => option.value === row.refTarget ) ) { row.refTarget = options[ 0 ]?.value ?? ''; }
            }
        },

        // The modal's live caption: "Saved as events.json ...". The
        // server owns the real name (collision suffixes); this mirrors
        // its slugging for the preview.
        get navCreateStem ()
        {
            const slug = this.navCreateLabel
                .toLowerCase()
                .replace( /[^a-z0-9]+/g, '-' )
                .replace( /^-+|-+$/g, '' );

            return slug === '' ? '…' : slug;
        },

        get navCreateSavedAs ()
        {
            if ( this.navCreate === 'menu' ) { return tFill( 'createSavedAsMenu', { name: this.navCreateStem } ); }
            if ( this.navCreate === 'partial' ) { return tFill( 'createSavedAsPartial', { name: this.navCreateStem } ); }
            if ( this.navCreate === 'layout' ) { return tFill( 'createSavedAsLayout', { name: this.navCreateStem } ); }
            if ( this.navCreate === 'template' ) { return tFill( 'createSavedAsTemplate', { name: this.navCreateStem } ); }

            return tFill( 'createSavedAs', { file: `${this.navCreateStem}.json` } );
        },

        get navCreateIndexNote ()
        {
            return this.navCreate === 'collection'
                ? tFill( 'createPublicIndexNote', { stem: this.navCreateStem } )
                : t( 'createPublicIndexNoteTaxonomy' );
        },

        async submitNavCreate ()
        {
            const kind = this.navCreate;
            const label = this.navCreateLabel.trim();

            this.navCreate = null;

            if ( kind === null || label === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;

            // A page template (SCHEMA 12.6) starts as a copy of the
            // default and opens on its canvas.
            if ( kind === 'template' )
            {
                const response = await fetch( '/api/template', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { name: label, from: 'default' } ),
                } );

                if ( !response.ok ) { return; }

                const created = await response.json();

                await this.refresh();
                this.openTemplate( created.name );
                return;
            }

            // A partial lives in site.json too; the server derives
            // and dedupes the token name.
            if ( kind === 'layout' )
            {
                const response = await fetch( '/api/layout', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, name: label } ),
                } );

                if ( !response.ok )
                {
                    const failure = await response.json().catch( () => ( {} ) );

                    this.navCreate = kind;
                    this.navCreateError = String( failure.error ?? t( 'createFailed' ) );
                    return;
                }

                const created = await response.json();

                await this.reloadLayoutOwner();

                if ( this.workspace === 'taxonomy' ) { this.showTaxonomyLayoutsView(); }
                else { this.showLayoutsView(); }

                this.selectLayoutRow( created.name );
                return;
            }

            if ( kind === 'partial' )
            {
                const response = await fetch( '/api/partial', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { name: label } ),
                } );

                if ( !response.ok ) { return; }

                const created = await response.json();

                await this.refresh();
                this.openSettings();
                this.openSurface( created.name );
                return;
            }

            // A menu is not a file: it lives in site.json under a
            // token-shaped name derived from the label, suffixed on
            // collision like the file kinds are.
            if ( kind === 'menu' )
            {
                const stem = label.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

                if ( stem === '' ) { return; }

                const existing = this.snapshot?.config?.menus ?? {};
                let unique = stem;
                let suffix = 2;

                while ( existing[ unique ] !== undefined )
                {
                    unique = `${stem}-${suffix}`;
                    suffix += 1;
                }

                await fetch( '/api/menus', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { menus: { ...existing, [ unique ]: { items: [] } } } ),
                } );
                await this.refresh();
                this.openMenu( unique );
                return;
            }

            // The modal's field rows become the fields payload - the
            // saveFields wire shape, keys derived the way the field
            // modal derives them, "title" reserved for the seed.
            const fieldRows = kind === 'collection' ? this.navCreateFields.filter( ( row ) => row.label.trim() !== '' ) : [];
            const fieldKeys = [ 'title' ];
            const fields = {};

            for ( const row of fieldRows )
            {
                const fieldLabel = row.label.trim();
                const words = fieldLabel.toLowerCase().replace( /[^a-z0-9]+/g, ' ' ).trim().split( ' ' ).filter( ( word ) => word !== '' );
                const base = words.map( ( word, index ) => index === 0 ? word : word.charAt( 0 ).toUpperCase() + word.slice( 1 ) ).join( '' ) || 'field';
                let key = base;
                let suffix = 2;

                while ( fieldKeys.includes( key ) )
                {
                    key = `${base}${suffix}`;
                    suffix += 1;
                }

                fieldKeys.push( key );
                fields[ key ] = {
                    type: row.type === 'taxonomy' ? 'reference' : row.type,
                    label: fieldLabel,
                    required: row.required,
                    ...( row.type === 'taxonomy' && row.refTarget !== '' ? { taxonomy: row.refTarget } : {} ),
                    ...( row.type === 'reference' && row.refTarget !== '' ? { collection: row.refTarget } : {} ),
                };
            }

            const response = await fetch( kind === 'collection' ? '/api/collection' : '/api/taxonomy', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( {
                    label,
                    ...( this.navCreateIndex ? {} : { index: false } ),
                    ...( kind === 'taxonomy' && this.navCreateHierarchical ? { hierarchical: true } : {} ),
                    ...( fieldRows.length > 0 ? { fields } : {} ),
                } ),
            } );

            if ( !response.ok )
            {
                // A taken name (one namespace across collections and
                // taxonomies, Mikey): the modal says so and stays
                // open - reopened here, since submit closes it
                // eagerly, so the label and field rows survive.
                const failure = await response.json().catch( () => ( {} ) );

                this.navCreate = kind;
                this.navCreateError = String( failure.error ?? t( 'createFailed' ) );
                return;
            }

            const created = await response.json();

            await this.refresh();

            // Land on the entry table (Mikey, 2026-09-03): with the
            // fields defined in the modal, the natural next move is
            // adding entries, not editing the shape.
            if ( kind === 'collection' )
            {
                this.openCollection( created.file );
                await this.loadCollection();
            }
            else { this.openTaxonomy( created.file ); }
        },

        // The delete dialog names its target: 'Delete "Latte art night"?'
        // Row-level deletes aim the confirm modal at a specific row
        // without selecting it first; everything else falls back to
        // the current selection.
        openRowDelete ( kind, id )
        {
            // An auto-included menu row cannot be deleted directly:
            // the confirm offers to turn its rule off instead, keeping
            // the siblings the rule added (Mikey).
            if ( kind === 'menuItem' && ( this.menuFind( id )?.item.auto ?? '' ) !== '' ) { kind = 'menuAutoItem'; }

            this.confirmRowId = id;
            this.confirmTarget = kind;
        },

        cancelConfirm ()
        {
            this.confirmTarget = null;
            this.confirmRowId = null;
        },

        get confirmName ()
        {
            if ( this.confirmTarget === 'block' ) { return this.selectionLabel; }
            if ( this.confirmTarget === 'page' ) { return String( this.selectedPage?.title ?? '' ) || t( 'kindPage' ); }

            if ( this.confirmTarget === 'entry' )
            {
                const row = this.confirmRowId === null ? undefined : this.collectionEditor?.entries?.find( ( entry ) => entry.id === this.confirmRowId );
                const title = row !== undefined ? row.values?.title : this.entryEditor?.values?.title;

                return String( title ?? '' ) || t( 'kindEntry' );
            }

            if ( this.confirmTarget === 'term' )
            {
                const row = this.confirmRowId === null ? undefined : this.taxonomyEditor?.terms?.find( ( term ) => term.id === this.confirmRowId );
                const name = row !== undefined ? row.name : this.termEditor?.name;

                return name === '' || name === undefined ? t( 'kindTerm' ) : name;
            }

            if ( this.confirmTarget === 'field' )
            {
                return this.fieldsDraft?.find( ( field ) => field.key === this.confirmRowId )?.label ?? t( 'kindField' );
            }
            if ( this.confirmTarget === 'collection' ) { return this.collectionDisplayLabel; }
            if ( this.confirmTarget === 'taxonomy' ) { return this.taxonomyDisplayLabel; }
            if ( this.confirmTarget === 'menu' ) { return this.menuName ?? ''; }
            if ( this.confirmTarget === 'partial' ) { return String( this.confirmRowId ?? '' ); }
            if ( this.confirmTarget === 'layout' ) { return String( this.confirmRowId ?? '' ); }
            if ( this.confirmTarget === 'template' ) { return String( this.confirmRowId ?? '' ); }
            if ( this.confirmTarget === 'pageTemplate' ) { return String( this.selectedPage?.title ?? '' ) || t( 'kindPage' ); }
            if ( this.confirmTarget === 'mediaForever' )
            {
                if ( this.confirmRowId === 'all' ) { return tFill( 'trashAllWord', { count: ( this.mediaTrash ?? [] ).length } ); }

                const trashed = ( this.mediaTrash ?? [] ).find( ( file ) => file.file === this.confirmRowId );

                return trashed === undefined ? String( this.confirmRowId ?? '' ) : this.mediaLabelOf( trashed );
            }
            if ( this.confirmTarget === 'entryLayout' )
            {
                const id = this.confirmRowId ?? this.sampleEntryId;
                const entry = this.collectionEditor?.entries?.find( ( candidate ) => candidate.id === id );

                return String( entry?.values?.title ?? '' ) || t( 'kindEntry' );
            }
            if ( this.confirmTarget === 'menuItem' || this.confirmTarget === 'menuAutoItem' )
            {
                const found = typeof this.confirmRowId === 'string' ? this.menuFind( this.confirmRowId ) : null;

                return found === null ? '' : this.menuItemTitle( found.item );
            }

            return '';
        },

        get confirmQuestion ()
        {
            return tFill( 'deleteQuestionNamed', { name: this.confirmName } );
        },

        get confirmDetail ()
        {
            const autoRule = typeof this.confirmRowId === 'string'
                ? ( this.menuFind( this.confirmRowId )?.item.auto ?? '' )
                : '';
            const questions = {
                block: t( 'deleteBlockQuestion' ),
                page: t( 'deletePageQuestion' ),
                field: t( 'deleteFieldQuestion' ),
                collection: t( 'deleteCollectionQuestion' ),
                entry: t( 'deleteEntryQuestion' ),
                taxonomy: t( 'deleteTaxonomyQuestion' ),
                term: t( 'deleteTermQuestion' ),
                menu: t( 'deleteMenuQuestion' ),
                menuItem: t( 'deleteMenuItemQuestion' ),
                menuAutoItem: tFill( 'deleteMenuAutoQuestion', { rule: this.menuRuleLabel( autoRule ) } ),
                entryLayout: t( 'adoptTemplateQuestion' ),
                mediaForever: t( 'deleteMediaForeverQuestion' ),
                partial: t( 'deletePartialQuestion' ),
                template: t( 'deleteTemplateQuestion' ),
                pageTemplate: t( 'returnPageQuestion' ),
            };

            return questions[ this.confirmTarget ] ?? '';
        },

        get confirmActionLabel ()
        {
            const labels = {
                block: t( 'removeBlock' ),
                page: t( 'deleteConfirmPage' ),
                field: t( 'deleteConfirmField' ),
                collection: t( 'deleteConfirmCollection' ),
                entry: t( 'deleteConfirmEntry' ),
                taxonomy: t( 'deleteConfirmTaxonomy' ),
                term: t( 'deleteConfirmTerm' ),
                menu: t( 'deleteConfirmMenu' ),
                menuItem: t( 'deleteConfirmMenuItem' ),
                menuAutoItem: t( 'deleteConfirmMenuAuto' ),
                entryLayout: t( 'adoptTemplateConfirm' ),
                mediaForever: t( 'deleteConfirmMediaForever' ),
                partial: t( 'deleteConfirmPartial' ),
            };

            return labels[ this.confirmTarget ] ?? t( 'deleteConfirm' );
        },

        async runConfirmedDelete ()
        {
            const target = this.confirmTarget;
            const rowId = this.confirmRowId;

            // The modal closes at the END, deliberately: setting
            // confirmTarget null first unmounts the button this call
            // came from, and every post-await write then lands in the
            // dead scope (DEVELOPMENT section 6) - the server delete
            // succeeded while the canvas never heard about it.
            this.suppressReloadUntil = Date.now() + 1500;

            if ( target === 'block' )
            {
                await this.removeSelectedBlock();
                this.confirmTarget = null;
                this.confirmRowId = null;
                return;
            }

            if ( target === 'field' )
            {
                if ( typeof rowId === 'string' ) { this.removeField( rowId ); }

                this.confirmTarget = null;
                this.confirmRowId = null;
                return;
            }

            if ( target === 'menuItem' )
            {
                const found = typeof rowId === 'string' ? this.menuFind( rowId ) : null;

                if ( found !== null )
                {
                    found.list.splice( found.index, 1 );

                    // The selection may have been inside the family.
                    if ( this.selectedMenuKey !== null && this.menuFind( this.selectedMenuKey ) === null ) { this.selectedMenuKey = null; }

                    this.sortEpoch += 1;
                    this.markMenuEditorDirty();
                }

                this.confirmTarget = null;
                this.confirmRowId = null;
                return;
            }

            // Deleting a template moves its pages to the default;
            // returning a custom page to a template replaces its copy.
            if ( target === 'template' )
            {
                await fetch( '/api/template', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { name: rowId } ),
                } );

                this.confirmTarget = null;
                this.confirmRowId = null;
                await this.refresh();

                if ( this.workspace === 'template' && this.surface === rowId ) { this.openSiteWorkspace( 'templates' ); }

                return;
            }

            if ( target === 'pageTemplate' )
            {
                this.confirmTarget = null;
                this.confirmRowId = null;
                await this.patchPageTemplate( { template: rowId } );
                return;
            }

            // Deleting a partial: pages inserting it report an issue
            // until re-pointed - offered, never silent (the confirm).
            if ( target === 'layout' )
            {
                await fetch( '/api/layout', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, name: rowId } ),
                } );

                if ( this.layoutsRowName === rowId ) { this.layoutsRowName = null; }
                if ( this.layoutName === rowId ) { this.layoutName = 'default'; }

                this.confirmTarget = null;
                this.confirmRowId = null;
                await this.reloadLayoutOwner();
                void this.refresh();
                return;
            }

            if ( target === 'partial' )
            {
                await fetch( '/api/partial', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { name: rowId } ),
                } );

                if ( this.surface === rowId ) { this.closeSurface(); }

                this.confirmTarget = null;
                this.confirmRowId = null;
                void this.refresh();
                return;
            }

            // Unused media cleanup (SCHEMA 13.4): the delete re-checks
            // usage server-side; journaled like any content change.
            // The permanent trash verbs: one file forever, or the
            // whole trash - the only unrecoverable deletes in Studio.
            if ( target === 'mediaForever' )
            {
                await fetch( '/api/media-trash', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( rowId === 'all' ? { action: 'empty' } : { file: rowId, action: 'delete' } ),
                } );
                await this.loadMediaLibrary();

                if ( rowId === 'all' || this.selectedMediaFile === rowId ) { this.selectedMediaFile = null; }

                this.confirmTarget = null;
                this.confirmRowId = null;
                return;
            }

            // Returning a diverged entry to the template discards its
            // own layout - the confirm modal owns the moment.
            if ( target === 'entryLayout' )
            {
                const id = rowId ?? this.sampleEntryId;

                await fetch( '/api/entry-layout', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, id, action: 'adopt' } ),
                } );

                if ( this.surface === 'entry' && this.sampleEntryId === id ) { this.closeSurface(); }

                await this.loadCollection();
                this.confirmTarget = null;
                this.confirmRowId = null;
                void this.refresh();
                return;
            }

            // Deleting an auto row turns its rule off: the siblings
            // the rule added stay as ordinary items; only this row is
            // removed (Mikey).
            if ( target === 'menuAutoItem' )
            {
                const found = typeof rowId === 'string' ? this.menuFind( rowId ) : null;

                if ( found !== null && this.menuEditor !== null )
                {
                    const rule = found.item.auto;

                    this.menuEditor[ rule ] = false;

                    const adopt = ( items ) =>
                    {
                        for ( const item of items )
                        {
                            if ( item.auto === rule ) { item.auto = ''; }

                            adopt( item.items );
                        }
                    };

                    adopt( this.menuEditor.items );
                    found.list.splice( found.index, 1 );

                    if ( this.selectedMenuKey !== null && this.menuFind( this.selectedMenuKey ) === null ) { this.selectedMenuKey = null; }

                    this.sortEpoch += 1;
                    this.markMenuEditorDirty();
                }

                this.confirmTarget = null;
                this.confirmRowId = null;
                return;
            }

            if ( target === 'menu' )
            {
                const menus = { ...( this.snapshot?.config?.menus ?? {} ) };

                delete menus[ this.menuName ];
                await fetch( '/api/menus', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { menus } ),
                } );
                this.enterWorkspace( 'page' );
            }

            if ( target === 'entry' )
            {
                const id = rowId ?? this.selectedEntryId;

                await fetch( '/api/entry', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, id } ),
                } );

                if ( this.selectedEntryId === id ) { this.selectedEntryId = null; }

                await this.loadCollection();
            }

            if ( target === 'term' )
            {
                const id = rowId ?? this.selectedTermId;

                await fetch( '/api/term', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile, id } ),
                } );

                if ( this.selectedTermId === id ) { this.selectedTermId = null; }

                await this.loadTaxonomy();
            }

            if ( target === 'page' )
            {
                await fetch( '/api/page', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { id: this.selectedPageId } ),
                } );
                this.selectedPageId = this.pages.find( ( page ) => page.slug === 'home' )?.id ?? null;
                this.pagesRowId = null;
                this.syncPageTitleDraft();
                this.applyDeselect();
            }

            if ( target === 'collection' || target === 'taxonomy' )
            {
                await fetch( target === 'collection' ? '/api/collection' : '/api/taxonomy', {
                    method: 'DELETE',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify( { file: this.workspaceFile } ),
                } );
                this.enterWorkspace( 'page' );
            }

            this.confirmTarget = null;
            this.confirmRowId = null;
            void this.refresh();
        },

        // The header trash: one delete control that always aims at
        // what the inspector is showing. Blocks remove directly (the
        // journal undoes them); everything else routes through its
        // confirm modal. Home and pages with a subtree never offer it,
        // matching their Settings rule.
        get inspectorTrashTarget ()
        {
            if ( this.layoutsRow !== null ) { return this.layoutsRow.name === 'default' || this.layoutsRow.index === true ? '' : 'layout'; }
            if ( this.workspace === 'pages' ) { return this.pagesRow !== null && !this.pageIsReserved( this.pagesRow ) ? 'page' : ''; }
            if ( this.canvasActive && this.selectedBlock !== null ) { return 'block'; }
            if ( this.workspace === 'collection' && this.entryEditor !== null ) { return 'entry'; }
            if ( this.workspace === 'taxonomy' && this.termEditor !== null ) { return 'term'; }
            if ( this.workspace === 'menu' && this.selectedMenuItem !== null ) { return 'menuItem'; }
            if ( this.workspace === 'menu' && this.menuEditor !== null ) { return 'menu'; }
            if ( this.workspace === 'collection' && this.fieldEditor !== null ) { return this.fieldEditor.key === 'title' ? '' : 'field'; }
            if ( this.workspace === 'collection' && this.surface === null && this.fieldEditor === null && this.collectionEditor !== null ) { return 'collection'; }
            if ( this.workspace === 'taxonomy' && this.taxonomyEditor !== null ) { return 'taxonomy'; }

            if ( this.workspace === 'page' && this.selectedBlock === null
                && this.selectedPage !== undefined && !this.pageIsReserved( this.selectedPage ) )
            {
                return 'page';
            }

            return '';
        },

        inspectorTrash ()
        {
            const target = this.inspectorTrashTarget;

            if ( target === '' ) { return; }

            if ( target === 'menuItem' )
            {
                this.openRowDelete( 'menuItem', this.selectedMenuKey );
                return;
            }

            if ( target === 'field' )
            {
                this.openRowDelete( 'field', this.selectedFieldKey );
                return;
            }

            this.confirmTarget = target;
        },

        inspectorBack ()
        {
            if ( !this.confirmEntryLeave( () => this.inspectorBack() ) ) { return; }

            // The pages table: back drops the row; the site card returns.
            if ( this.workspace === 'pages' )
            {
                this.pagesRowId = null;
                return;
            }

            if ( this.layoutsRow !== null )
            {
                this.layoutsRowName = null;
                return;
            }

            // A selected block ascends ONE level - to its section,
            // not to the document root (Mikey's report); the bridge
            // deselects when there is nothing above.
            if ( this.selectedBlock !== null ) { this.sendToCanvas( { kind: 'ascend' } ); }
            // Back from a canvas root goes where the crumb's first step
            // goes (Mikey, 2026-09-03): the table it came from, never
            // the settings page a partial once lived under.
            else if ( this.surface !== null && this.canvasHome !== null ) { this.openCanvasHome(); }
            else if ( this.surface !== null ) { this.closeSurface(); }
            else if ( this.selectedFieldKey !== null ) { this.selectedFieldKey = null; }
            else if ( this.selectedEntryId !== null ) { this.selectedEntryId = null; }
            else if ( this.selectedTermId !== null ) { this.selectedTermId = null; }
            else if ( this.selectedMenuKey !== null )
            {
                // Back from an item lands on the MENU's settings
                // (Mikey): the auto-include rules and the name live
                // there.
                this.selectedMenuKey = null;
                this.tab = 'settings';
            }
            else if ( this.selectedMediaFile !== null ) { this.selectedMediaFile = null; }
            else if ( this.workspace === 'menu' ) { this.openSiteWorkspace( 'menus' ); }
            else if ( this.workspace === 'page' ) { this.openPagesWorkspace( 'pages' ); }
            else { this.clearSelection(); }

            this.confirmTarget = null;
        },

        // Backspace and Delete mirror the trash button (Mikey):
        // whatever the inspector aims at, through the same confirm.
        // Never while typing, never while a modal is up.
        deletePressed ( event )
        {
            const target = event.target;
            const tag = target?.tagName;

            if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true ) { return; }

            if ( this.createKind !== null || this.pendingAbandon !== null || this.metaNameGuardOpen
                || this.addressConfirmOpen || this.saveConfirmOpen || this.mediaPicker !== null
                || this.confirmTarget !== null || this.renameConfirmOpen || this.pickerOpen === true ) { return; }

            if ( this.inspectorTrashTarget === '' ) { return; }

            this.inspectorTrash();
        },

        escapePressed ()
        {
            if ( this.palette !== null )
            {
                this.palette = null;
                return;
            }

            if ( this.createKind !== null )
            {
                this.createKind = null;
                return;
            }

            if ( this.pendingAbandon !== null )
            {
                this.cancelAbandon();
                return;
            }

            if ( this.mediaBrowse !== null )
            {
                this.mediaBrowse = null;
                return;
            }

            if ( this.mediaPicker !== null )
            {
                this.mediaPicker = null;
                return;
            }

            if ( this.metaNameGuardOpen )
            {
                this.keepEditingMetaName();
                return;
            }

            if ( this.addressConfirmOpen )
            {
                this.addressConfirmOpen = false;
                return;
            }

            if ( this.saveConfirmOpen )
            {
                this.saveConfirmOpen = false;
                return;
            }

            if ( this.workspace === 'page' )
            {
                if ( this.selectedBlock !== null ) { this.sendToCanvas( { kind: 'ascend' } ); }
                return;
            }

            if ( this.surface !== null )
            {
                if ( this.selectedBlock !== null ) { this.sendToCanvas( { kind: 'ascend' } ); }
                else { this.closeSurface(); }
                return;
            }

            this.inspectorBack();
        },

        // Morph links (SCHEMA 6): name a block here, give a block on
        // another page the same name, and their anchored elements
        // glide into each other during navigation.
        async setMorphLink ( raw )
        {
            const editor = this.blockEditor;

            if ( editor === null ) { return; }

            const slug = raw.toLowerCase().replace( /[^a-z0-9-]+/g, '-' ).replace( /^[^a-z]+/, '' ).replace( /-+$/, '' );
            const target = this.targetOfEditor( editor );

            editor.morph = slug;
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/block', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { ...target, path: editor.path, morph: slug === '' ? null : slug } ),
            } );
        },

        // The Outline popover (Mikey: it replaces Done in the crumb
        // bar): the CANVAS DOCUMENT's real heading elements, read on
        // open - the truth of what a screen reader's rotor will see,
        // semantic levels after every remap.
        toggleOutline ()
        {
            if ( this.outlineOpen )
            {
                this.outlineOpen = false;
                return;
            }

            const doc = this.$refs.canvas?.contentDocument;

            if ( doc === null || doc === undefined ) { return; }

            this.outlineItems = [ ...doc.querySelectorAll( 'h1, h2, h3, h4, h5, h6' ) ].map( ( heading ) => ( {
                level: Number( heading.tagName.slice( 1 ) ),
                text: ( heading.textContent ?? '' ).trim(),
            } ) );
            this.outlineOpen = true;
        },

        onCanvasLoad ()
        {
            if ( this.selectedBlock !== null )
            {
                this.sendToCanvas( { kind: 'select-path', path: this.selectedBlock } );
            }
        },

        get pages ()
        {
            return this.snapshot?.pages ?? [];
        },

        // The URL tree in the nav (SCHEMA 13.6): pages render as a
        // tree - children indented under their parent, parents
        // collapsible. Rows come out depth-first in file order, with
        // a cycle guard so a broken document degrades, never hangs.
        // A region canvas reads as a PARTIAL, not a page (Mikey):
        // slightly narrower, top-aligned, only as tall as its
        // content - growing as blocks are added.
        get regionSurfaceActive ()
        {
            // The 404 surface is a FULL page, not a partial: visitors
            // meet it as a real page, so it edits like one.
            return this.workspace === 'settings' && this.surface !== null && this.surface !== 'notFound';
        },

        get pageTree ()
        {
            const rows = [];
            const visited = new Set();
            const childrenOf = ( parentId ) => this.pages.filter( ( page ) => page.parent === parentId );
            const walk = ( page, depth ) =>
            {
                if ( visited.has( page.id ) ) { return; }

                visited.add( page.id );
                rows.push( { page, depth, hasChildren: childrenOf( page.id ).length > 0 } );

                if ( this.collapsedPages[ page.id ] === true ) { return; }

                for ( const child of childrenOf( page.id ) ) { walk( child, depth + 1 ); }
            };

            for ( const page of this.pinnedPageOrder )
            {
                const orphaned = page.parent !== undefined && !this.pages.some( ( candidate ) => candidate.id === page.parent );

                if ( page.parent === undefined || orphaned ) { walk( page, 0 ); }
            }

            return rows;
        },

        togglePageCollapse ( id )
        {
            this.collapsedPages[ id ] = this.collapsedPages[ id ] !== true;
        },

        // The URL a page or mounted collection answers at, spoken in
        // breadcrumbs and settings: the slug chain, cycle-guarded.
        pagePathOf ( id )
        {
            const segments = [];
            const visited = new Set();
            let current = this.pages.find( ( page ) => page.id === id );

            while ( current !== undefined && !visited.has( current.id ) )
            {
                visited.add( current.id );

                if ( current.slug !== 'home' ) { segments.unshift( current.slug ); }

                current = current.parent === undefined ? undefined : this.pages.find( ( page ) => page.id === current.parent );
            }

            return segments;
        },

        // "Nest under" options for a page: never home, never itself,
        // never its own descendants - nesting there would loop.
        get pageParentOptions ()
        {
            const selected = this.selectedPage;

            if ( selected === undefined ) { return []; }

            const excluded = new Set( [ selected.id ] );
            let grew = true;

            while ( grew )
            {
                grew = false;

                for ( const page of this.pages )
                {
                    if ( page.parent !== undefined && excluded.has( page.parent ) && !excluded.has( page.id ) )
                    {
                        excluded.add( page.id );
                        grew = true;
                    }
                }
            }

            return this.pages.filter( ( page ) => !this.pageIsReserved( page ) && !excluded.has( page.id ) );
        },

        get nestAddressLine ()
        {
            const id = this.selectedPageId;

            if ( id === null ) { return ''; }

            return tFill( 'nestAddressNote', { path: this.pagePathOf( id ).join( '/' ) } );
        },

        // The mounted address, '/about/events/' style: what settings
        // rows and the workspace meta line speak (SCHEMA 13.6).
        get collectionAddress ()
        {
            const parent = this.collectionEditor?.parent;
            const segments = typeof parent === 'string' ? this.pagePathOf( parent ) : [];

            return '/' + [ ...segments, this.stem ].join( '/' ) + '/';
        },

        get mountAddressLine ()
        {
            return tFill( 'nestAddressNote', { path: this.collectionAddress.replace( /^\/|\/$/g, '' ) } );
        },

        async setPageParent ( value )
        {
            const id = this.selectedPageId;

            if ( id === null ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/page', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { id, patch: { parent: value === '' ? null : value } } ),
            } );
            void this.refresh();
        },

        // Mount options for a collection: any page but the reserved two.
        get collectionMountOptions ()
        {
            return this.pages.filter( ( page ) => !this.pageIsReserved( page ) );
        },

        // Pagination (SCHEMA 13.5): entries per index page; empty
        // clears it back to one page.
        async setCollectionPageSize ( raw )
        {
            const size = Number( raw );

            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { pageSize: Number.isInteger( size ) && size >= 1 ? size : null } } ),
            } );
            await this.loadCollection();
            void this.refresh();
        },

        async setCollectionParent ( value )
        {
            this.suppressReloadUntil = Date.now() + 1500;
            await fetch( '/api/collection', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file: this.workspaceFile, patch: { parent: value === '' ? null : value } } ),
            } );
            await this.loadCollection();
            void this.refresh();
        },

        get collections ()
        {
            return this.snapshot?.collections ?? [];
        },

        get taxonomies ()
        {
            return this.snapshot?.taxonomies ?? [];
        },

        get issues ()
        {
            return this.snapshot?.issues ?? [];
        },

        get projectName ()
        {
            return this.snapshot?.projectName ?? '';
        },

        get selectedPage ()
        {
            return this.pages.find( ( page ) => page.id === this.selectedPageId );
        },

        // The canvas navigates by REPLACING its location, never by a
        // src change: an iframe's src change adds an entry to the
        // window's joint history, and Back then spends a click undoing
        // a canvas load with nothing visible happening (Mikey: "the
        // back button gets stuck"). Runs as an effect, so it follows
        // previewSrc.
        syncCanvasSrc ( frame )
        {
            const target = new URL( this.previewSrc, window.location.href ).href;

            if ( frame.dataset.src === target ) { return; }

            frame.dataset.src = target;
            frame.contentWindow?.location.replace( target );
        },

        get previewSrc ()
        {
            if ( this.surface !== null )
            {
                if ( this.workspace === 'template' )
                {
                    const sample = this.samplePage === null ? '' : `&page=${this.samplePage.id}`;

                    return `/preview-page-template/${this.surface}?v=${this.contentVersion}${sample}`;
                }

                if ( this.workspace === 'settings' )
                {
                    return this.surface === 'notFound'
                        ? `/preview-404?v=${this.contentVersion}`
                        : `/preview-region/${this.surface}?v=${this.contentVersion}`;
                }

                if ( this.surface === 'entry' )
                {
                    return `/canvas-entry/${this.stem}?entry=${this.sampleEntryId}&v=${this.contentVersion}`;
                }

                const isTaxonomy = this.workspace === 'taxonomy';
                const sample = this.surface === 'template' && this.sampleEntryId !== null
                    ? `&${isTaxonomy ? 'term' : 'entry'}=${this.sampleEntryId}`
                    : '';
                const layout = this.surface === 'template' ? `&layout=${this.layoutName}` : '';

                const surfaceName = this.surface === 'template'
                    ? ( isTaxonomy ? 'term-template' : 'entry-template' )
                    : ( isTaxonomy ? 'term-index' : 'index' );

                return `/preview-${surfaceName}/${this.stem}?v=${this.contentVersion}${sample}${layout}`;
            }

            return `/canvas/${this.selectedPage?.slug ?? ''}?v=${this.contentVersion}`;
        },

        // Breadcrumbs speak labels, never file stems (SCHEMA 13.2:
        // plumbing stays out of sight); a page's crumb is its slug,
        // the public spelling of a public page.
        // The crumb's first step (Mikey): the table this canvas came
        // from, clickable - pages, partials, or templates.
        get canvasHome ()
        {
            if ( this.surface === null && this.workspace === 'page' ) { return { label: t( 'navPages' ).toLowerCase(), view: [ 'pages', 'pages' ] }; }
            if ( this.workspace === 'settings' && this.surface !== null ) { return { label: t( 'navPartials' ).toLowerCase(), view: [ 'site', 'partials' ] }; }
            if ( this.workspace === 'template' && this.surface !== null ) { return { label: t( 'viewTemplates' ).toLowerCase(), view: [ 'site', 'templates' ] }; }

            return null;
        },

        openScopeSelection ()
        {
            const scope = this.scopeSelection;

            if ( scope === null ) { return; }
            if ( scope.kind === 'partial' ) { this.openPartial( scope.name ); }
            else { this.openTemplate( scope.name ); }
        },

        openCanvasHome ()
        {
            const home = this.canvasHome;

            if ( home === null ) { return; }

            if ( home.view[ 0 ] === 'pages' ) { this.openPagesWorkspace( 'pages' ); }
            else { this.openSiteWorkspace( home.view[ 1 ] ); }
        },

        get canvasRootLabel ()
        {
            if ( this.surface !== null )
            {
                if ( this.workspace === 'settings' ) { return this.surfaceLabel.toLowerCase(); }
                if ( this.workspace === 'template' ) { return this.surface; }

                return this.workspace === 'taxonomy' ? this.taxonomyDisplayLabel : this.collectionDisplayLabel;
            }

            if ( this.selectedPage === undefined ) { return ''; }

            // A nested page's crumb speaks its whole address.
            const path = this.pagePathOf( this.selectedPage.id );

            return path.length === 0 ? this.selectedPage.slug : path.join( ' / ' );
        },

        // The sample scope for local morphs mirrors the server: the
        // chosen sample entry, or the first one.
        get sampleEntryScope ()
        {
            if ( this.workspace === 'taxonomy' )
            {
                const term = this.sampleTerm;

                if ( term === null ) { return {}; }

                return {
                    id: term.id,
                    name: term.name,
                    description: term.description ?? '',
                    ...( term.image === undefined ? {} : { image: JSON.parse( JSON.stringify( term.image ) ) } ),
                };
            }

            const sample = this.sampleEntry;

            if ( sample === null ) { return {}; }

            return { id: sample.id, ...this.presentSampleValues( JSON.parse( JSON.stringify( sample.values ) ), this.collectionEditor?.fields ) };
        },

        // Presentation mirror (SCHEMA 13.5): the sample scope local
        // morphs render through speaks like the server's - dates in
        // their field's format, references as their target's name.
        presentSampleValues ( values, fields )
        {
            const months = [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ];
            const presented = { ...values };

            for ( const [ key, field ] of Object.entries( fields ?? {} ) )
            {
                const value = presented[ key ];

                if ( field.type === 'date' && typeof value === 'string' && field.rules?.format !== 'iso' )
                {
                    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( value );
                    const month = match === null ? undefined : months[ Number( match[ 2 ] ) - 1 ];

                    if ( match !== null && month !== undefined )
                    {
                        presented[ key ] = field.rules?.format === 'short'
                            ? `${month.slice( 0, 3 )} ${Number( match[ 3 ] )}, ${match[ 1 ]}`
                            : `${month} ${Number( match[ 3 ] )}, ${match[ 1 ]}`;
                    }
                }

                if ( field.type === 'reference' && Array.isArray( value ) )
                {
                    presented[ key ] = this.referenceLabelFor( field, value );
                }
                else if ( field.type === 'reference' )
                {
                    // Bind-through, mirrored: a String object whose
                    // coercion is the target's name and whose
                    // properties are what the chrome knows of the
                    // target (terms fully; entries only id and title
                    // here - the server render is the full truth).
                    const wrap = ( base, extras ) =>
                    {
                        const wrapped = new String( base );

                        for ( const [ extraKey, extra ] of Object.entries( extras ) )
                        {
                            if ( !( extraKey in wrapped ) ) { wrapped[ extraKey ] = extra; }
                        }

                        return wrapped;
                    };

                    if ( typeof field.rules?.taxonomy === 'string' )
                    {
                        const terms = this.collectionEditor?.taxonomies?.find( ( candidate ) => candidate.stem === field.rules.taxonomy )?.terms ?? [];
                        const term = terms.find( ( candidate ) => candidate.id === value );

                        presented[ key ] = term === undefined
                            ? ''
                            : wrap( term.name, {
                                    id: term.id,
                                    name: term.name,
                                    description: term.description ?? '',
                                    ...( term.image === undefined ? {} : { image: term.image } ),
                                } );
                    }
                    else if ( typeof field.rules?.type === 'string' )
                    {
                        const target = this.collectionEditor?.collectionRefs?.find( ( candidate ) => candidate.stem === field.rules.type );
                        const entry = target?.entries.find( ( candidate ) => candidate.id === value );

                        presented[ key ] = entry === undefined ? '' : wrap( entry.title, { id: entry.id, title: entry.title } );
                    }
                    else { presented[ key ] = ''; }
                }
            }

            return presented;
        },

        get hasAvatar ()
        {
            return this.snapshot?.hasAvatar === true;
        },

        get shortcutLabel ()
        {
            return navigator.platform.toLowerCase().includes( 'mac' ) ? 'Cmd K' : 'Ctrl K';
        },

        // The Ctrl-K palette: every navigable destination the left
        // rail and Site settings know, filtered as you type. Entries
        // carry their own open() so the palette never re-learns the
        // navigation rules.
        get paletteEntries ()
        {
            const entries = [];

            for ( const page of this.pages )
            {
                entries.push( { key: `page:${page.id}`, label: page.title || page.slug, kind: t( 'kindPage' ), open: () => this.selectPage( page.id ) } );
            }

            for ( const doc of this.collections )
            {
                entries.push( { key: `collection:${doc.file}`, label: doc.label, kind: t( 'kindCollection' ), open: () => this.openCollection( doc.file ) } );
            }

            for ( const doc of this.taxonomies )
            {
                entries.push( { key: `taxonomy:${doc.file}`, label: doc.label, kind: t( 'kindTaxonomy' ), open: () => this.openTaxonomy( doc.file ) } );
            }

            for ( const name of Object.keys( this.snapshot?.config?.menus ?? {} ) )
            {
                entries.push( { key: `menu:${name}`, label: name, kind: t( 'kindMenu' ), open: () => this.openMenu( name ) } );
            }

            for ( const name of this.snapshot?.partials ?? [] )
            {
                entries.push( { key: `partial:${name}`, label: name, kind: t( 'kindPartial' ), open: () => this.openSurface( name ) } );
            }

            for ( const name of this.templateNames )
            {
                entries.push( { key: `template:${name}`, label: name, kind: t( 'kindTemplate' ), open: () => this.openTemplate( name ) } );
            }

            entries.push( { key: 'pages', label: t( 'navAllPages' ), kind: '', open: () => this.openPagesWorkspace( 'pages' ) } );
            entries.push( { key: 'pages:templates', label: t( 'navTemplates' ), kind: '', open: () => this.openSiteWorkspace( 'templates' ) } );
            entries.push( { key: 'site:partials', label: t( 'navPartials' ), kind: '', open: () => this.openSiteWorkspace( 'partials' ) } );
            entries.push( { key: 'site:menus', label: t( 'navMenus' ), kind: '', open: () => this.openSiteWorkspace( 'menus' ) } );
            entries.push( { key: 'theme', label: t( 'navTheme' ), kind: '', open: () => this.openTheme() } );

            entries.push( { key: 'surface:header', label: t( 'editHeader' ), kind: '', open: () => this.openSurface( 'header' ) } );
            entries.push( { key: 'surface:footer', label: t( 'editFooter' ), kind: '', open: () => this.openSurface( 'footer' ) } );
            entries.push( { key: 'surface:notFound', label: t( 'navNotFound' ), kind: t( 'kindPage' ), open: () => this.openNotFoundSurface() } );
            entries.push( { key: 'media', label: t( 'navMedia' ), kind: '', open: () => this.openMediaWorkspace() } );
            entries.push( { key: 'settings', label: t( 'navSiteSettings' ), kind: '', open: () => this.openSettings() } );
            entries.push( ...( this.palette?.entryRows ?? [] ) );

            return entries;
        },

        // Fuzzy: substring matches rank first, then in-order
        // subsequence matches (EDITOR: "fuzzy search").
        get paletteResults ()
        {
            const query = ( this.palette?.query ?? '' ).trim().toLowerCase();

            if ( query === '' ) { return this.paletteEntries.slice( 0, 12 ); }

            const subsequence = ( label ) =>
            {
                let at = 0;

                for ( const character of query )
                {
                    at = label.indexOf( character, at );

                    if ( at < 0 ) { return false; }

                    at += 1;
                }

                return true;
            };
            const direct = [];
            const loose = [];

            for ( const entry of this.paletteEntries )
            {
                const label = entry.label.toLowerCase();

                if ( label.includes( query ) || entry.kind.toLowerCase().startsWith( query ) ) { direct.push( entry ); }
                else if ( subsequence( label ) ) { loose.push( entry ); }
            }

            return [ ...direct, ...loose ].slice( 0, 12 );
        },

        togglePalette ()
        {
            if ( this.palette !== null )
            {
                this.palette = null;
                return;
            }

            this.palette = { query: '', index: 0, entryRows: [] };
            this.$nextTick( () => this.$refs.paletteInput?.focus() );
            void this.loadPaletteEntries();
        },

        // Entries join the palette lazily (EDITOR: "every page,
        // entry, and setting"): titles are not in the snapshot, so
        // opening the palette fetches each collection once.
        async loadPaletteEntries ()
        {
            const opened = this.palette;
            const lists = await Promise.all( this.collections.map( async ( doc ) =>
            {
                const response = await fetch( `/api/collection?${new URLSearchParams( { file: doc.file } ).toString()}` );

                if ( !response.ok ) { return []; }

                const loaded = await response.json();

                return ( loaded.entries ?? [] )
                    .map( ( entry ) => ( {
                        key: `entry:${entry.id}`,
                        label: String( entry.values?.title ?? '' ),
                        kind: t( 'kindEntry' ),
                        open: () => this.openEntryFromPalette( doc.file, entry.id ),
                    } ) )
                    .filter( ( row ) => row.label !== '' );
            } ) );

            if ( this.palette === opened && opened !== null ) { opened.entryRows = lists.flat(); }
        },

        openEntryFromPalette ( file, id )
        {
            this.openCollection( file );
            this.selectEntry( id );
        },

        paletteMove ( delta )
        {
            const count = this.paletteResults.length;

            if ( this.palette === null || count === 0 ) { return; }

            this.palette.index = ( this.palette.index + delta + count ) % count;
        },

        paletteRun ( entry = null )
        {
            const chosen = entry ?? this.paletteResults[ this.palette?.index ?? 0 ];

            if ( chosen === undefined ) { return; }

            this.palette = null;
            chosen.open();
        },

        // Partials and templates both sit inset in the frame (Mikey),
        // as tall as their canvas reports.
        // The inspector's tabs show only when they hold something
        // (Mikey), except on a canvas, where a tab that a selection
        // would fill stays and prompts for one. These mirror the
        // panes' own conditions.
        get contentTabFilled ()
        {
            if ( this.scopeSelection !== null ) { return true; }
            if ( this.canvasActive && ( this.blockEditor !== null || this.repeatEditor !== null ) ) { return true; }
            if ( this.canvasActive && this.selectedBlock !== null && this.blockInfoAt( this.selectedBlock )?.kind === 'slot' ) { return true; }
            if ( this.workspace === 'media' ) { return true; }
            if ( this.workspace === 'pages' && this.pagesRow === null ) { return true; }
            if ( this.surface !== null && this.blockEditor === null && this.repeatEditor === null ) { return true; }
            if ( this.workspace === 'collection' && this.surface === null && this.collectionView === 'entries' && this.collectionEditor !== null ) { return true; }
            if ( this.layoutsRow !== null ) { return true; }
            if ( this.workspace === 'collection' && this.surface === null && this.collectionView === 'fields' && this.fieldEditor !== null ) { return true; }
            if ( this.workspace === 'taxonomy' && this.surface === null && ( this.termEditor !== null || ( this.taxonomyEditor !== null && this.taxonomyEditor.index !== false ) ) ) { return true; }
            if ( this.workspace === 'menu' && this.menuEditor !== null ) { return true; }
            if ( this.workspace === 'template' && this.surface !== null && this.selectedBlock === null ) { return true; }

            return this.workspace === 'settings' && this.surface === null;
        },

        get settingsTabFilled ()
        {
            if ( this.canvasActive && this.selectedBlock !== null && this.blockInfoAt( this.selectedBlock )?.kind !== 'slot' ) { return true; }
            if ( this.workspace === 'collection' && this.surface === null && this.collectionView === 'fields' && this.fieldEditor !== null ) { return true; }
            if ( this.workspace === 'collection' && this.surface === null && this.collectionEditor !== null && this.entryEditor === null && this.fieldEditor === null ) { return true; }
            if ( this.workspace === 'collection' && this.collectionView === 'entries' && this.entryEditor !== null ) { return true; }
            if ( ( this.workspace === 'page' || ( this.workspace === 'pages' && this.pagesRow !== null ) ) && this.selectedBlock === null && this.selectedPage !== undefined ) { return true; }
            if ( this.canvasEntry !== null && this.selectedBlock === null ) { return true; }
            if ( this.workspace === 'taxonomy' && ( this.termEditor !== null || this.taxonomyEditor !== null ) ) { return true; }

            return this.workspace === 'menu' && this.menuEditor !== null;
        },

        get contentTabAvailable ()
        {
            return this.contentTabFilled || this.canvasActive;
        },

        get settingsTabAvailable ()
        {
            return this.settingsTabFilled || this.canvasActive;
        },

        // The tab in force: the chosen one when it has content, else
        // the first that does.
        get activeTab ()
        {
            const available = {
                content: this.contentTabAvailable,
                settings: this.settingsTabAvailable,
                usage: this.usageTabAvailable,
            };

            if ( available[ this.tab ] === true ) { return this.tab; }

            return Object.keys( available ).find( ( name ) => available[ name ] === true ) ?? this.tab;
        },

        get insetCanvasActive ()
        {
            return this.regionSurfaceActive || this.workspace === 'template';
        },

        get previewStyle ()
        {
            // A region partial's wrapper hugs its content: as tall as
            // the canvas reports, never taller. Width follows the
            // viewport toggle - the tablet and phone widths apply to a
            // partial exactly as to a page; desktop fills the frame
            // between equal margins (the container's padding).
            if ( this.insetCanvasActive )
            {
                const widths = { desktop: '100%', tablet: '768px', phone: '390px' };

                return { width: widths[ this.viewport ], height: `${this.canvasFitHeight}px` };
            }

            const sizes = {
                desktop: { width: '100%', height: '100%' },
                tablet: { width: '768px', height: '92%' },
                phone: { width: '390px', height: '72%' },
            };

            return sizes[ this.viewport ];
        },

        // The ring lives in the chrome's overlay (EDITOR section 3):
        // 3px offset from the border box, mirroring the element's own
        // radius, 2px minimum. At the frame's edges it clamps - a ring
        // edge is always visible, and the site is never padded to
        // make room for chrome (EDITOR section 2).
        ringStyle ( rect, radius, offset, border )
        {
            if ( rect === null ) { return {}; }

            const frameWidth = this.$refs.canvas?.clientWidth ?? Number.MAX_SAFE_INTEGER;
            const frameHeight = this.$refs.canvas?.clientHeight ?? Number.MAX_SAFE_INTEGER;
            const left = Math.max( 0, rect.x - offset );
            const top = Math.max( 0, rect.y - offset );
            const right = Math.min( frameWidth, rect.x + rect.width + offset );
            const bottom = Math.min( frameHeight, rect.y + rect.height + offset );

            return {
                left: `${left}px`,
                top: `${top}px`,
                width: `${Math.max( 0, right - left - border * 2 )}px`,
                height: `${Math.max( 0, bottom - top - border * 2 )}px`,
                borderRadius: `${Math.max( 2, radius )}px`,
            };
        },

        get selectionRingStyle ()
        {
            return this.ringStyle( this.selectionRect, this.selectionRadius, 3, 2 );
        },

        // Seam geometry: a horizontal band across a column flow, or a
        // vertical band down a row flow (a section's side-by-side
        // children get vertical seams).
        get seamStyle ()
        {
            const seam = this.seamInfo;

            if ( seam === null ) { return {}; }

            if ( seam.orientation === 'v' )
            {
                return {
                    left: `${seam.at - 13}px`,
                    top: `${seam.crossStart}px`,
                    width: '26px',
                    height: `${seam.crossSize}px`,
                };
            }

            return {
                left: `${seam.crossStart}px`,
                top: `${seam.at - 13}px`,
                width: `${seam.crossSize}px`,
                height: '26px',
            };
        },

        get seamIsVertical ()
        {
            return this.seamInfo?.orientation === 'v';
        },

        // While the handle pill is pinned, the hover outline belongs
        // to ITS section - the pill and the outline stay together.
        get hoverLeaf ()
        {
            return this.pinnedHandle ?? this.hoverChain[ 0 ] ?? null;
        },

        get hoverRingStyle ()
        {
            const leaf = this.hoverLeaf;

            return leaf === null ? {} : this.ringStyle( leaf.rect, leaf.radius, 3, 1 );
        },

        // The section handle (EDITOR section 2): while the pointer is
        // anywhere inside a section, a small pill sits at its top
        // edge; clicking it selects the section directly.
        get sectionHandle ()
        {
            if ( this.pinnedHandle !== null && this.pinnedHandle.path !== this.selectedBlock )
            {
                return this.pinnedHandle;
            }

            for ( const entry of this.hoverChain )
            {
                if ( [ 'section', 'slot' ].includes( this.blockInfoAt( entry.path )?.kind ) && entry.path !== this.selectedBlock )
                {
                    return entry;
                }
            }

            return null;
        },

        // The pill over a hovered section reads "Section", except for
        // a template's own header or footer root on the template
        // canvas, which it names (Mikey).
        get sectionHandleWord ()
        {
            const path = this.sectionHandle?.path ?? '';

            if ( this.blockInfoAt( path )?.kind === 'slot' ) { return t( 'blockContent' ); }

            const part = this.workspace === 'template' ? /^(header|footer)\[\d+\]$/.exec( path )?.[ 1 ] : undefined;

            return t( part === 'header' ? 'partHeader' : part === 'footer' ? 'partFooter' : 'blockSection' );
        },

        get sectionHandleStyle ()
        {
            const handle = this.sectionHandle;

            if ( handle === null ) { return {}; }

            // The pill rides the section's top edge, where a horizontal
            // seam also lives; when one is showing there, the pill
            // tucks inside the section instead of colliding (Mikey).
            const seam = this.seamInfo;
            const edge = Math.max( 2, handle.rect.y - 11 );
            const collides = seam !== null && seam.orientation !== 'v' && Math.abs( seam.at - handle.rect.y ) < 26;

            return {
                left: `${handle.rect.x + handle.rect.width / 2 - 34}px`,
                top: `${collides ? handle.rect.y + 10 : edge}px`,
            };
        },

        get chipStyle ()
        {
            if ( this.selectionRect === null ) { return {}; }

            const above = this.selectionRect.y - 29;

            return {
                left: `${Math.max( 2, this.selectionRect.x - 3 )}px`,
                top: `${above < 2 ? this.selectionRect.y + 5 : above}px`,
            };
        },

        // Marker paths are the document addresses ("blocks[1].blocks[0]");
        // the API's block tree resolves them to kinds and titles.
        blockInfoAt ( path )
        {
            if ( typeof path !== 'string' ) { return undefined; }

            const indexes = [ ...path.matchAll( /(?:blocks|header|footer)\[(\d+)\]/g ) ].map( ( match ) => Number( match[ 1 ] ) );
            let info;
            let level = this.workspace === 'template'
                ? ( this.snapshot?.templates?.[ this.surface ]?.[ this.partOfPath( path ) ] ?? [] )
                : ( this.surface !== null ? this.surfaceBlocks : this.selectedPage?.blocks );

            for ( const index of indexes )
            {
                info = level?.[ index ];
                level = info?.children;
            }

            return info;
        },

        blockLabel ( info )
        {
            if ( info === undefined ) { return ''; }
            if ( info.title !== undefined ) { return info.title; }

            return t( info.kind === 'repeat' ? 'blockRepeat' : 'blockSection' );
        },

        // A label for a marker path: the block's own, except a
        // template's header or footer root (Mikey: "Header"/"Footer",
        // never "Section") and the content slot ("Content").
        blockLabelAt ( path )
        {
            const info = this.blockInfoAt( path );

            if ( info?.kind === 'slot' ) { return t( 'blockContent' ); }

            const part = this.workspace === 'template' ? /^(header|footer)\[\d+\]$/.exec( path ?? '' )?.[ 1 ] : undefined;

            if ( part === 'header' ) { return t( 'partHeader' ); }
            if ( part === 'footer' ) { return t( 'partFooter' ); }

            return this.blockLabel( info );
        },

        // The subtitle word for the selected block: section, component,
        // or the slot's owner.
        selectedKindWord ()
        {
            const kind = this.blockInfoAt( this.selectedBlock )?.kind;

            if ( kind === 'slot' ) { return `${t( 'kindTemplate' )} · ${this.surface ?? ''}`; }

            return t( kind === 'section' ? 'blockSection' : 'kindComponent' ).toLowerCase();
        },

        get selectionLabel ()
        {
            return this.blockLabelAt( this.selectedBlock );
        },

        // The breadcrumb's ancestor crumbs: every prefix of the
        // selected path, labeled, the leaf last (EDITOR section 2).
        get selectionTrail ()
        {
            if ( this.selectedBlock === null ) { return []; }

            const parts = [ ...this.selectedBlock.matchAll( /(?:blocks|header|footer)\[\d+\]/g ) ].map( ( match ) => match[ 0 ] );
            const trail = [];
            let prefix = '';

            for ( const part of parts )
            {
                prefix = prefix === '' ? part : `${prefix}.${part}`;
                trail.push( { path: prefix, label: this.blockLabelAt( prefix ) } );
            }

            return trail;
        },

        get inspectorTitle ()
        {
            if ( this.scopeSelection !== null ) { return this.scopeSelection.name; }
            if ( this.repeatEditor !== null ) { return t( 'blockRepeat' ); }

            if ( this.surface !== null )
            {
                const owner = this.workspace === 'settings' || this.workspace === 'template'
                    ? this.surfaceLabel
                    : ( this.workspace === 'taxonomy' ? this.taxonomyDisplayLabel : this.collectionDisplayLabel );

                return this.selectedBlock !== null ? this.selectionLabel : owner;
            }

            if ( this.workspace === 'collection' )
            {
                if ( this.layoutsRow !== null ) { return this.layoutsRow.index === true ? t( 'layoutIndexPage' ) : this.layoutsRow.name; }

                if ( this.collectionView === 'fields' )
                {
                    return this.fieldEditor !== null ? this.fieldEditor.label : this.collectionDisplayLabel;
                }

                const entryTitle = this.entryEditor?.values?.title;

                return this.entryEditor !== null
                    ? ( entryTitle === '' || entryTitle === undefined ? t( 'kindEntry' ) : String( entryTitle ) )
                    : this.collectionDisplayLabel;
            }

            if ( this.workspace === 'taxonomy' )
            {
                if ( this.layoutsRow !== null ) { return this.layoutsRow.index === true ? t( 'layoutIndexPage' ) : this.layoutsRow.name; }

                return this.termEditor !== null
                    ? ( this.termEditor.name === '' ? t( 'kindTerm' ) : this.termEditor.name )
                    : this.taxonomyDisplayLabel;
            }

            if ( this.workspace === 'menu' )
            {
                return this.selectedMenuItem !== null ? this.menuItemTitle( this.selectedMenuItem ) : this.menuName ?? '';
            }

            if ( this.workspace === 'media' )
            {
                return this.selectedMedia !== null ? this.mediaLabelOf( this.selectedMedia ) : t( 'navMedia' );
            }

            if ( this.workspace === 'pages' ) { return this.pagesRow !== null ? this.pagesRow.title : t( 'navPages' ); }
            if ( this.workspace === 'settings' ) { return this.projectName; }

            return this.selectedBlock !== null ? this.selectionLabel : this.selectedPage?.title ?? '';
        },

        // The identity subtitle, board style: "collection · events.json",
        // "events · field", "fixture-kit / card".
        get inspectorKind ()
        {
            if ( this.scopeSelection !== null ) { return t( this.scopeSelection.kind === 'partial' ? 'kindPartial' : 'kindTemplate' ); }
            if ( this.repeatEditor !== null ) { return this.repeatShownLabel; }

            if ( this.surface !== null )
            {
                if ( this.selectedBlock !== null )
                {
                    const reference = this.blockEditor?.reference;

                    if ( typeof reference === 'string' ) { return reference.replace( '/', ' / ' ); }

                    return this.selectedKindWord();
                }

                if ( this.workspace === 'settings' ) { return `${t( 'kindPartial' )} · ${this.surfaceLabel.toLowerCase()}`; }
                if ( this.workspace === 'template' ) { return t( 'kindTemplate' ); }

                // A layout canvas names its layout (Mikey): "Events ·
                // default layout", "Events · wide-card layout", and a
                // rogue entry's canvas "Events · custom layout".
                const owner = this.workspace === 'taxonomy' ? this.taxonomyDisplayLabel : this.collectionDisplayLabel;

                if ( this.surface === 'template' ) { return `${owner} · ${this.layoutName} ${t( 'kindLayout' )}`; }
                if ( this.surface === 'entry' ) { return `${owner} · ${t( 'layoutOwnOption' )} ${t( 'kindLayout' )}`; }

                return `${owner} · ${this.surfaceLabel.toLowerCase()}`;
            }

            if ( this.workspace === 'collection' && this.collectionView === 'fields' && this.fieldEditor !== null )
            {
                return `${this.collectionDisplayLabel} · ${t( 'kindField' )}`;
            }

            if ( this.layoutsRow !== null ) { return `${t( 'kindLayout' )} · ${this.workspaceFile ?? ''}`; }

            if ( this.workspace === 'collection' )
            {
                return this.entryEditor !== null
                    ? `${this.collectionDisplayLabel} · ${t( 'kindEntry' )}`
                    : `${t( 'kindCollection' )} · ${this.workspaceFile ?? ''}`;
            }

            if ( this.workspace === 'taxonomy' )
            {
                return this.termEditor !== null
                    ? `${this.taxonomyDisplayLabel} · ${t( 'kindTerm' )}`
                    : `${t( 'kindTaxonomy' )} · ${this.workspaceFile ?? ''}`;
            }

            if ( this.workspace === 'menu' )
            {
                return this.selectedMenuItem !== null
                    ? `${this.menuName ?? ''} · ${t( 'kindMenuItem' )}`
                    : `${t( 'kindMenu' )} · site.json`;
            }

            if ( this.workspace === 'media' )
            {
                const home = this.mediaView === 'trash' ? 'trash/' : 'media/';

                return this.selectedMedia !== null
                    ? `${this.mediaSizeLabel( this.selectedMedia.size )} · ${home}`
                    : `${t( 'kindMediaLibrary' )} · ${home}`;
            }

            if ( this.workspace === 'pages' ) { return this.pagesRow !== null ? `${t( 'kindPage' )} · ${this.pagesRow.slug}` : 'pages.json'; }
            if ( this.workspace === 'settings' ) { return t( 'kindSite' ); }

            if ( this.selectedBlock !== null )
            {
                const reference = this.blockEditor?.reference;

                if ( typeof reference === 'string' ) { return reference.replace( '/', ' / ' ); }

                return this.selectedKindWord();
            }

            return t( 'kindPage' );
        },

        get editorFieldKeys ()
        {
            return Object.keys( this.blockEditor?.fields ?? {} );
        },
    } ) );

    // One field row's scope: its definition, its target record (the
    // block's props, or a repeater item), and everything the row's
    // template needs. Reused at both depths; that reuse is what makes
    // repeater recursion work.
    Alpine.data( 'fieldCtx', ( key, fields, target, bindable = false ) => ( {
        key,
        fields,
        target,
        bindable,
        bindMenuOpen: false,

        // The searchable picker (Mikey: a select past ~8 options gets
        // a filter box instead of a raw dropdown).
        refQuery: '',
        refPickerOpen: false,
        newTermDraft: null,

        get field ()
        {
            return this.fields[ this.key ];
        },

        get visible ()
        {
            const condition = this.field.showWhen;

            return condition === undefined ? true : evalCondition( condition.source, this.target );
        },

        get value ()
        {
            return this.target[ this.key ];
        },

        set value ( next )
        {
            this.target[ this.key ] = next;
            this.markDirty();
        },

        // Where an edit lands depends on whose record this row edits
        // (Mikey's bug: a Location pick LOOKED saved while only the
        // block path ever saved - and that path no-ops without a
        // selected block). Entry values ride the entry save, the
        // create modal collects until submit, and block props - the
        // original tenant - keep the morph-and-save path.
        markDirty ()
        {
            if ( this.createKind !== null ) { return; }

            // The repeat wiring's literal editors write into
            // repeat.props and ride the repeat save (Mikey: "Same for
            // all" gets a real value editor).
            if ( this.repeatEditor !== null )
            {
                this.markRepeatDirty();
                return;
            }

            if ( this.workspace === 'collection' && this.surface === null && this.entryEditor !== null )
            {
                this.markEntryDirty();
                return;
            }

            this.markBlockDirty();
        },

        openMedia ()
        {
            this.openMediaPicker( this.field.type === 'file' ? 'file' : 'image', this.target, this.key, () => this.markDirty() );
        },

        // The nag half of required enforcement: the draft never
        // blocks, but an empty required field says so under itself.
        // Conditional requireds (requiredWhen) wait for publish, where
        // the full evaluator runs.
        get missingRequired ()
        {
            if ( this.field.required !== true || !this.visible ) { return false; }

            const value = this.value;

            if ( value === undefined || value === null ) { return true; }
            if ( typeof value === 'string' ) { return value.trim() === ''; }
            if ( Array.isArray( value ) ) { return value.length === 0; }
            if ( this.field.type === 'image' && typeof value === 'object' && !isBindValue( value ) )
            {
                return typeof value.src !== 'string' || value.src.trim() === '';
            }

            return false;
        },

        // A bound prop shows as a chip, not an input: its value comes
        // from the entry, per item (SCHEMA 13.5). On a bindable row
        // (template canvas props), the link control opens the wiring
        // menu: type-compatible entry fields, or back to a literal.
        get isBound ()
        {
            return isBindValue( this.value );
        },

        get bindLabel ()
        {
            const key = this.isBound ? this.value.$bind.replace( /^(entry|term)\./, '' ) : '';

            return this.bindSourceFields[ key ]?.label ?? key;
        },

        // What binds can draw from: the collection's fields, or the
        // FIXED term shape on a taxonomy's template (SCHEMA 13.3).
        // Inside a repeat's wiring the SOURCE's fields are the menu
        // (Mikey: the established linking, one idiom everywhere) -
        // link an item property, or enter a value used for every
        // item.
        get bindSourceFields ()
        {
            if ( this.repeatEditor !== null ) { return this.repeatCollectionFields; }

            if ( this.workspace === 'taxonomy' )
            {
                return {
                    name: { label: t( 'termName' ), type: 'text' },
                    description: { label: t( 'termDescription' ), type: 'textarea' },
                    image: { label: t( 'termImage' ), type: 'image' },
                };
            }

            // The inherent entry.url joins the bind menu when this
            // collection's entries emit pages; a real "url" field
            // spreads over it.
            return {
                ...( this.collectionEditor?.index !== false && this.collectionEditor?.templateBlocks !== undefined
                    ? { url: { label: 'URL', type: 'url' } }
                    : {} ),
                ...Object.fromEntries(
                    Object.entries( this.collectionEditor?.fields ?? {} )
                        .map( ( [ fieldKey, field ] ) => [ fieldKey, { label: field.label, type: field.type } ] ),
                ),
            };
        },

        get bindOptions ()
        {
            if ( !this.bindable ) { return []; }

            const source = this.bindSourceFields;

            return compatibleFieldKeys( this.field.type, source )
                .map( ( fieldKey ) => ( { key: fieldKey, label: source[ fieldKey ].label } ) );
        },

        get showBindControl ()
        {
            return this.bindable && ( this.isBound || this.bindOptions.length > 0 );
        },

        // Unresolvable inline tokens nag under the field (Mikey's
        // "at on": a silently empty token is the editor lying). No
        // guessing from labels - the nag states what is missing and
        // what this scope actually offers.
        // The inline-token hint speaks this surface's scope: $term on
        // a term template, $entry everywhere entries flow.
        get interpolationHintLine ()
        {
            const example = this.workspace === 'taxonomy' && this.repeatEditor === null
                ? '{{ $term.name }}'
                : '{{ $entry.title }}';

            return tFill( 'interpolationHint', { example } );
        },

        get interpolationProblems ()
        {
            const value = this.value;

            if ( typeof value !== 'string' || !value.includes( '{{' ) ) { return []; }

            const problems = [];
            const shape = /\{\{\s*\$((entry|term|page|site)((?:\.[A-Za-z_][A-Za-z0-9_]*)+))\s*\}\}/g;

            // Inside a repeat's wiring, entry.* means the repeated
            // thing and validates against the SOURCE's fields.
            const inRepeat = this.repeatEditor !== null;
            const onEntryTemplate = inRepeat || ( this.workspace === 'collection' && this.surface === 'template' );
            const onTermTemplate = this.workspace === 'taxonomy' && this.surface === 'template';
            const fields = inRepeat ? this.repeatCollectionFields : ( this.collectionEditor?.fields ?? {} );
            const entryPaths = () => [ 'id', ...Object.keys( fields ) ].map( ( key ) => `$entry.${key}` ).join( ', ' );
            let match;

            while ( ( match = shape.exec( value ) ) !== null )
            {
                const [ , path, root, tail ] = match;
                const segments = tail.slice( 1 ).split( '.' );
                const token = `{{ $${path} }}`;

                if ( root === 'site' ) { continue; }

                if ( root === 'page' )
                {
                    if ( ![ 'title', 'slug' ].includes( segments[ 0 ] ) )
                    {
                        problems.push( tFill( 'interpolationMissingAmong', { token, paths: '$page.title, $page.slug' } ) );
                    }

                    continue;
                }

                if ( root === 'term' )
                {
                    // The wrong root on the RIGHT surface deserves
                    // the fix, not a lecture about surfaces (Mikey's
                    // screenshot: $entry on a term template).
                    if ( !onTermTemplate )
                    {
                        problems.push( onEntryTemplate
                            ? tFill( 'interpolationUseEntry', { token, paths: entryPaths() } )
                            : tFill( 'interpolationNoScope', { token, root: '$term' } ) );
                    }
                    else if ( ![ 'id', 'name', 'description', 'image' ].includes( segments[ 0 ] ) )
                    {
                        problems.push( tFill( 'interpolationMissingAmong', { token, paths: '$term.name, $term.description, $term.image' } ) );
                    }

                    continue;
                }

                if ( !onEntryTemplate )
                {
                    if ( onTermTemplate )
                    {
                        // Suggest the $term twin outright when the
                        // path maps ($entry.title speaks $term.name).
                        const twin = segments[ 0 ] === 'title' ? 'name' : segments[ 0 ];
                        const mapped = [ 'id', 'name', 'description', 'image' ].includes( twin )
                            ? `{{ $term.${[ twin, ...segments.slice( 1 ) ].join( '.' )} }}`
                            : '$term.name, $term.description, $term.image';

                        problems.push( tFill( 'interpolationUseTerm', { token, suggestion: mapped } ) );
                    }
                    else
                    {
                        problems.push( tFill( 'interpolationNoScope', { token, root: '$entry' } ) );
                    }

                    continue;
                }

                const key = segments[ 0 ];

                if ( key !== 'id' && key !== 'url' && fields[ key ] === undefined )
                {
                    problems.push( tFill( 'interpolationMissingAmong', { token, paths: entryPaths() } ) );
                    continue;
                }

                // Deeper segments ride a reference (bind-through);
                // anything deeper on a plain field resolves to nothing.
                if ( segments.length > 1 && fields[ key ]?.type !== 'reference' )
                {
                    problems.push( tFill( 'interpolationNotReference', { token } ) );
                }
            }

            return problems;
        },

        setBinding ( fieldKey )
        {
            this.bindMenuOpen = false;

            if ( fieldKey === '' )
            {
                if ( this.isBound ) { this.value = emptyValueFor( this.field ); }
                return;
            }

            // Repeat wiring always speaks entry.* - the repeated
            // item's scope - whatever workspace the canvas lives in.
            const root = this.repeatEditor !== null ? 'entry' : ( this.workspace === 'taxonomy' ? 'term' : 'entry' );

            this.value = { $bind: `${root}.${fieldKey}` };
        },

        get selectOptions ()
        {
            const options = this.field.options;

            if ( options === undefined ) { return []; }
            if ( options.source === 'static' ) { return options.values.map( ( entry ) => entry.value ); }
            // A dependent select follows its driver field's value, or the
            // driver's default while nothing is set yet - a repeat's wiring
            // starts with no layout chosen, and the style dropdown sat
            // empty (Mikey).
            if ( options.source === 'byField' )
            {
                const chosen = this.target[ options.byField ];
                const key = typeof chosen === 'string' && chosen !== '' ? chosen : this.fields[ options.byField ]?.default;

                return options.map[ key ] ?? [];
            }

            // Token families ride whichever editor hosts this row -
            // a component block's, or a repeat's wiring.
            return ( this.blockEditor ?? this.repeatEditor )?.tokens?.[ options.tokenFamily ] ?? [];
        },

        // A reference field's picker options: the target taxonomy's
        // terms, or the target collection's entries (SCHEMA 13.3 -
        // picked by label, stored by id).
        get referenceSearchable ()
        {
            return !this.referenceMultiple && this.referenceOptions.length > 8;
        },

        // A multiple reference (SCHEMA 13.3): the value is an array
        // of ids, edited as a checklist.
        get referenceMultiple ()
        {
            return this.field.type === 'reference' && this.field.rules?.multiple === true;
        },

        toggleReferenceValue ( id )
        {
            const current = Array.isArray( this.value ) ? [ ...this.value ] : [];
            const at = current.indexOf( id );

            if ( at >= 0 ) { current.splice( at, 1 ); }
            else { current.push( id ); }

            this.value = current;
        },

        get filteredReferenceOptions ()
        {
            const query = this.refQuery.trim().toLowerCase();

            if ( query === '' ) { return this.referenceOptions; }

            return this.referenceOptions.filter( ( option ) => option.name.toLowerCase().includes( query ) );
        },

        get referenceValueLabel ()
        {
            const found = this.referenceOptions.find( ( option ) => option.id === this.value );

            return found === undefined ? '' : found.name.replace( /^(— )+/, '' );
        },

        pickReference ( id )
        {
            this.value = id;
            this.refQuery = '';
            this.refPickerOpen = false;
        },

        // Inline term creation (Mikey's backlog): a reference field
        // targeting a taxonomy can mint the term it is missing
        // without leaving the form. Terms are lightweight; entries
        // are not - collection-targeting references never offer this.
        get referenceTaxonomyFile ()
        {
            return typeof this.field.rules?.taxonomy === 'string' ? `${this.field.rules.taxonomy}.json` : null;
        },

        startNewTerm ()
        {
            this.newTermDraft = '';
            this.$nextTick( () => this.$refs.newTermInput?.focus() );
        },

        async createReferenceTerm ( name )
        {
            const file = this.referenceTaxonomyFile;
            const trimmed = String( name ?? '' ).trim();

            if ( file === null || trimmed === '' ) { return; }

            this.suppressReloadUntil = Date.now() + 1500;

            const response = await fetch( '/api/term', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { file, name: trimmed } ),
            } );

            if ( !response.ok ) { return; }

            const { id } = await response.json();

            // The new term joins the local options immediately; the
            // next collection load reconciles with the server's copy.
            this.collectionEditor?.taxonomies
                ?.find( ( candidate ) => candidate.stem === this.field.rules.taxonomy )
                ?.terms?.push( { id, name: trimmed } );

            if ( this.referenceMultiple ) { this.toggleReferenceValue( id ); }
            else { this.pickReference( id ); }

            this.newTermDraft = null;
        },

        get tFillCreateTerm ()
        {
            return tFill( 'createTermNamed', { name: this.refQuery.trim() } );
        },

        get referenceOptions ()
        {
            if ( typeof this.field.rules?.taxonomy === 'string' )
            {
                const terms = this.collectionEditor?.taxonomies
                    ?.find( ( candidate ) => candidate.stem === this.field.rules.taxonomy )?.terms ?? [];

                // Tree order with depth-indented names, so nesting
                // reads in the picker too.
                return termTree( terms ).map( ( row ) => ( {
                    id: row.term.id,
                    name: `${'— '.repeat( row.depth )}${row.term.name}`,
                } ) );
            }

            const target = this.collectionEditor?.collectionRefs
                ?.find( ( candidate ) => candidate.stem === this.field.rules?.type );

            return ( target?.entries ?? [] ).map( ( entry ) => ( { id: entry.id, name: entry.title } ) );
        },
    } ) );

    Alpine.data( 'repeater', () => ( {
        addItem ()
        {
            const item = {};

            for ( const [ childKey, child ] of Object.entries( this.field.fields ) )
            {
                item[ childKey ] = emptyValueFor( child );
            }

            this.value.push( item );
            this.markDirty();
        },
    } ) );

    Alpine.data( 'repeaterItem', ( index ) => ( {
        index,
        expanded: index === 0,

        get item ()
        {
            return this.value[ this.index ];
        },

        get itemLabel ()
        {
            const first = Object.keys( this.field.fields )[ 0 ];
            const value = this.item[ first ];

            return value === '' || value === undefined ? `${this.index + 1}` : String( value );
        },

        remove ()
        {
            this.value.splice( this.index, 1 );
            this.markDirty();
        },
    } ) );

    // The rule above Site settings is a scroll edge, never decoration
    // (EDITOR section 5): it appears only while the tree overflows.
    Alpine.data( 'navRail', () => ( {
        overflowing: false,

        init ()
        {
            const tree = this.$refs.tree;
            const measure = () =>
            {
                this.overflowing = tree.scrollHeight > tree.clientHeight;
            };

            new ResizeObserver( measure ).observe( tree );
            measure();
        },
    } ) );
} );
