// The Alpine lane, played to its strengths: no build step, plain ES
// modules, components as named templates stamped by a small
// x-component directive, logic in Alpine.data factories (never inline
// blobs), Tailwind for styling. This file is everything the lane
// needs beyond Alpine itself.

// A minimal showWhen evaluator for the manifest's condition sources
// (the real inspector shares the schema module's evaluator; both
// lanes carry this same stand-in so neither pays for it).
function evalCondition ( source, values )
{
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*"([^"]*)"$/.exec( source.trim() );

    if ( match === null ) { return true; }

    const [ , key, operator, literal ] = match;
    const actual = values[ key ];

    return operator === '==' ? actual === literal : actual !== literal;
}

function emptyValueFor ( field )
{
    if ( field.defaultValue !== undefined ) { return structuredClone( field.defaultValue ); }

    switch ( field.type )
    {
        case 'toggle': return false;
        case 'list': return [];
        case 'image': return null;
        default: return '';
    }
}

// Latency capture for the bake-off probes: the preview acks each
// posted stamp, and the delta is the full edit-to-morph round trip.
window.__previewLatencies = [];
window.__firstAckAt = undefined;
window.addEventListener( 'message', ( event ) =>
{
    if ( typeof event.data?.ack === 'number' )
    {
        window.__firstAckAt = window.__firstAckAt ?? performance.now();
        window.__previewLatencies.push( performance.now() - event.data.ack );
    }
} );

document.addEventListener( 'alpine:init', () =>
{
    const Alpine = window.Alpine;

    // x-component="template-id": stamp a named template's content into
    // the element. Children inherit the element's scope chain, so
    // props travel via x-data on the same element. This tiny renderer
    // is the price of components in Alpine; libraries exist, but they
    // are this, packaged.
    Alpine.directive( 'component', ( el, { expression } ) =>
    {
        if ( el.__casomerStamped === true ) { return; }

        el.__casomerStamped = true;

        const template = document.getElementById( expression );
        const content = template.content.cloneNode( true );

        // Children appended while Alpine walks this element are not
        // walked themselves: stamp after the current pass settles and
        // initialize each child against the inherited scope chain.
        queueMicrotask( () =>
        {
            el.append( content );

            for ( const child of el.children ) { Alpine.initTree( child ); }
        } );
    } );

    Alpine.data( 'inspector', () => ( {
        manifest: null,
        props: {},
        dirty: 0,
        tab: 'content',

        async init ()
        {
            const response = await fetch( '../manifest.json' );

            // Clone from the raw payload BEFORE anything becomes an
            // Alpine proxy: structuredClone cannot clone a proxy.
            const loaded = await response.json();
            const seeded = structuredClone( loaded.initialProps );

            for ( const [ key, field ] of Object.entries( loaded.fields ) )
            {
                if ( seeded[ key ] === undefined ) { seeded[ key ] = emptyValueFor( field ); }
            }

            this.props = seeded;
            this.manifest = loaded;
        },

        get fieldKeys ()
        {
            return Object.keys( this.manifest?.fields ?? {} );
        },

        json ()
        {
            return JSON.stringify( this.props, null, 4 );
        },

        postPreview ( json )
        {
            if ( this.manifest === null ) { return; }

            const stamp = performance.now();

            this.$refs.preview?.contentWindow?.postMessage( { props: JSON.parse( json ), stamp }, '*' );
        },
    } ) );

    // One field row's scope: the field definition, its target record
    // (the page props, or a repeater item), and everything the row's
    // template needs. Reused at both depths, which is what makes the
    // repeater recursion work.
    Alpine.data( 'fieldCtx', function ( key, fields, target )
    {
        return {
            key,
            fields,
            target,

            get field ()
            {
                return this.fields[ key ];
            },

            get visible ()
            {
                const condition = this.field.showWhen;

                return condition === undefined ? true : evalCondition( condition.source, this.target );
            },

            get value ()
            {
                return this.target[ key ];
            },

            set value ( next )
            {
                this.target[ key ] = next;
                this.dirty += 1;
            },

            get selectOptions ()
            {
                const options = this.field.options;

                if ( options === undefined ) { return []; }
                if ( options.source === 'static' ) { return options.values.map( ( entry ) => entry.value ); }
                if ( options.source === 'byField' ) { return options.map[ this.target[ options.byField ] ] ?? []; }

                return Object.keys( this.manifest.tokens[ options.tokenFamily ] ?? {} );
            },
        };
    } );

    // A repeater item's scope: collapse state plus removal.
    Alpine.data( 'repeaterItem', function ( index )
    {
        return {
            index,
            expanded: index === 0,

            get item ()
            {
                return this.value[ index ];
            },

            get itemLabel ()
            {
                const first = Object.keys( this.field.fields )[ 0 ];

                return this.item[ first ] === '' || this.item[ first ] === undefined ? `Item ${index + 1}` : String( this.item[ first ] );
            },

            remove ()
            {
                this.value.splice( index, 1 );
                this.dirty += 1;
            },
        };
    } );

    Alpine.data( 'repeater', function ()
    {
        return {
            addItem ()
            {
                const item = {};

                for ( const [ childKey, child ] of Object.entries( this.field.fields ) )
                {
                    item[ childKey ] = emptyValueFor( child );
                }

                this.value.push( item );
                this.dirty += 1;
            },
        };
    } );
} );
