import { mount } from 'svelte';

import Inspector from './Inspector.svelte';
import './app.css';

// Latency capture for the bake-off probes, identical to the Alpine
// lane: the preview acks each posted stamp.
declare global
{
    interface Window { __previewLatencies: number[]; __firstAckAt: number | undefined }
}

window.__previewLatencies = [];
window.__firstAckAt = undefined;
window.addEventListener( 'message', ( event ) =>
{
    const data = event.data as { ack?: number };

    if ( typeof data?.ack === 'number' )
    {
        window.__firstAckAt = window.__firstAckAt ?? performance.now();
        window.__previewLatencies.push( performance.now() - data.ack );
    }
} );

mount( Inspector, { target: document.getElementById( 'app' ) as HTMLElement } );
