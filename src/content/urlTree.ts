// The URL tree (SCHEMA 13.6): one tree of public addresses. A page's
// path is its ancestors' slugs plus its own; a mounted collection's
// path is its parent page's path plus its stem. Home is the root and
// contributes no segment. Draft cascades down the tree: a node under
// a draft ancestor is as unpublished as the ancestor itself. Every
// walk guards against cycles so a broken document degrades to issues,
// never to a hang.

export interface TreePage
{
    readonly id: string;
    readonly slug: string;
    readonly parent?: string;
    readonly draft?: boolean;
}

function ancestorChain ( page: TreePage, pagesById: ReadonlyMap<string, TreePage> ): TreePage[]
{
    const chain: TreePage[] = [];
    const visited = new Set<string>();
    let current: TreePage | undefined = page;

    while ( current !== undefined && !visited.has( current.id ) )
    {
        visited.add( current.id );
        chain.unshift( current );
        current = current.parent === undefined ? undefined : pagesById.get( current.parent );
    }

    return chain;
}

// Home emits at the root; every other page at its slug chain.
export function pagePathSegments ( page: TreePage, pagesById: ReadonlyMap<string, TreePage> ): string[]
{
    if ( page.slug === 'home' ) { return []; }

    return ancestorChain( page, pagesById ).map( ( ancestor ) => ancestor.slug );
}

export function pageIsDraft ( page: TreePage, pagesById: ReadonlyMap<string, TreePage> ): boolean
{
    return ancestorChain( page, pagesById ).some( ( ancestor ) => ancestor.draft === true );
}

// A collection's mount point: its parent page's segments, or the root
// when unmounted. A dangling parent mounts nowhere and falls back to
// the root - the loader reports it; emission stays deterministic.
export function collectionPathSegments (
    parent: string | undefined,
    pagesById: ReadonlyMap<string, TreePage>,
): string[]
{
    const page = parent === undefined ? undefined : pagesById.get( parent );

    return page === undefined ? [] : pagePathSegments( page, pagesById );
}

export function collectionIsDraft (
    parent: string | undefined,
    pagesById: ReadonlyMap<string, TreePage>,
): boolean
{
    const page = parent === undefined ? undefined : pagesById.get( parent );

    return page === undefined ? false : pageIsDraft( page, pagesById );
}

// Menus resolve to nested { label, url, items } trees at render time
// (SCHEMA 12.5). A page item derives its URL from the tree and its
// label from the title, and is omitted - subtree and all - while the
// page is draft (or under a draft ancestor): the
// everywhere-referenced promise. Collection and taxonomy items point
// at public indexes and are omitted while the target is fully
// private ("index": false) or draft-mounted, same as drafts. Literal
// items pass through; a group (label only) carries its resolved
// children and is omitted when none survive - a dropdown with
// nothing in it is not navigation. "topLevelPages" appends the
// site's top-level pages not already referenced anywhere in the
// menu, in the site's page order.

export interface ResolvedMenuItem
{
    readonly label: string;
    readonly url?: string;
    readonly items?: readonly ResolvedMenuItem[];
}

interface MenuItemLike
{
    readonly page?: string;
    readonly collection?: string;
    readonly taxonomy?: string;
    readonly label?: string;
    readonly url?: string;
    readonly items?: readonly MenuItemLike[];
    readonly auto?: string;
}

// The structural slice of a loaded collection or taxonomy that menu
// resolution needs; LoadedCollection and LoadedTaxonomy both fit.
export interface MenuTargetDoc
{
    readonly file: string;
    readonly label: string;
    readonly parent?: string;
    readonly indexBlocks?: readonly unknown[] | false;
}

interface MenuRecordLike
{
    readonly topLevelPages?: boolean;
    readonly childPages?: boolean;
    readonly collectionIndexes?: boolean;
    readonly taxonomyIndexes?: boolean;
    readonly items: readonly MenuItemLike[];
}

// The auto-include rules materialized (SCHEMA 12.5): the same logic
// Studio uses to add reorderable rows, applied at resolution so a
// site edited outside Studio still gets every rule's items. Items
// already referenced anywhere in the menu are never doubled.
export function materializeMenu (
    record: MenuRecordLike,
    pages: readonly ( TreePage & { readonly title?: string } )[],
    collections: readonly MenuTargetDoc[],
    taxonomies: readonly MenuTargetDoc[],
): MenuItemLike[]
{
    const index = pagesById( pages );
    const referencedPages = new Set<string>();
    const referencedCollections = new Set<string>();
    const referencedTaxonomies = new Set<string>();
    const collect = ( items: readonly MenuItemLike[] ): void =>
    {
        for ( const item of items )
        {
            if ( item.page !== undefined ) { referencedPages.add( item.page ); }
            if ( item.collection !== undefined ) { referencedCollections.add( item.collection ); }
            if ( item.taxonomy !== undefined ) { referencedTaxonomies.add( item.taxonomy ); }
            if ( item.items !== undefined ) { collect( item.items ); }
        }
    };

    collect( record.items );

    // Deep-clone so the caller's record is never mutated.
    const items: ( MenuItemLike & { items?: MenuItemLike[] } )[] = JSON.parse( JSON.stringify( record.items ) );

    if ( record.childPages === true )
    {
        for ( const item of items )
        {
            if ( item.page === undefined ) { continue; }

            for ( const page of pages )
            {
                if ( page.parent !== item.page || referencedPages.has( page.id ) || pageIsDraft( page, index ) ) { continue; }

                item.items = [ ...( item.items ?? [] ), { page: page.id, auto: 'childPages' } ];
                referencedPages.add( page.id );
            }
        }
    }

    if ( record.topLevelPages === true )
    {
        for ( const page of pages )
        {
            if ( page.parent !== undefined || page.slug === '404' || referencedPages.has( page.id ) || pageIsDraft( page, index ) ) { continue; }

            items.push( { page: page.id, auto: 'topLevelPages' } );
            referencedPages.add( page.id );
        }
    }

    if ( record.collectionIndexes === true )
    {
        for ( const doc of collections )
        {
            const stem = doc.file.replace( /\.json$/, '' );

            if ( referencedCollections.has( stem ) || doc.indexBlocks === false || collectionIsDraft( doc.parent, index ) ) { continue; }

            items.push( { collection: stem, auto: 'collectionIndexes' } );
            referencedCollections.add( stem );
        }
    }

    if ( record.taxonomyIndexes === true )
    {
        for ( const doc of taxonomies )
        {
            const stem = doc.file.replace( /\.json$/, '' );

            if ( referencedTaxonomies.has( stem ) || doc.indexBlocks === false ) { continue; }

            items.push( { taxonomy: stem, auto: 'taxonomyIndexes' } );
            referencedTaxonomies.add( stem );
        }
    }

    return items;
}

export function resolveMenus (
    menus: Readonly<Record<string, MenuRecordLike | readonly MenuItemLike[]>> | undefined,
    pages: readonly ( TreePage & { readonly title?: string } )[],
    collections: readonly MenuTargetDoc[] = [],
    taxonomies: readonly MenuTargetDoc[] = [],
): Record<string, ResolvedMenuItem[]>
{
    const index = pagesById( pages );
    const resolved: Record<string, ResolvedMenuItem[]> = {};

    const resolveItem = ( item: MenuItemLike ): ResolvedMenuItem | null =>
    {
        const children = ( item.items ?? [] )
            .map( resolveItem )
            .filter( ( child ): child is ResolvedMenuItem => child !== null );
        const withChildren = children.length === 0 ? {} : { items: children };

        if ( item.page !== undefined )
        {
            const page = index.get( item.page ) as ( TreePage & { title?: string } ) | undefined;

            if ( page === undefined || pageIsDraft( page, index ) ) { return null; }

            // A materialized auto item drops silently when its target
            // stops qualifying for its rule - machine bookkeeping,
            // never an authoring error.
            if ( item.auto === 'topLevelPages' && page.parent !== undefined ) { return null; }

            const segments = pagePathSegments( page, index );

            return {
                label: item.label ?? page.title ?? page.slug,
                url: segments.length === 0 ? '/' : `/${segments.join( '/' )}/`,
                ...withChildren,
            };
        }

        if ( item.collection !== undefined )
        {
            const doc = collections.find( ( candidate ) => candidate.file === `${item.collection ?? ''}.json` );

            if ( doc === undefined || doc.indexBlocks === false || collectionIsDraft( doc.parent, index ) ) { return null; }

            const segments = [ ...collectionPathSegments( doc.parent, index ), item.collection ];

            return { label: item.label ?? doc.label, url: `/${segments.join( '/' )}/`, ...withChildren };
        }

        if ( item.taxonomy !== undefined )
        {
            const doc = taxonomies.find( ( candidate ) => candidate.file === `${item.taxonomy ?? ''}.json` );

            if ( doc === undefined || doc.indexBlocks === false ) { return null; }

            return { label: item.label ?? doc.label, url: `/${item.taxonomy}/`, ...withChildren };
        }

        if ( item.url !== undefined )
        {
            return { label: item.label ?? item.url, url: item.url, ...withChildren };
        }

        if ( children.length === 0 ) { return null; }

        return { label: item.label ?? '', items: children };
    };

    for ( const [ name, menu ] of Object.entries( menus ?? {} ) )
    {
        // Array.isArray does not narrow ReadonlyArray unions, so the
        // false branch keeps the array member and needs the cast.
        const record: MenuRecordLike = Array.isArray( menu )
            ? { items: menu as readonly MenuItemLike[] }
            : menu as MenuRecordLike;

        resolved[ name ] = materializeMenu( record, pages, collections, taxonomies )
            .map( resolveItem )
            .filter( ( item ): item is ResolvedMenuItem => item !== null );
    }

    return resolved;
}

export function pagesById ( pages: readonly TreePage[] ): ReadonlyMap<string, TreePage>
{
    return new Map( pages.map( ( page ) => [ page.id, page ] ) );
}

// Every public entry page's address, keyed by entry id: the entry's
// INHERENT url (Mikey - "collection entries have a url inherently"),
// offered to binds, wiring, and inline tokens as entry.url. Computed
// with exactly emission's skip rules and slug order, so a bound URL
// always matches the page the build writes; an entry that emits no
// page has no address here.
export interface EntryUrlCollection
{
    readonly file: string;
    readonly parent?: string;
    readonly indexBlocks?: readonly unknown[] | false;
    readonly templateBlocks?: readonly unknown[];
    readonly entries: readonly {
        readonly id: string;
        readonly draft?: boolean;
        readonly blocks?: readonly unknown[];
        readonly values: Readonly<Record<string, unknown>>;
    }[];
}

export function resolveEntryUrls (
    pages: readonly TreePage[],
    collections: readonly EntryUrlCollection[],
): Record<string, string>
{
    const index = pagesById( pages );
    const pagePaths = new Set( pages.map( ( page ) => pagePathSegments( page, index ).join( '/' ) ) );
    const urls: Record<string, string> = {};

    for ( const collection of collections )
    {
        const stem = collection.file.replace( /\.json$/, '' );

        if ( collectionIsDraft( collection.parent, index ) || collection.indexBlocks === false ) { continue; }

        const address = [ ...collectionPathSegments( collection.parent, index ), stem ].join( '/' );

        if ( pagePaths.has( address ) ) { continue; }

        const taken = new Set<string>();

        for ( const entry of collection.entries )
        {
            if ( entry.draft === true ) { continue; }
            if ( entry.blocks === undefined && collection.templateBlocks === undefined ) { continue; }

            urls[ entry.id ] = `/${address}/${entrySlug( entry.values.title, entry.id, taken )}/`;
        }
    }

    return urls;
}

// Entry and term pages get their public spelling from the title, with
// the id's first segment as the fallback and a numeric suffix on
// collisions - slugs are the public spelling, ids are plumbing (13.2).
export function entrySlug ( title: unknown, id: string, taken: Set<string> ): string
{
    const base = String( title ?? '' )
        .toLowerCase()
        .replace( /[^a-z0-9]+/g, '-' )
        .replace( /^-+|-+$/g, '' )
        || id.slice( 0, 8 );

    let slug = base;
    let suffix = 2;

    while ( taken.has( slug ) )
    {
        slug = `${base}-${suffix}`;
        suffix += 1;
    }

    taken.add( slug );
    return slug;
}
