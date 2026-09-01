<script lang="ts">
    import FieldRow from './FieldRow.svelte';
    import { loadManifest, emptyValueFor, type InspectorManifest, type PropsRecord } from './schema.ts';

    let manifest: InspectorManifest | undefined = $state();
    let props: PropsRecord = $state( {} );
    let dirty = $state( 0 );
    let tab: 'content' | 'settings' = $state( 'content' );

    let previewFrame: HTMLIFrameElement | undefined = $state();

    void loadManifest().then( ( loaded ) =>
    {
        const seeded: PropsRecord = structuredClone( loaded.initialProps );

        for ( const [ key, field ] of Object.entries( loaded.fields ) )
        {
            if ( seeded[ key ] === undefined ) { seeded[ key ] = emptyValueFor( field ); }
        }

        props = seeded;
        manifest = loaded;
    } );

    function postPreview ( json: string ): void
    {
        if ( manifest === undefined ) { return; }

        const stamp = performance.now();

        previewFrame?.contentWindow?.postMessage( { props: JSON.parse( json ) as PropsRecord, stamp }, '*' );
    }

    $effect( () =>
    {
        postPreview( JSON.stringify( props ) );
    } );
</script>

<div class="split">
    <div class="inspector">
{#if manifest !== undefined}
        <div>
            <div class="title">{manifest.title}</div>
            <div class="subtitle">{manifest.packageName} / {manifest.id}</div>
        </div>
        <div class="rule"></div>
        <div class="tabs">
            <button type="button" class="tab" class:active={tab === 'content'} onclick={() => { tab = 'content'; }}>Content</button>
            <button type="button" class="tab" class:active={tab === 'settings'} onclick={() => { tab = 'settings'; }}>Settings</button>
        </div>

        {#if tab === 'content'}
            <div class="fields">
                {#each Object.entries( manifest.fields ) as [ key, field ] ( key )}
                    <FieldRow fieldKey={key} field={field} target={props} manifest={manifest} onEdit={() => { dirty += 1; }} />
                {/each}
            </div>
        {/if}

        <div class="output">
            <div class="output-head">
                <span>Written props</span>
                <span class="spacer"></span>
                <span>{dirty} edits</span>
            </div>
            <pre>{JSON.stringify( props, null, 4 )}</pre>
        </div>
{/if}
    </div>
<iframe
    bind:this={previewFrame}
    class="preview"
    src="../../preview/preview.html"
    title="Preview"
    onload={() => postPreview( JSON.stringify( props ) )}
></iframe>
</div>

<style>
    .split {
        display: flex;
        height: 100vh;
    }

    .preview {
        flex: 1;
        height: 100%;
        border: none;
        background: #FFFFFF;
    }

    .inspector {
        width: 340px;
        flex: none;
        height: 100%;
        overflow: auto;
        box-sizing: border-box;
        background: var(--surface);
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .title {
        font-size: 15px;
        font-weight: 600;
    }

    .subtitle {
        margin-top: 2px;
        font-size: 11.5px;
        color: var(--muted);
    }

    .rule {
        border-top: 1px solid var(--rule);
        margin: 0 -18px;
    }

    .tabs {
        display: flex;
        gap: 18px;
        border-bottom: 1px solid var(--hairline);
    }

    .tab {
        border: none;
        background: transparent;
        padding: 0 0 8px;
        font-family: inherit;
        font-size: 12.5px;
        color: var(--muted);
        cursor: pointer;
    }

    .tab.active {
        font-weight: 600;
        color: var(--ink);
        border-bottom: 2px solid var(--amber);
        margin-bottom: -1px;
    }

    .fields {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .output {
        margin-top: 8px;
        border-top: 1px solid var(--hairline);
        padding-top: 12px;
    }

    .output-head {
        display: flex;
        align-items: center;
        margin-bottom: 4px;
        font-size: 11px;
        color: var(--muted);
    }

    .spacer {
        flex: 1;
    }

    pre {
        margin: 0;
        max-height: 192px;
        overflow: auto;
        border-radius: 9px;
        background: var(--well);
        padding: 10px;
        font-size: 10.5px;
        line-height: 1.6;
    }
</style>
