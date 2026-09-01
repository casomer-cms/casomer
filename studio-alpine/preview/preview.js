// The canvas side of the loop, identical for both chrome lanes: props
// arrive by message, the product engine renders, morph merges the
// result into the live tree so Alpine state (the card's open toggle)
// survives the update. This file IS the answer to "how well does
// Alpine run the in-window preview": the preview is always Alpine.

import { renderCard, morphPlugin } from '../engine/dist/engine.js';

document.addEventListener( 'alpine:init', () =>
{
    window.Alpine.plugin( morphPlugin );
} );

const target = document.getElementById( 'canvas' );

window.addEventListener( 'message', ( event ) =>
{
    const { props, stamp } = event.data;
    const html = renderCard( props );

    if ( target.firstElementChild === null )
    {
        target.innerHTML = html;

        if ( window.Alpine !== undefined ) { window.Alpine.initTree( target ); }
    }
    else
    {
        window.Alpine.morph( target.firstElementChild, html );
    }

    event.source.postMessage( { ack: stamp, at: performance.now() }, '*' );
} );
