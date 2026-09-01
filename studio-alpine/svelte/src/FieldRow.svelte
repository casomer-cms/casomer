<script lang="ts">
    import FieldRow from './FieldRow.svelte';
    import { evalCondition, emptyValueFor, selectOptionsFor, type InspectorManifest, type NormalizedField, type PropsRecord } from './schema.ts';

    interface Props
    {
        readonly fieldKey: string;
        readonly field: NormalizedField;
        readonly target: PropsRecord;
        readonly manifest: InspectorManifest;
        readonly onEdit: () => void;
    }

    const { fieldKey, field, target, manifest, onEdit }: Props = $props();

    const visible = $derived( field.showWhen === undefined ? true : evalCondition( field.showWhen.source, target ) );
    const selectOptions = $derived( selectOptionsFor( field, target, manifest ) );

    let expanded: boolean[] = $state( [ true ] );

    function items (): PropsRecord[]
    {
        return ( target[ fieldKey ] ?? [] ) as PropsRecord[];
    }

    function set ( value: unknown ): void
    {
        target[ fieldKey ] = value;
        onEdit();
    }

    function addItem (): void
    {
        const item: PropsRecord = {};

        for ( const [ childKey, child ] of Object.entries( field.fields ?? {} ) )
        {
            item[ childKey ] = emptyValueFor( child );
        }

        items().push( item );
        expanded.push( false );
        onEdit();
    }

    function removeItem ( index: number ): void
    {
        items().splice( index, 1 );
        expanded.splice( index, 1 );
        onEdit();
    }

    function itemLabel ( item: PropsRecord, index: number ): string
    {
        const first = Object.keys( field.fields ?? {} )[ 0 ] ?? '';
        const value = item[ first ];

        return value === '' || value === undefined ? `Item ${index + 1}` : String( value );
    }
</script>

{#if visible}
    <div class="row">
        <div class="label-line">
            <label class="label" for={fieldKey}>{field.label}</label>
            {#if field.required}<span class="required">*</span>{/if}
        </div>

        {#if field.type === 'text'}
            <input
                id={fieldKey}
                class="control"
                type="text"
                placeholder={field.placeholder ?? ''}
                value={String( target[ fieldKey ] ?? '' )}
                oninput={( event ) => set( event.currentTarget.value )}
            >
        {:else if field.type === 'markdown' || field.type === 'textarea'}
            <textarea
                id={fieldKey}
                class="control area"
                value={String( target[ fieldKey ] ?? '' )}
                oninput={( event ) => set( event.currentTarget.value )}
            ></textarea>
        {:else if field.type === 'select'}
            <select
                id={fieldKey}
                class="control"
                value={String( target[ fieldKey ] ?? '' )}
                onchange={( event ) => set( event.currentTarget.value )}
            >
                <option value=""></option>
                {#each selectOptions as option ( option )}
                    <option value={option}>{option}</option>
                {/each}
            </select>
        {:else if field.type === 'toggle'}
            <button
                type="button"
                class="toggle"
                class:on={target[ fieldKey ] === true}
                role="switch"
                aria-checked={target[ fieldKey ] === true}
                onclick={() => set( target[ fieldKey ] !== true )}
            >
                <span class="knob"></span>
            </button>
        {:else if field.type === 'image'}
            <div class="plate">
                <svg width="26" height="21" viewBox="0 0 40 32" fill="none" style="opacity: 0.7;"><rect x="1" y="1" width="38" height="30" rx="3" stroke="#CBB57E" stroke-width="2" /><circle cx="12" cy="11" r="3" stroke="#CBB57E" stroke-width="2" /><path d="M6 26l9-9 6 6 5-5 8 8" stroke="#CBB57E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </div>
        {:else if field.type === 'list'}
            <div class="repeater">
                {#each items() as item, index ( index )}
                    <div class="item">
                        <div class="item-head" class:closed={expanded[ index ] !== true}>
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="#A39E8F"><circle cx="3" cy="3" r="1.2" /><circle cx="7" cy="3" r="1.2" /><circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" /><circle cx="3" cy="11" r="1.2" /><circle cx="7" cy="11" r="1.2" /></svg>
                            <span class="item-label">{itemLabel( item, index )}</span>
                            <button type="button" class="quiet" onclick={() => removeItem( index )}>Remove</button>
                            <button type="button" class="quiet" aria-expanded={expanded[ index ] === true} aria-label="Toggle item" onclick={() => { expanded[ index ] = expanded[ index ] !== true; }}>
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" class="chev" class:flipped={expanded[ index ] === true}><path d="M3.5 6L8 10.5L12.5 6" stroke="#8A8677" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                            </button>
                        </div>
                        {#if expanded[ index ] === true}
                            <div class="item-body">
                                {#each Object.entries( field.fields ?? {} ) as [ childKey, child ] ( childKey )}
                                    <FieldRow fieldKey={childKey} field={child} target={item} manifest={manifest} onEdit={onEdit} />
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
                <button type="button" class="add" onclick={addItem}>+ Add item</button>
            </div>
        {/if}

        {#if field.help !== undefined}
            <p class="help">{field.help}</p>
        {/if}
    </div>
{/if}

<style>
    .label-line {
        display: flex;
        align-items: center;
        margin-bottom: 5px;
    }

    .label {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--text2);
    }

    .required {
        margin-left: 4px;
        font-size: 11.5px;
        color: var(--amber-text);
    }

    .control {
        width: 100%;
        height: 32px;
        border: 1px solid var(--border-std);
        border-radius: 9px;
        background: var(--input);
        padding: 0 10px;
        font-family: inherit;
        font-size: 12.5px;
        color: var(--ink);
    }

    .control.area {
        min-height: 64px;
        height: auto;
        padding: 10px;
    }

    .toggle {
        position: relative;
        width: 32px;
        height: 18px;
        border: none;
        border-radius: 9px;
        background: var(--rule);
        padding: 0;
        cursor: pointer;
    }

    .toggle.on {
        background: var(--amber);
    }

    .knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 7px;
        background: var(--surface);
        box-shadow: 0 1px 2px rgba(26, 29, 40, 0.15);
        transition: left 120ms cubic-bezier(0.2, 0, 0, 1);
    }

    .toggle.on .knob {
        left: 16px;
    }

    .plate {
        height: 64px;
        border-radius: 9px;
        background: var(--plate);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .repeater {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .item {
        border: 1px solid var(--hairline);
        border-radius: 9px;
    }

    .item-head {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--well);
        border-radius: 9px 9px 0 0;
        padding: 6px 10px;
    }

    .item-head.closed {
        border-radius: 9px;
    }

    .item-label {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 10px;
    }

    .quiet {
        border: none;
        background: transparent;
        padding: 0;
        font-family: inherit;
        font-size: 11px;
        color: var(--muted);
        cursor: pointer;
        display: flex;
        align-items: center;
    }

    .chev {
        transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
    }

    .chev.flipped {
        transform: rotate(180deg);
    }

    .add {
        align-self: flex-start;
        border: none;
        background: transparent;
        padding: 0;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        color: var(--amber-deep);
        cursor: pointer;
    }

    .help {
        margin: 4px 0 0;
        font-size: 11px;
        line-height: 1.6;
        color: var(--muted);
    }
</style>
