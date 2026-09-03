import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { startStudioServer, type StudioServer } from './server.ts';
import { loadPackageFromDirectory } from '../schema/loadPackage.ts';
import { parseJsonDocument, serializeCanonicalJson } from '../content/canonicalJson.ts';
import { findOrCreateRepository, runGit } from '../git/repository.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

describe( 'the studio server', () =>
{
    let server: StudioServer;
    let base: string;

    before( async () =>
    {
        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory: join( fixtureRoot, 'content' ),
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'refuses every request without the session token', async () =>
    {
        assert.equal( ( await fetch( `${base}/` ) ).status, 401 );
        assert.equal( ( await fetch( `${base}/api/site` ) ).status, 401 );
        assert.equal( ( await fetch( `${base}/canvas/home` ) ).status, 401 );
        assert.equal( ( await fetch( `${base}/?t=wrong-token` ) ).status, 401 );
    } );

    it( 'accepts the token in the query and hands back a session cookie', async () =>
    {
        const response = await fetch( `${base}/?t=${server.token}` );

        assert.equal( response.status, 200 );
        assert.match( response.headers.get( 'set-cookie' ) ?? '', /casomer_studio_token=.+HttpOnly/ );
    } );

    it( 'accepts the session cookie without the query token', async () =>
    {
        const response = await fetch( `${base}/api/site`, {
            headers: { cookie: `casomer_studio_token=${server.token}` },
        } );

        assert.equal( response.status, 200 );
    } );

    it( 'serves the site over the API: project name from the site directory, pages, zero issues', async () =>
    {
        const response = await fetch( `${base}/api/site?t=${server.token}` );
        const body = await response.json() as { projectName: string; pages: { title: string; slug: string }[]; issues: unknown[] };

        assert.equal( body.projectName, 'site-basic' );
        assert.deepEqual( body.issues, [] );
        // The fixture's two pages plus the reserved 404 the loader
        // synthesizes (SCHEMA 13.6), pinned last.
        assert.equal( body.pages.length, 3 );
        assert.equal( body.pages[ 2 ]?.slug, '404' );
        assert.equal( typeof body.pages[ 0 ]?.title, 'string' );
    } );

    it( 'lists collections and taxonomies for the navigator', async () =>
    {
        const response = await fetch( `${base}/api/site?t=${server.token}` );
        const body = await response.json() as { collections: { label: string; entryCount: number }[] };

        assert.equal( body.collections[ 0 ]?.label, 'Events' );
        assert.equal( body.collections[ 0 ]?.entryCount, 2 );
    } );

    it( 'renders a page preview through the shared assemble path', async () =>
    {
        const response = await fetch( `${base}/canvas/home?t=${server.token}` );
        const html = await response.text();

        assert.equal( response.status, 200 );
        assert.match( html, /<main/ );
        assert.match( html, /assets\/css\/main.css/ );
    } );

    it( 'stamps block markers and the editing bridge into previews only', async () =>
    {
        const html = await ( await fetch( `${base}/canvas/home?t=${server.token}` ) ).text();

        assert.match( html, /data-casomer-block="blocks\[0\]"/ );
        assert.match( html, /data-casomer-block="blocks\[1\]\.blocks\[0\]"/ );
        assert.match( html, /preview-bridge\.js/ );
    } );

    it( 'serves the pure preview with neither markers nor bridge', async () =>
    {
        const html = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.match( html, /<main/ );
        assert.doesNotMatch( html, /data-casomer-block/ );
        assert.doesNotMatch( html, /preview-bridge/ );
    } );

    it( 'refuses to save a version when the folder is not its own repository', async () =>
    {
        const response = await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } );

        assert.equal( response.status, 409 );
    } );

    it( 'summarizes the block tree for the chrome, titled from manifests', async () =>
    {
        const response = await fetch( `${base}/api/site?t=${server.token}` );
        const body = await response.json() as {
            pages: { blocks: { kind: string; title?: string; children?: { title?: string }[] }[] }[];
        };
        const kinds = body.pages[ 0 ]?.blocks.map( ( block ) => block.kind );

        assert.ok( kinds !== undefined && kinds.length > 0 );
        assert.ok( body.pages.some( ( page ) => page.blocks.some( ( block ) => block.title === 'Card' ) ) );
        assert.ok(
            body.pages.some( ( page ) => page.blocks.some(
                ( block ) => block.kind === 'section' && ( block.children?.length ?? 0 ) > 0,
            ) ),
            'sections carry their child summaries',
        );
    } );

    it( 'answers an unknown address with a REAL 404, never a crash', async () =>
    {
        // No 404 page authored yet: the preview's plain not-found
        // page, with an honest 404 status (Mikey: handle 404s better).
        const response = await fetch( `${base}/preview/no-such-page?t=${server.token}` );

        assert.equal( response.status, 404 );
        assert.match( await response.text(), /Nothing is published at/ );

        const canvas = await fetch( `${base}/canvas/no-such-page?t=${server.token}` );

        assert.match( await canvas.text(), /No page has the slug/ );

        // With an authored 404 page (the reserved page, still reachable
        // under the old surface name), the visitor sees THAT - still
        // status 404 - exactly as hosting will serve /404.html.
        // This suite runs on the tracked fixture: the 404 page
        // materializes into pages.json on the write below (SCHEMA
        // 13.6), so both files are put back at the end.
        const pagesFile = join( fixtureRoot, 'content', 'pages.json' );
        const siteFile = join( fixtureRoot, 'content', 'site.json' );
        const pagesBefore = await readFile( pagesFile, 'utf8' );
        const siteBefore = await readFile( siteFile, 'utf8' );

        const inserted = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                region: 'notFound',
                container: '',
                index: 0,
                block: { component: 'core/markdown', props: { content: '# Lost?', width: 'prose' } },
            } ),
        } );

        assert.equal( inserted.status, 200 );

        const authored = await fetch( `${base}/preview/no-such-page?t=${server.token}` );

        assert.equal( authored.status, 404 );
        assert.match( await authored.text(), /Lost\?/ );

        // The editing canvas for the surface renders with the bridge.
        const editing = await fetch( `${base}/preview-404?t=${server.token}` );

        assert.match( await editing.text(), /Lost\?[\s\S]*preview-bridge/ );

        // Cleanup.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { region: 'notFound', path: 'blocks[0]' } ),
        } );
        await writeFile( pagesFile, pagesBefore, 'utf8' );
        await writeFile( siteFile, siteBefore, 'utf8' );
    } );

    it( 'serves the delivered-site scripts the preview references', async () =>
    {
        const alpine = await fetch( `${base}/assets/js/alpine.min.js?t=${server.token}` );
        const runtime = await fetch( `${base}/assets/js/casomer-runtime.js?t=${server.token}` );

        assert.equal( alpine.status, 200 );
        assert.equal( runtime.status, 200 );
        assert.match( await runtime.text(), /casomer/i );
    } );

    it( 'opens the change feed as an event stream', async () =>
    {
        const controller = new AbortController();
        const response = await fetch( `${base}/api/events?t=${server.token}`, { signal: controller.signal } );

        assert.equal( response.status, 200 );
        assert.match( response.headers.get( 'content-type' ) ?? '', /text\/event-stream/ );
        controller.abort();
    } );

    it( 'never serves files outside the assets directory', async () =>
    {
        const response = await fetch( `${base}/..%2F..%2Fpackage.json?t=${server.token}` );

        assert.notEqual( response.status, 200 );
    } );

    it( 'answers with an honest page when the chrome is not built', async () =>
    {
        const response = await fetch( `${base}/?t=${server.token}` );

        assert.match( await response.text(), /not built/ );
    } );
} );

describe( 'block editing over the studio API', () =>
{
    let server: StudioServer;
    let base: string;
    let contentDirectory: string;
    let homePageId: string;

    before( async () =>
    {
        contentDirectory = await mkdtemp( join( tmpdir(), 'casomer-studio-edit-' ) );
        await cp( join( fixtureRoot, 'content' ), contentDirectory, { recursive: true } );

        const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

        server = await startStudioServer( {
            contentDirectory,
            assetsDirectory: join( fixtureRoot, 'no-such-assets' ),
            packages: loadedPackage === undefined ? [] : [ loadedPackage ],
        }, 0 );
        base = `http://127.0.0.1:${server.port}`;

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };

        homePageId = site.pages.find( ( page ) => page.slug === 'home' )?.id ?? '';
    } );

    after( async () =>
    {
        await server.close();
    } );

    it( 'serves a component block: manifest fields, current props, token families', async () =>
    {
        const query = new URLSearchParams( { page: homePageId, path: 'blocks[0]', t: server.token } );
        const body = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as {
            title: string;
            fields: Record<string, { type: string }>;
            props: Record<string, unknown>;
            tokens: Record<string, string[]>;
        };

        assert.equal( body.title, 'Card' );
        assert.equal( body.fields.title?.type, 'text' );
        assert.equal( body.fields.faqs?.type, 'list' );
        assert.ok( body.tokens.widths?.includes( 'prose' ) );
        assert.equal( typeof body.props.title, 'string' );
    } );

    it( 'writes props back canonically and the site still validates', async () =>
    {
        const query = new URLSearchParams( { page: homePageId, path: 'blocks[0]', t: server.token } );
        const before = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: Record<string, unknown> };
        const put = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { pageId: homePageId, path: 'blocks[0]', props: { ...before.props, title: 'Edited by the inspector' } } ),
        } );

        assert.equal( put.status, 200 );

        const written = await readFile( join( contentDirectory, 'pages.json' ), 'utf8' );

        assert.equal( written, serializeCanonicalJson( parseJsonDocument( written ) ), 'the write is canonical byte for byte' );

        const again = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: Record<string, unknown> };

        assert.equal( again.props.title, 'Edited by the inspector' );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );
    } );

    it( 'refuses a write that names no component block', async () =>
    {
        const put = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { pageId: homePageId, path: 'blocks[99]', props: {} } ),
        } );

        assert.equal( put.status, 400 );
    } );

    it( 'saves a version: a commit exists, and a clean save says so', async () =>
    {
        await findOrCreateRepository( contentDirectory );
        await runGit( contentDirectory, [ 'config', 'user.name', 'Studio Test' ] );
        await runGit( contentDirectory, [ 'config', 'user.email', 'studio@test.invalid' ] );

        // The product convention caso init writes: canonical documents
        // stay byte-stable through git regardless of platform eol.
        await writeFile( join( contentDirectory, '.gitattributes' ), '* text=auto eol=lf\n', 'utf8' );

        const first = await ( await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } ) ).json() as { saved: boolean };

        assert.equal( first.saved, true );

        const log = await runGit( contentDirectory, [ 'log', '-1', '--pretty=%s' ] );

        assert.equal( log.stdout.trim(), 'casomer: save' );

        const second = await ( await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } ) ).json() as { saved: boolean; clean?: boolean };

        assert.equal( second.saved, false );
        assert.equal( second.clean, true );
    } );

    it( 'publishes: build, one reviewable commit, no push without a remote', async () =>
    {
        const response = await fetch( `${base}/api/publish?t=${server.token}`, { method: 'POST' } );
        const body = await response.json() as { published: boolean; pages: number };

        assert.equal( response.status, 200 );
        assert.equal( body.published, true );
        assert.equal( body.pages, 5 );

        const log = await runGit( contentDirectory, [ 'log', '-1', '--pretty=%s' ] );

        assert.equal( log.stdout.trim(), 'casomer: publish 5 pages' );

        const built = await readFile( join( contentDirectory, 'dist', 'index.html' ), 'utf8' );

        assert.match( built, /<main/ );
    } );

    it( 'steps the edit journal back and forward, across what a browser restart would forget', async () =>
    {
        const query = new URLSearchParams( { page: homePageId, path: 'blocks[0]', t: server.token } );
        const readTitle = async () =>
        {
            const body = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { title?: string } };

            return body.props.title;
        };
        const put = async ( title: string ) =>
        {
            const before = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: Record<string, unknown> };

            await fetch( `${base}/api/block?t=${server.token}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( { pageId: homePageId, path: 'blocks[0]', props: { ...before.props, title } } ),
            } );
        };
        const step = async ( direction: string ) =>
            await ( await fetch( `${base}/api/${direction}?t=${server.token}`, { method: 'POST' } ) ).json() as { stepped: boolean };

        await put( 'Journal step one' );
        await put( 'Journal step two' );

        assert.equal( ( await step( 'undo' ) ).stepped, true );
        assert.equal( await readTitle(), 'Journal step one' );

        assert.equal( ( await step( 'undo' ) ).stepped, true );
        assert.equal( await readTitle(), 'Edited by the inspector' );

        assert.equal( ( await step( 'redo' ) ).stepped, true );
        assert.equal( await readTitle(), 'Journal step one' );

        // The journal is plumbing, not history: the visible log still
        // ends at the publish.
        const log = await runGit( contentDirectory, [ 'log', '-1', '--pretty=%s' ] );

        assert.equal( log.stdout.trim(), 'casomer: publish 5 pages' );
    } );

    it( 'survives a spammed undo and redo burst without losing steps', async () =>
    {
        const query = new URLSearchParams( { page: homePageId, path: 'blocks[0]', t: server.token } );
        const readTitle = async () =>
        {
            const body = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { title?: string } };

            return body.props.title;
        };
        const burst = async ( direction: string, count: number ) =>
        {
            const results = await Promise.all( Array.from( { length: count }, () =>
                fetch( `${base}/api/${direction}?t=${server.token}`, { method: 'POST' } )
                    .then( async ( r ) => await r.json() as { stepped: boolean } ) ) );

            return results.filter( ( r ) => r.stepped ).length;
        };

        // The journal was born when the save test created the repo, so
        // its floor is the state just before "Journal step one" - and
        // the prior test's redo left the cursor one step up from it.
        // The burst must land exactly on the floor and the tip, each
        // step counted once, never lost to interleaving.
        const undone = await burst( 'undo', 6 );

        assert.equal( await readTitle(), 'Edited by the inspector' );
        assert.equal( undone, 1 );

        const redone = await burst( 'redo', 6 );

        assert.equal( await readTitle(), 'Journal step two' );
        assert.equal( redone, 2 );
    } );

    it( 'tells status truthfully, discards to the last save, and the discard is undoable', async () =>
    {
        const query = new URLSearchParams( { page: homePageId, path: 'blocks[0]', t: server.token } );
        const readTitle = async () =>
        {
            const body = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { title?: string } };

            return body.props.title;
        };
        const status = async () =>
            ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { status: string } ).status;

        // The journal tests left the working tree dirty against HEAD.
        assert.equal( await status(), 'unsaved' );

        const discard = await fetch( `${base}/api/discard?t=${server.token}`, { method: 'POST' } );

        assert.equal( discard.status, 200 );
        assert.equal( await readTitle(), 'Edited by the inspector' );
        assert.equal( await status(), 'published' );

        // The discard was journaled: one undo brings the edits back.
        const undo = await ( await fetch( `${base}/api/undo?t=${server.token}`, { method: 'POST' } ) ).json() as { stepped: boolean };

        assert.equal( undo.stepped, true );
        assert.equal( await readTitle(), 'Journal step two' );
        assert.equal( await status(), 'unsaved' );
    } );

    it( 'names the changed documents per file, and per page inside pages.json', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        // A save first: the prior tests leave the tree dirty, and this
        // test speaks from a known-clean baseline.
        await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } );

        const clean = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; changedPageIds: string[];
        };

        assert.deepEqual( clean.changedFiles, [] );
        assert.deepEqual( clean.changedPageIds, [] );

        const entry = await post( '/api/entry', { file: 'events.json' } );

        await post( '/api/entry', { file: 'events.json', id: entry.id, values: { title: 'Dirty dot' } }, 'PUT' );

        const afterEntry = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; changedPageIds: string[]; pages: { id: string }[];
        };

        assert.ok( afterEntry.changedFiles.includes( 'events.json' ) );
        assert.deepEqual( afterEntry.changedPageIds, [] );

        await post( '/api/block', { pageId: homePageId, path: 'blocks[0]', props: { title: 'A dirtied page' } }, 'PUT' );

        const afterPage = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; changedPageIds: string[]; pages: { id: string }[];
        };

        assert.ok( afterPage.changedFiles.includes( 'pages.json' ) );
        assert.deepEqual( afterPage.changedPageIds, [ homePageId ] );

        await post( '/api/entry', { file: 'events.json', id: entry.id }, 'DELETE' );
        await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } );

        const saved = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; changedPageIds: string[];
        };

        assert.deepEqual( saved.changedFiles, [] );
        assert.deepEqual( saved.changedPageIds, [] );

        // A deleted file is a change too, even though it is no longer
        // on disk to be listed: ownership comes from the copy HEAD
        // still holds.
        await post( '/api/collection', { label: 'Doomed' } );
        await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } );
        await post( '/api/collection', { file: 'doomed.json' }, 'DELETE' );

        const afterDelete = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; status: string;
        };

        assert.ok( afterDelete.changedFiles.includes( 'doomed.json' ) );
        assert.equal( afterDelete.status, 'unsaved' );

        // The save must commit the deletion itself - otherwise HEAD
        // keeps the file and a later discard resurrects it.
        await fetch( `${base}/api/save?t=${server.token}`, { method: 'POST' } );

        const afterDeletionSave = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            changedFiles: string[]; status: string;
        };

        assert.deepEqual( afterDeletionSave.changedFiles, [] );
        assert.notEqual( afterDeletionSave.status, 'unsaved' );

        const gone = await runGit( contentDirectory, [ 'show', 'HEAD:doomed.json' ] );

        assert.notEqual( gone.code, 0, 'HEAD no longer carries the deleted file' );
    } );

    it( 'runs the collection lifecycle: create, entries, settings, delete - all undoable', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        const created = await post( '/api/collection', { label: 'Projects' } );

        assert.equal( created.file, 'projects.json' );

        const entry = await post( '/api/entry', { file: 'projects.json' } );

        await post( '/api/entry', { file: 'projects.json', id: entry.id, values: { title: 'First project' } }, 'PUT' );
        await post( '/api/collection', { file: 'projects.json', patch: { index: false, locked: true } }, 'PUT' );

        const query = new URLSearchParams( { file: 'projects.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as {
            label: string; index: boolean; locked: boolean; entries: { values: { title?: string } }[];
        };

        assert.equal( loaded.label, 'Projects' );
        assert.equal( loaded.index, false );
        assert.equal( loaded.locked, true );
        assert.equal( loaded.entries[ 0 ]?.values.title, 'First project' );

        await post( '/api/entry', { file: 'projects.json', id: entry.id }, 'DELETE' );

        const emptied = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as { entries: unknown[] };

        assert.equal( emptied.entries.length, 0 );

        await post( '/api/collection', { file: 'projects.json' }, 'DELETE' );

        const gone = await fetch( `${base}/api/collection?${query.toString()}` );

        assert.equal( gone.status, 404 );

        // The journal covers file existence itself: one undo revives
        // the deleted collection, and stepping past its creation
        // removes the file again.
        await post( '/api/undo', {} );

        const revived = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as { label: string };

        assert.equal( revived.label, 'Projects' );
    } );

    it( 'runs the taxonomy lifecycle: create, terms, delete', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        const created = await post( '/api/taxonomy', { label: 'Venues' } );

        assert.equal( created.file, 'venues.json' );

        const term = await post( '/api/term', { file: 'venues.json' } );

        await post( '/api/term', { file: 'venues.json', id: term.id, name: 'The corner shop' }, 'PUT' );

        const query = new URLSearchParams( { file: 'venues.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/taxonomy?${query.toString()}` ) ).json() as { terms: { name: string }[] };

        assert.equal( loaded.terms[ 0 ]?.name, 'The corner shop' );

        await post( '/api/term', { file: 'venues.json', id: term.id }, 'DELETE' );
        await post( '/api/taxonomy', { file: 'venues.json' }, 'DELETE' );

        const gone = await fetch( `${base}/api/taxonomy?${query.toString()}` );

        assert.equal( gone.status, 404 );
    } );

    it( 'writes theme color values canonically', async () =>
    {
        const put = await fetch( `${base}/api/theme?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { colors: { primary: '#222831' } } ),
        } );

        assert.equal( put.status, 200 );

        const written = await readFile( join( contentDirectory, 'site.json' ), 'utf8' );

        assert.equal( written, serializeCanonicalJson( parseJsonDocument( written ) ) );
        assert.match( written, /#222831/ );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );
    } );

    it( 'writes theme layout and spacing edits, and the site still validates', async () =>
    {
        const put = await fetch( `${base}/api/theme?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                layout: { gutter: 'lg', width: 'prose' },
                families: { spacing: { md: '1.25rem' } },
            } ),
        } );

        assert.equal( put.status, 200 );

        const written = await readFile( join( contentDirectory, 'site.json' ), 'utf8' );

        assert.match( written, /"layout"/ );
        assert.match( written, /"gutter": "lg"/ );
        assert.match( written, /"md": "1\.25rem"/ );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );
    } );

    it( 'previews and edits a collection surface: index, template, sample entry', async () =>
    {
        // The fixture's events collection carries a template bound to
        // the entry title and an index with a repeat of itself.
        const indexPreview = await ( await fetch( `${base}/preview-index/events?t=${server.token}` ) ).text();

        assert.match( indexPreview, /Harvest loaf tasting/ );
        assert.match( indexPreview, /Latte art night/ );
        assert.match( indexPreview, /data-casomer-block/ );

        const templatePreview = await ( await fetch( `${base}/preview-entry-template/events?t=${server.token}` ) ).text();

        assert.match( templatePreview, /Harvest loaf tasting/, 'the first entry is the template sample' );

        // Block addressing by doc and surface: read, then write.
        const query = new URLSearchParams( { doc: 'events', surface: 'template', path: 'blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { reference: string; props: Record<string, unknown> };

        assert.equal( block.reference, 'core/markdown' );
        assert.deepEqual( block.props.content, { $bind: 'entry.title' } );

        const written = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { doc: 'events', surface: 'template', path: 'blocks[0]', props: { content: { $bind: 'entry.details' } } } ),
        } );

        assert.equal( written.status, 200 );

        const reread = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: Record<string, unknown> };

        assert.deepEqual( reread.props.content, { $bind: 'entry.details' } );

        // Back, so later tests see the fixture as committed.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { doc: 'events', surface: 'template', path: 'blocks[0]', props: { content: { $bind: 'entry.title' } } } ),
        } );
    } );

    it( 'appends a surface block and merges a fields patch without flattening', async () =>
    {
        const put = async ( body: unknown ) =>
            await fetch( `${base}/api/collection?t=${server.token}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        const appended = await put( {
            file: 'events.json',
            patch: { appendBlock: { surface: 'index', block: { component: 'core/markdown', props: { content: 'A closing note' } } } },
        } );

        assert.equal( appended.status, 200 );

        const indexPreview = await ( await fetch( `${base}/preview-index/events?t=${server.token}` ) ).text();

        assert.match( indexPreview, /A closing note/ );

        // A fields patch carries the simple facts; renaming a label
        // keeps the field working and the site valid.
        const patched = await put( {
            file: 'events.json',
            patch: {
                fields: {
                    title: { type: 'text', label: 'Event name', required: true },
                    eventDate: { type: 'date', label: 'When' },
                    details: { type: 'markdown', label: 'Details' },
                },
                table: [ 'title', 'eventDate' ],
            },
        } );

        assert.equal( patched.status, 200 );

        const query = new URLSearchParams( { file: 'events.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as {
            fields: Record<string, { label: string; required?: boolean }>;
            table: string[];
        };

        assert.equal( loaded.fields.title?.label, 'Event name' );
        assert.equal( loaded.fields.title?.required, true );
        assert.deepEqual( loaded.table, [ 'title', 'eventDate' ] );

        // Dropping title is refused: entries need labels (13.3).
        const refused = await put( { file: 'events.json', patch: { fields: { eventDate: { type: 'date', label: 'When' } } } } );

        assert.equal( refused.status, 400 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );
    } );

    it( 'serves and edits a repeat block: config, wiring shape, source options', async () =>
    {
        // The fixture's events index holds a section whose first child
        // is the repeat of the collection.
        const query = new URLSearchParams( { doc: 'events', surface: 'index', path: 'blocks[0].blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as {
            kind: string;
            repeat: { source: { collection: string; order?: string } };
            componentFields: Record<string, unknown>;
            collections: { stem: string; fields: Record<string, { type: string }> }[];
            entryCount: number;
        };

        assert.equal( block.kind, 'repeat' );
        assert.equal( block.repeat.source.collection, 'events' );
        assert.ok( block.componentFields.content !== undefined, 'the repeated component shape rides along' );
        assert.equal( block.collections.find( ( candidate ) => candidate.stem === 'events' )?.fields.eventDate?.type, 'date' );

        const written = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                doc: 'events',
                surface: 'index',
                path: 'blocks[0].blocks[0]',
                repeat: {
                    source: { collection: 'events', order: 'entry.title', limit: 1 },
                    component: 'core/markdown',
                    props: { content: { $bind: 'entry.title' } },
                },
            } ),
        } );

        assert.equal( written.status, 200 );

        const preview = await ( await fetch( `${base}/preview-index/events?t=${server.token}` ) ).text();

        assert.match( preview, /Harvest loaf tasting/, 'title-ascending limit 1 shows the H entry' );
        assert.ok( !preview.includes( 'Latte art night' ), 'the limit holds' );

        // Back to the committed shape.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                doc: 'events',
                surface: 'index',
                path: 'blocks[0].blocks[0]',
                repeat: {
                    source: { collection: 'events', order: '-entry.eventDate' },
                    component: 'core/markdown',
                    props: { content: { $bind: 'entry.title' } },
                },
            } ),
        } );
    } );

    it( 'inserts and removes blocks, on pages and on surfaces', async () =>
    {
        const call = async ( method: string, body: unknown ) =>
            await fetch( `${base}/api/block?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        const inserted = await call( 'POST', {
            pageId: homePageId,
            container: '',
            index: 0,
            block: { component: 'core/markdown', props: { content: 'A fresh lead block' } },
        } );

        assert.equal( inserted.status, 200 );

        const preview = await ( await fetch( `${base}/canvas/home?t=${server.token}` ) ).text();

        assert.match( preview, /A fresh lead block/ );

        const removed = await call( 'DELETE', { pageId: homePageId, path: 'blocks[0]' } );

        assert.equal( removed.status, 200 );

        const after = await ( await fetch( `${base}/canvas/home?t=${server.token}` ) ).text();

        assert.ok( !after.includes( 'A fresh lead block' ) );

        // A surface insert materializes a missing surface object.
        const surfaceInsert = await call( 'POST', {
            doc: 'events',
            surface: 'template',
            container: '',
            block: { component: 'core/markdown', props: { content: 'Trailing template note' } },
        } );

        assert.equal( surfaceInsert.status, 200 );

        const template = await ( await fetch( `${base}/preview-entry-template/events?t=${server.token}` ) ).text();

        assert.match( template, /Trailing template note/ );
        await call( 'DELETE', { doc: 'events', surface: 'template', path: 'blocks[1]' } );
    } );

    it( 'inserts an empty section, then a component inside it', async () =>
    {
        const call = async ( method: string, body: unknown ) =>
            await fetch( `${base}/api/block?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        const section = await call( 'POST', {
            pageId: homePageId,
            container: '',
            index: 0,
            block: { section: {}, blocks: [] },
        } );

        assert.equal( section.status, 200 );

        // The editing preview flags the empty section for its ghost;
        // the real output never carries the flag.
        const editing = await ( await fetch( `${base}/canvas/home?t=${server.token}` ) ).text();
        const pure = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.match( editing, /data-casomer-empty/ );
        assert.ok( !pure.includes( 'data-casomer-empty' ) );

        const child = await call( 'POST', {
            pageId: homePageId,
            container: 'blocks[0]',
            index: 0,
            block: { component: 'core/markdown', props: { content: 'Inside the new section' } },
        } );

        assert.equal( child.status, 200 );

        const filled = await ( await fetch( `${base}/canvas/home?t=${server.token}` ) ).text();

        assert.match( filled, /Inside the new section/ );
        assert.match( filled, /data-casomer-block="blocks\[0\]\.blocks\[0\]"/ );

        await call( 'DELETE', { pageId: homePageId, path: 'blocks[0]' } );
    } );

    it( 'lists the components the picker offers, first examples included', async () =>
    {
        const body = await ( await fetch( `${base}/api/components?t=${server.token}` ) ).json() as {
            components: { reference: string; title: string; packageName: string; exampleProps: Record<string, unknown> }[];
        };

        const references = body.components.map( ( component ) => component.reference );

        assert.ok( references.includes( 'core/markdown' ) );
        assert.ok( references.includes( 'fixture-kit/card' ) );

        const card = body.components.find( ( component ) => component.reference === 'fixture-kit/card' );

        assert.equal( card?.packageName, 'fixture-kit' );
        assert.ok( Object.keys( card?.exampleProps ?? {} ).length > 0, 'the card ships example props' );
    } );

    it( 'wires a reference field to a taxonomy and assigns a term', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        await post( '/api/taxonomy', { label: 'Rooms' } );

        const term = await post( '/api/term', { file: 'rooms.json' } );

        await post( '/api/term', { file: 'rooms.json', id: term.id, name: 'The oven room' }, 'PUT' );

        // The Fields workspace turns a field into a taxonomy reference:
        // "reference | taxonomy:rooms" via the merge (SCHEMA 13.3).
        await post( '/api/collection', {
            file: 'events.json',
            patch: {
                fields: {
                    title: { type: 'text', label: 'Title', required: true },
                    eventDate: { type: 'date', label: 'Event Date' },
                    details: { type: 'markdown', label: 'Details' },
                    room: { type: 'reference', label: 'Room', taxonomy: 'rooms' },
                },
            },
        }, 'PUT' );

        const query = new URLSearchParams( { file: 'events.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as {
            fields: Record<string, { type: string; rules?: { taxonomy?: string } }>;
            taxonomies: { stem: string; terms: { id: string; name: string }[] }[];
            entries: { id: string }[];
        };

        assert.equal( loaded.fields.room?.type, 'reference' );
        assert.equal( loaded.fields.room?.rules?.taxonomy, 'rooms' );
        assert.equal( loaded.taxonomies.find( ( candidate ) => candidate.stem === 'rooms' )?.terms[ 0 ]?.name, 'The oven room' );

        // Assigning a term stores its id; the site stays valid.
        await post( '/api/entry', {
            file: 'events.json',
            id: loaded.entries[ 0 ]?.id,
            values: { title: 'Harvest loaf tasting', eventDate: '2026-10-12', details: 'Bring an appetite.', room: term.id },
        }, 'PUT' );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: { path: string }[] };

        assert.deepEqual( site.issues, [] );

        // An entry reference targets another collection via the type
        // rule ("reference | type:rooms-collection" spelling).
        await post( '/api/collection', { label: 'Sponsors' } );
        await post( '/api/collection', {
            file: 'events.json',
            patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event Date' },
                details: { type: 'markdown', label: 'Details' },
                room: { type: 'reference', label: 'Room', taxonomy: 'rooms' },
                sponsor: { type: 'reference', label: 'Sponsor', collection: 'sponsors' },
            } },
        }, 'PUT' );

        const withEntryRef = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as {
            fields: Record<string, { rules?: { type?: string; taxonomy?: string } }>;
            collectionRefs: { stem: string }[];
        };

        assert.equal( withEntryRef.fields.sponsor?.rules?.type, 'sponsors' );
        assert.equal( withEntryRef.fields.sponsor?.rules?.taxonomy, undefined );
        assert.ok( withEntryRef.collectionRefs.some( ( candidate ) => candidate.stem === 'sponsors' ) );

        const cleanSite = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( cleanSite.issues, [] );
        await post( '/api/collection', { file: 'sponsors.json' }, 'DELETE' );

        // With its target gone, the load names the problem.
        const dangling = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: { message: string }[] };

        assert.ok( dangling.issues.some( ( issue ) => issue.message.includes( 'no collection "sponsors"' ) ) );

        // A reference to a taxonomy that does not exist is an issue.
        await post( '/api/collection', {
            file: 'events.json',
            patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event Date' },
                details: { type: 'markdown', label: 'Details' },
                room: { type: 'reference', label: 'Room', taxonomy: 'ghosts' },
            } },
        }, 'PUT' );

        const broken = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: { message: string }[] };

        assert.ok( broken.issues.some( ( issue ) => issue.message.includes( 'no taxonomy "ghosts"' ) ) );

        // Back to a clean shape for the tests that follow.
        await post( '/api/collection', {
            file: 'events.json',
            patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event Date' },
                details: { type: 'markdown', label: 'Details' },
            } },
        }, 'PUT' );
        await post( '/api/entry', {
            file: 'events.json',
            id: loaded.entries[ 0 ]?.id,
            values: { title: 'Harvest loaf tasting', eventDate: '2026-10-12', details: 'Bring an appetite.' },
        }, 'PUT' );
        await post( '/api/taxonomy', { file: 'rooms.json' }, 'DELETE' );
    } );

    it( 'a draft entry is exempt from enforcement and omitted from output', async () =>
    {
        const created = await ( await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json' } ),
        } ) ).json() as { id: string };

        // Incomplete, but parked as a draft: no problems reported.
        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: created.id, draft: true } ),
        } );

        const problems = await ( await fetch( `${base}/api/problems?t=${server.token}` ) ).json() as { problems: unknown[] };

        assert.deepEqual( problems.problems, [] );

        // The index repeat omits the draft even though it is titled.
        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: created.id, values: { title: 'Secret tasting', eventDate: '2026-11-01', details: '' } } ),
        } );

        const index = await ( await fetch( `${base}/preview-index/events?t=${server.token}` ) ).text();

        assert.ok( !index.includes( 'Secret tasting' ), 'drafts never reach a repeat' );

        // Clearing the switch brings it back.
        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: created.id, draft: false } ),
        } );

        const cleared = await ( await fetch( `${base}/preview-index/events?t=${server.token}` ) ).text();

        assert.match( cleared, /Secret tasting/ );

        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: created.id } ),
        } );
    } );

    it( 'a draft page edits on the canvas but is omitted from the pure preview', async () =>
    {
        const aboutId = ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] } ).pages.find( ( page ) => page.slug === 'about' )?.id ?? '';

        await fetch( `${base}/api/page?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { id: aboutId, patch: { draft: true } } ),
        } );

        const editing = await ( await fetch( `${base}/canvas/about?t=${server.token}` ) ).text();
        const pure = await ( await fetch( `${base}/preview/about/?t=${server.token}` ) ).text();

        assert.match( editing, /data-casomer-block/, 'the canvas still edits a draft' );
        assert.match( pure, /draft/i );
        assert.ok( !pure.includes( 'data-casomer-block' ) );

        await fetch( `${base}/api/page?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { id: aboutId, patch: { draft: false } } ),
        } );
    } );

    it( 'nests pages and mounts collections through the API, refusing loops and home', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };
        const aboutId = site.pages.find( ( page ) => page.slug === 'about' )?.id ?? '';

        const created = await ( await post( '/api/page', { title: 'Team' } ) ).json() as { id: string };
        const nested = await post( '/api/page', { id: created.id, patch: { parent: aboutId } }, 'PUT' );

        assert.equal( nested.status, 200 );

        const after = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; parent?: string }[] };

        assert.equal( after.pages.find( ( page ) => page.id === created.id )?.parent, aboutId );

        // Nesting the parent under its own child would loop the tree.
        const loop = await post( '/api/page', { id: aboutId, patch: { parent: created.id } }, 'PUT' );

        assert.equal( loop.status, 409 );

        // Home neither takes nor grants a parent.
        const homeAsParent = await post( '/api/page', { id: created.id, patch: { parent: homePageId } }, 'PUT' );

        assert.equal( homeAsParent.status, 400 );

        const homeAsChild = await post( '/api/page', { id: homePageId, patch: { parent: aboutId } }, 'PUT' );

        assert.equal( homeAsChild.status, 400 );

        // A collection mounts under a page, and unmounts with null.
        const mounted = await post( '/api/collection', { file: 'events.json', patch: { parent: aboutId } }, 'PUT' );

        assert.equal( mounted.status, 200 );

        const query = new URLSearchParams( { file: 'events.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as { parent: string | null };

        assert.equal( loaded.parent, aboutId );

        const mountedOnHome = await post( '/api/collection', { file: 'events.json', patch: { parent: homePageId } }, 'PUT' );

        assert.equal( mountedOnHome.status, 400 );

        await post( '/api/collection', { file: 'events.json', patch: { parent: null } }, 'PUT' );
        await post( '/api/page', { id: created.id, patch: { parent: null } }, 'PUT' );

        const restored = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as { parent: string | null };

        assert.equal( restored.parent, null );
    } );

    it( 'renames, re-addresses, and deletes pages, with the tree guarded', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        const created = await ( await post( '/api/page', { title: 'Doomed Page' } ) ).json() as { id: string; slug: string };

        // Title edits persist; empty titles are refused outright.
        assert.equal( ( await post( '/api/page', { id: created.id, patch: { title: 'Renamed Page' } }, 'PUT' ) ).status, 200 );
        assert.equal( ( await post( '/api/page', { id: created.id, patch: { title: '   ' } }, 'PUT' ) ).status, 400 );

        // The address change: valid slugs move, collisions and home refuse.
        assert.equal( ( await post( '/api/page', { id: created.id, patch: { slug: 'renamed-page' } }, 'PUT' ) ).status, 200 );
        assert.equal( ( await post( '/api/page', { id: created.id, patch: { slug: 'about' } }, 'PUT' ) ).status, 409 );
        assert.equal( ( await post( '/api/page', { id: created.id, patch: { slug: 'Bad Slug!' } }, 'PUT' ) ).status, 400 );
        assert.equal( ( await post( '/api/page', { id: homePageId, patch: { slug: 'start' } }, 'PUT' ) ).status, 400 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; title: string; slug: string }[] };
        const renamed = site.pages.find( ( page ) => page.id === created.id );

        assert.equal( renamed?.title, 'Renamed Page' );
        assert.equal( renamed?.slug, 'renamed-page' );

        // Deleting refuses home, refuses a page with a subtree, and
        // otherwise goes through the journal.
        assert.equal( ( await post( '/api/page', { id: homePageId }, 'DELETE' ) ).status, 400 );

        const child = await ( await post( '/api/page', { title: 'Nested Child' } ) ).json() as { id: string };

        await post( '/api/page', { id: child.id, patch: { parent: created.id } }, 'PUT' );

        // A parent deletes; its child rises to where it was (Mikey).
        assert.equal( ( await post( '/api/page', { id: created.id }, 'DELETE' ) ).status, 200 );

        const risen = ( await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; parent?: string }[] } ).pages.find( ( page ) => page.id === child.id );

        assert.equal( risen?.parent, undefined, 'the child rose to the root' );
        assert.equal( ( await post( '/api/page', { id: child.id }, 'DELETE' ) ).status, 200 );

        const after = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string }[] };

        assert.ok( !after.pages.some( ( page ) => page.id === created.id ) );

        // One undo steps the delete back.
        const undo = await ( await fetch( `${base}/api/undo?t=${server.token}`, { method: 'POST' } ) ).json() as { stepped: boolean };

        assert.equal( undo.stepped, true );

        const restored = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string }[] };

        assert.ok( restored.pages.some( ( page ) => page.id === child.id ), 'the last delete - the risen child - stepped back' );

        await post( '/api/page', { id: child.id }, 'DELETE' );
    } );

    it( 'terms hold the fixed shape, drag order persists, and surfaces preview', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        await post( '/api/taxonomy', { label: 'Moods' } );

        const first = await post( '/api/term', { file: 'moods.json', name: 'Calm' } ) as { id: string };
        const second = await post( '/api/term', { file: 'moods.json', name: 'Loud' } ) as { id: string };

        // The fixed shape: description and image ride the term PUT;
        // empties clear back to absence.
        await post( '/api/term', {
            file: 'moods.json', id: first.id, name: 'Calm',
            description: 'Soft light and slow tempo.',
            image: { src: '/media/calm.jpg', alt: 'A calm scene' },
        }, 'PUT' );

        const query = new URLSearchParams( { file: 'moods.json', t: server.token } );
        const loaded = await ( await fetch( `${base}/api/taxonomy?${query.toString()}` ) ).json() as {
            terms: { id: string; description?: string; image?: { src: string } }[];
        };
        const calm = loaded.terms.find( ( term ) => term.id === first.id );

        assert.equal( calm?.description, 'Soft light and slow tempo.' );
        assert.equal( calm?.image?.src, '/media/calm.jpg' );

        // Drag order: the terms array is the sort order.
        await post( '/api/taxonomy', { file: 'moods.json', patch: { termOrder: [ second.id, first.id ] } }, 'PUT' );

        const reordered = await ( await fetch( `${base}/api/taxonomy?${query.toString()}` ) ).json() as { terms: { id: string }[] };

        assert.deepEqual( reordered.terms.map( ( term ) => term.id ), [ second.id, first.id ] );

        // The taxonomy surfaces serve: editing canvas and pure term page.
        const canvas = await fetch( `${base}/preview-term-template/moods?t=${server.token}&term=${first.id}` );

        assert.equal( canvas.status, 200 );
        assert.match( await canvas.text(), /preview-bridge/ );

        const pure = await fetch( `${base}/preview-term/moods?t=${server.token}&term=${first.id}` );

        assert.equal( pure.status, 200 );
        assert.ok( !( await pure.text() ).includes( 'preview-bridge' ) );

        // Entry drag order persists the same way.
        const entryA = await post( '/api/entry', { file: 'events.json' } ) as { id: string };
        const entryB = await post( '/api/entry', { file: 'events.json' } ) as { id: string };

        await post( '/api/collection', { file: 'events.json', patch: { entryOrder: [ entryB.id, entryA.id ] } }, 'PUT' );

        const collection = await ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as { entries: { id: string }[] };
        const positions = collection.entries.map( ( entry ) => entry.id );

        assert.ok( positions.indexOf( entryB.id ) < positions.indexOf( entryA.id ) );

        await post( '/api/entry', { file: 'events.json', id: entryA.id }, 'DELETE' );
        await post( '/api/entry', { file: 'events.json', id: entryB.id }, 'DELETE' );
        await post( '/api/taxonomy', { file: 'moods.json' }, 'DELETE' );
    } );

    it( 'carries the site identity: display name, document titles, and the icon', async () =>
    {
        const put = await fetch( `${base}/api/site-meta?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { name: 'Sunrise Bakery' } ),
        } );

        assert.equal( put.status, 200 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { projectName: string; folderName: string };

        assert.equal( site.projectName, 'Sunrise Bakery' );
        assert.notEqual( site.folderName, 'Sunrise Bakery' );

        const home = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();
        const about = await ( await fetch( `${base}/preview/about/?t=${server.token}` ) ).text();

        assert.match( home, /<title>Sunrise Bakery<\/title>/, 'home speaks the site name alone' );
        assert.match( about, /<title>About · Sunrise Bakery<\/title>/, 'other pages join page and site' );

        // The icon: raw bytes up, a media path back, favicon links in
        // every page head.
        const png = Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64' );
        const uploaded = await fetch( `${base}/api/site-icon?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: png,
        } );
        const iconBody = await uploaded.json() as { icon: string };

        assert.equal( uploaded.status, 200 );
        assert.match( iconBody.icon, /^\/media\/[0-9a-f-]+\.png$/ );

        const iconServed = await fetch( `${base}${iconBody.icon}?t=${server.token}` );

        assert.equal( iconServed.status, 200 );

        const withIcon = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.ok( withIcon.includes( `<link rel="icon" href="${iconBody.icon}">` ) );
        assert.ok( withIcon.includes( `<link rel="apple-touch-icon" href="${iconBody.icon}">` ) );

        // Clearing: the name empties back to the folder, the icon
        // reference goes, and the page head follows.
        await fetch( `${base}/api/site-icon?t=${server.token}`, { method: 'DELETE' } );
        await fetch( `${base}/api/site-meta?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { name: '' } ),
        } );

        const cleared = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { projectName: string; folderName: string; siteIcon: string };

        assert.equal( cleared.projectName, cleared.folderName );
        assert.equal( cleared.siteIcon, '' );

        const plain = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.match( plain, /<title>Home<\/title>/ );
        assert.ok( !plain.includes( 'apple-touch-icon' ) );
    } );

    it( 'uploads media: UUID-renamed, original name retained, served back', async () =>
    {
        // SVG passes the optimizer through untouched, so this flow
        // stays byte-deterministic; conversion has its own unit
        // tests (optimize.test.ts).
        const svg = Buffer.from( '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>' );
        const uploaded = await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'image/svg+xml', 'x-casomer-name': encodeURIComponent( 'hero-photo final v2.svg' ) },
            body: svg,
        } );
        const body = await uploaded.json() as { src: string; name: string; size: number; converted: boolean };

        assert.equal( uploaded.status, 200 );
        assert.match( body.src, /^\/media\/[0-9a-f-]+\.svg$/ );
        assert.equal( body.name, 'hero-photo final v2', 'the name drops the extension' );
        assert.equal( body.size, svg.length );
        assert.equal( body.converted, false );

        const served = await fetch( `${base}${body.src}?t=${server.token}` );

        assert.equal( served.status, 200 );
        assert.equal( served.headers.get( 'content-type' ), 'image/svg+xml' );

        const empty = await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: Buffer.alloc( 0 ),
        } );

        assert.equal( empty.status, 400 );

        // The media library sees the upload as unreferenced, with the
        // ORIGINAL name as its label (site.json media record); putting
        // it into an entry makes it referenced and undeletable; after
        // the reference clears, deletion moves it to the TRASH, where
        // it can be restored or deleted forever (SCHEMA 13.4).
        const name = body.src.replace( '/media/', '' );
        const library = await ( await fetch( `${base}/api/media-library?t=${server.token}` ) ).json() as { files: { file: string; references: number; label?: string }[] };
        const listed = library.files.find( ( candidate ) => candidate.file === name );

        assert.equal( listed?.references, 0 );
        assert.equal( listed?.label, 'hero-photo final v2' );

        // The label is editable metadata.
        await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name, label: 'Hero photo' } ),
        } );

        const relabeled = await ( await fetch( `${base}/api/media-library?t=${server.token}` ) ).json() as { files: { file: string; label?: string }[] };

        assert.equal( relabeled.files.find( ( candidate ) => candidate.file === name )?.label, 'Hero photo' );

        const collection = await ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as { entries: { id: string; values: Record<string, unknown> }[] };
        const entry = collection.entries[ 0 ]!;

        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: entry.id, values: { ...entry.values, poster: { src: body.src } } } ),
        } );

        const refused = await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name } ),
        } );

        assert.equal( refused.status, 409, 'a referenced file never deletes' );

        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: entry.id, values: entry.values } ),
        } );

        const deleted = await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name } ),
        } );

        assert.equal( deleted.status, 200 );

        // The delete MOVED the file to the trash: gone from the
        // library, listed in trash with its label, thumbnail served
        // from /trash/, and restorable.
        const afterTrash = await ( await fetch( `${base}/api/media-library?t=${server.token}` ) ).json() as {
            files: { file: string }[];
            trash: { file: string; label?: string; url: string }[];
        };

        assert.ok( !afterTrash.files.some( ( candidate ) => candidate.file === name ) );
        assert.equal( afterTrash.trash.find( ( candidate ) => candidate.file === name )?.label, 'Hero photo' );
        assert.equal( ( await fetch( `${base}/trash/${name}?t=${server.token}` ) ).status, 200 );

        const restored = await fetch( `${base}/api/media-trash?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name, action: 'restore' } ),
        } );

        assert.equal( restored.status, 200 );

        const afterRestore = await ( await fetch( `${base}/api/media-library?t=${server.token}` ) ).json() as {
            files: { file: string; label?: string }[];
            trash: { file: string }[];
        };

        assert.equal( afterRestore.files.find( ( candidate ) => candidate.file === name )?.label, 'Hero photo' );
        assert.equal( afterRestore.trash.length, 0 );

        // Trash again, then delete FOREVER: the file and its label
        // both go - the only unrecoverable delete in Studio.
        await fetch( `${base}/api/media?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name } ),
        } );

        const forever = await fetch( `${base}/api/media-trash?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: name, action: 'delete' } ),
        } );

        assert.equal( forever.status, 200 );

        const afterForever = await ( await fetch( `${base}/api/media-library?t=${server.token}` ) ).json() as {
            files: { file: string }[];
            trash: { file: string }[];
        };
        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { config: { media?: { labels?: Record<string, string> } } };

        assert.ok( !afterForever.files.some( ( candidate ) => candidate.file === name ) );
        assert.equal( afterForever.trash.length, 0 );
        assert.equal( site.config.media?.labels?.[ name ], undefined, 'the label goes with the file' );
    } );

    it( 'the media-tracking choice manages its .gitignore lines', async () =>
    {
        const off = await fetch( `${base}/api/media-tracking?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { track: false } ),
        } );

        assert.equal( off.status, 200 );

        const ignored = await readFile( join( contentDirectory, '.gitignore' ), 'utf8' );

        assert.ok( ignored.includes( 'media/' ) && ignored.includes( 'dist/media/' ) );

        const offSite = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { config: { media?: { track?: boolean } } };

        assert.equal( offSite.config.media?.track, false );

        const on = await fetch( `${base}/api/media-tracking?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { track: true } ),
        } );

        assert.equal( on.status, 200 );

        const restored = await readFile( join( contentDirectory, '.gitignore' ), 'utf8' );

        assert.ok( !restored.includes( 'media/' ), 'the managed lines are removed' );

        const onSite = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { config: { media?: { track?: boolean } } };

        assert.equal( onSite.config.media?.track, undefined, 'tracking is the absent default' );
    } );

    it( 'typography and third-party resources round-trip and reach the page', async () =>
    {
        const put = await fetch( `${base}/api/theme?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                text: { h1: { size: '3.5rem', font: 'sans' }, p: { size: '1.125rem' } },
                resources: [ 'https://fonts.example/css2?family=Sora', 'http://insecure.example/x.css', '' ],
            } ),
        } );

        assert.equal( put.status, 200 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            issues: unknown[];
            config: { theme: { text: Record<string, { size?: string; font?: string }>; resources: string[] } };
        };

        assert.deepEqual( site.issues, [] );
        assert.equal( site.config.theme.text.h1?.size, '3.5rem' );
        assert.equal( site.config.theme.text.h1?.font, 'sans' );
        assert.equal( site.config.theme.text.p?.size, '1.125rem' );
        assert.deepEqual( site.config.theme.resources, [ 'https://fonts.example/css2?family=Sora' ], 'http and empties never persist' );

        const page = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.ok( page.includes( '<link rel="stylesheet" href="https://fonts.example/css2?family=Sora">' ) );

        // Clearing: empty strings clear settings, an empty list clears
        // the resources key.
        await fetch( `${base}/api/theme?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                text: { h1: { size: '', font: '' }, p: { size: '' } },
                resources: [],
            } ),
        } );

        const cleared = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            config: { theme: { text?: unknown; resources?: unknown } };
        };

        assert.equal( cleared.config.theme.text, undefined );
        assert.equal( cleared.config.theme.resources, undefined );
    } );

    it( 'edits regions as surfaces and saves menus', async () =>
    {
        // Insert a block into the header region through the shared
        // block route, then read it back and preview the canvas.
        const inserted = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                region: 'header',
                container: '',
                index: 0,
                block: { component: 'core/markdown', props: { content: 'Region hello', width: 'prose' } },
            } ),
        } );

        assert.equal( inserted.status, 200 );

        const query = new URLSearchParams( { region: 'header', path: 'blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { content: string } };

        assert.equal( block.props.content, 'Region hello' );

        const canvas = await fetch( `${base}/preview-region/header?t=${server.token}` );

        assert.equal( canvas.status, 200 );
        assert.match( await canvas.text(), /Region hello[\s\S]*preview-bridge/ );

        const pageView = await ( await fetch( `${base}/preview/?t=${server.token}` ) ).text();

        assert.match( pageView, /<header[^>]*>[\s\S]*Region hello[\s\S]*<\/header>/, 'the region rides every page' );

        // Menus save and serve. The record shape carries nesting and
        // topLevelPages; the pre-nesting bare array is accepted and
        // migrated to { items } on write (SCHEMA 12.5).
        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };
        const aboutId = site.pages.find( ( page ) => page.slug === 'about' )?.id ?? '';
        const menusPut = await fetch( `${base}/api/menus?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { menus: {
                primary: {
                    topLevelPages: true,
                    items: [
                        { page: aboutId, items: [ { label: 'Out', url: 'https://example.com/' } ] },
                        { label: 'More', items: [ { page: aboutId, label: 'Also about' } ] },
                    ],
                },
                legacy: [ { page: aboutId } ],
            } } ),
        } );

        assert.equal( menusPut.status, 200 );

        interface SavedMenuItem { page?: string; url?: string; label?: string; items?: SavedMenuItem[] }

        const saved = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            issues: unknown[];
            config: { menus: Record<string, { topLevelPages?: boolean; items: SavedMenuItem[] }> };
        };

        assert.deepEqual( saved.issues, [] );
        assert.equal( saved.config.menus.primary?.topLevelPages, true );
        assert.equal( saved.config.menus.primary?.items.length, 2 );
        assert.equal( saved.config.menus.primary?.items[ 0 ]?.items?.[ 0 ]?.url, 'https://example.com/' );
        assert.equal( saved.config.menus.primary?.items[ 1 ]?.label, 'More' );
        assert.equal( saved.config.menus.legacy?.items.length, 1, 'a bare array migrates to { items }' );

        // Cleanup: empty the region and the menus.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { region: 'header', path: 'blocks[0]' } ),
        } );
        await fetch( `${base}/api/menus?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { menus: {} } ),
        } );
    } );

    it( 'renames a menu and rewrites every repeat source that referenced it', async () =>
    {
        await fetch( `${base}/api/menus?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { menus: { main: { items: [ { label: 'Out', url: 'https://example.com/' } ], topLevelPages: true } } } ),
        } );
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                region: 'header',
                container: '',
                index: 0,
                block: { repeat: { source: { menu: 'main' }, component: 'core/link', props: { label: { $bind: 'entry.label' }, url: { $bind: 'entry.url' } } } },
            } ),
        } );

        const renamed = await fetch( `${base}/api/menu-rename?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { from: 'main', to: 'main-nav' } ),
        } );

        assert.equal( renamed.status, 200 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as {
            issues: unknown[];
            config: { menus: Record<string, { topLevelPages?: boolean; items: unknown[] }> };
        };

        assert.deepEqual( site.issues, [], 'the rename leaves no stranded reference behind' );
        assert.equal( site.config.menus.main, undefined );
        assert.equal( site.config.menus[ 'main-nav' ]?.topLevelPages, true );

        const query = new URLSearchParams( { region: 'header', path: 'blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { repeat: { source: { menu: string } } };

        assert.equal( block.repeat.source.menu, 'main-nav', 'the region repeat follows the rename' );

        // A collision refuses; renaming to an unknown menu 404s.
        const clash = await fetch( `${base}/api/menu-rename?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { from: 'nowhere', to: 'main-nav' } ),
        } );

        assert.equal( clash.status, 404 );

        // Cleanup.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { region: 'header', path: 'blocks[0]' } ),
        } );
        await fetch( `${base}/api/menus?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { menus: {} } ),
        } );
    } );

    it( 'renames a field key with the label and sweeps every reference', async () =>
    {
        // A throwaway collection: one date field, one entry, and a
        // template that binds, orders, and interpolates through it.
        const created = await ( await fetch( `${base}/api/collection?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { label: 'Gigs' } ),
        } ) ).json() as { file: string };
        const patched = await fetch( `${base}/api/collection?t=${server.token}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file, patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event date' },
            } } } ),
        } );

        assert.equal( patched.status, 200 );

        const entry = await ( await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file, values: { title: 'One', eventDate: '2026-01-02' } } ),
        } ) ).json() as { id: string };

        const stem = created.file.replace( '.json', '' );

        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                doc: stem,
                surface: 'template',
                container: '',
                index: 0,
                block: { component: 'core/markdown', props: { width: 'prose', content: 'On {{ $entry.eventDate }} and {{ $entry.eventDated }} stays.' } },
            } ),
        } );

        const renamed = await fetch( `${base}/api/field-rename?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file, from: 'eventDate', to: 'when' } ),
        } );

        assert.equal( renamed.status, 200 );

        const collection = await ( await fetch( `${base}/api/collection?file=${created.file}&t=${server.token}` ) ).json() as {
            fields: Record<string, unknown>;
            entries: { id: string; values: Record<string, unknown> }[];
        };

        assert.equal( collection.fields.eventDate, undefined );
        assert.notEqual( collection.fields.when, undefined );
        assert.equal( collection.entries.find( ( candidate ) => candidate.id === entry.id )?.values.when, '2026-01-02', 'entry values follow the key' );

        const query = new URLSearchParams( { doc: stem, surface: 'template', path: 'blocks[0]', t: server.token } );
        const block = await ( await fetch( `${base}/api/block?${query.toString()}` ) ).json() as { props: { content: string } };

        assert.ok( block.props.content.includes( '{{ $entry.when }}' ), 'inline tokens follow the rename' );
        assert.ok( block.props.content.includes( '{{ $entry.eventDated }}' ), 'a longer key that merely shares the prefix stays' );

        // The contract key never renames.
        const refused = await fetch( `${base}/api/field-rename?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file, from: 'title', to: 'name' } ),
        } );

        assert.equal( refused.status, 400 );

        await fetch( `${base}/api/collection?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file } ),
        } );
    } );

    it( 'creates, edits, inserts, and deletes a user-defined partial', async () =>
    {
        const created = await ( await fetch( `${base}/api/partial?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { name: 'Promo Band' } ),
        } ) ).json() as { name: string };

        assert.equal( created.name, 'promo-band' );

        // Edited through the region plumbing, previewed on the same
        // partial canvas as header and footer.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                region: 'promo-band',
                container: '',
                index: 0,
                block: { component: 'core/markdown', props: { content: 'Band together', width: 'prose' } },
            } ),
        } );

        const canvas = await ( await fetch( `${base}/preview-region/promo-band?t=${server.token}` ) ).text();

        assert.match( canvas, /Band together[\s\S]*preview-bridge/ );

        // Inserted into a page as a { partial } block, rendered in
        // place, selectable as one unit.
        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { pages: { id: string; slug: string }[] };
        const about = site.pages.find( ( page ) => page.slug === 'about' )!;

        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { pageId: about.id, container: '', index: 0, block: { partial: 'promo-band' } } ),
        } );

        const page = await ( await fetch( `${base}/canvas/about?t=${server.token}` ) ).text();

        assert.ok( page.includes( 'Band together' ) );
        assert.match( page, /data-casomer-block="blocks\[0\]"/, 'the partial block is one selectable unit' );

        // Deleting the partial leaves the page reporting, not crashing.
        await fetch( `${base}/api/partial?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { name: 'promo-band' } ),
        } );

        const after = await ( await fetch( `${base}/canvas/about?t=${server.token}` ) ).text();

        assert.ok( !after.includes( 'Band together' ) );

        // Cleanup: the inserted block goes too.
        await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { pageId: about.id, path: 'blocks[0]' } ),
        } );
    } );

    it( 'renders a component ghost preview from its first example', async () =>
    {
        // The picker card's iframe: the declared example, rendered
        // pure - no markers, no bridge, no site chrome.
        const sample = await ( await fetch( `${base}/preview-component/core/heading?t=${server.token}` ) ).text();

        assert.ok( sample.includes( 'A heading' ), 'the first example speaks' );
        assert.ok( !sample.includes( 'data-casomer-block' ), 'no editing markers' );
        assert.ok( !sample.includes( 'preview-bridge' ), 'no bridge' );
        assert.ok( sample.includes( 'cs-ghost-bar' ), 'the ghosting pass ships with the sample' );

        const missing = await ( await fetch( `${base}/preview-component/nope/nothing?t=${server.token}` ) ).text();

        assert.ok( missing.includes( 'nope/nothing' ), 'an unknown reference reports, never crashes' );
    } );

    it( 'diverges an entry from the mold and returns it, explicitly both ways', async () =>
    {
        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { collections: { file: string }[] };

        assert.ok( site.collections.some( ( candidate ) => candidate.file === 'events.json' ) );

        const collection = await ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as {
            entries: { id: string; hasOwnBlocks?: boolean }[];
        };
        const entry = collection.entries[ 0 ]!;

        // Diverge: the entry's own layout starts as a COPY of the
        // current template - never empty scaffolding.
        const diverged = await fetch( `${base}/api/entry-layout?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: entry.id, action: 'diverge' } ),
        } );

        assert.equal( diverged.status, 200 );

        // Its canvas renders with the bridge, and block edits target
        // the ENTRY's blocks, not the template.
        const canvas = await ( await fetch( `${base}/canvas-entry/events?entry=${entry.id}&t=${server.token}` ) ).text();

        assert.match( canvas, /preview-bridge/ );

        const inserted = await fetch( `${base}/api/block?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( {
                doc: 'events',
                surface: 'entry',
                entry: entry.id,
                container: '',
                index: 0,
                block: { component: 'core/markdown', props: { content: 'Only on this entry', width: 'prose' } },
            } ),
        } );

        assert.equal( inserted.status, 200 );

        const template = await ( await fetch( `${base}/preview-entry-template/events?t=${server.token}` ) ).text();
        const entryCanvas = await ( await fetch( `${base}/canvas-entry/events?entry=${entry.id}&t=${server.token}` ) ).text();

        assert.ok( entryCanvas.includes( 'Only on this entry' ) );
        assert.ok( !template.includes( 'Only on this entry' ), 'the template never hears about a diverged edit' );

        // Adopt: the entry returns to the template; its layout goes.
        await fetch( `${base}/api/entry-layout?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: entry.id, action: 'adopt' } ),
        } );

        const after = await ( await fetch( `${base}/api/collection?file=events.json&t=${server.token}` ) ).json() as {
            entries: { id: string; hasOwnBlocks?: boolean }[];
            entryLayouts: Record<string, unknown[]>;
        };

        assert.notEqual( after.entries[ 0 ]?.hasOwnBlocks, true );
        assert.equal( after.entryLayouts[ entry.id ], undefined );
    } );

    it( 'refuses to publish while a required field is empty, naming it', async () =>
    {
        // A fresh entry has an empty required title: drafting and
        // saving are untouched, publish is the enforcement moment.
        const created = await ( await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json' } ),
        } ) ).json() as { id: string };

        const publish = await fetch( `${base}/api/publish?t=${server.token}`, { method: 'POST' } );

        assert.equal( publish.status, 409 );

        const body = await publish.json() as { issues: { message: string }[] };

        assert.ok( body.issues.some( ( issue ) => issue.message.includes( 'required and empty' ) ) );

        await fetch( `${base}/api/entry?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: 'events.json', id: created.id } ),
        } );
    } );

    it( 'renames a file on request and every reference follows', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await ( await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } ) ).json() as Record<string, unknown>;

        // A taxonomy referenced by an events field...
        await post( '/api/taxonomy', { label: 'Halls' } );
        await post( '/api/collection', {
            file: 'events.json',
            patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event Date' },
                details: { type: 'markdown', label: 'Details' },
                hall: { type: 'reference', label: 'Hall', taxonomy: 'halls' },
            } },
        }, 'PUT' );

        // ...renamed: the file moves and the field's rule follows.
        await post( '/api/taxonomy', { file: 'halls.json', patch: { label: 'Rooms And Halls', renameFile: true } }, 'PUT' );

        const renamed = await ( await fetch( `${base}/api/taxonomy?${new URLSearchParams( { file: 'rooms-and-halls.json', t: server.token } ).toString()}` ) ).json() as { label: string };

        assert.equal( renamed.label, 'Rooms And Halls' );

        const collection = await ( await fetch( `${base}/api/collection?${new URLSearchParams( { file: 'events.json', t: server.token } ).toString()}` ) ).json() as {
            fields: Record<string, { rules?: { taxonomy?: string } }>;
        };

        assert.equal( collection.fields.hall?.rules?.taxonomy, 'rooms-and-halls' );

        // The events collection's own index repeats "events"; renaming
        // the collection follows its own self-reference too.
        await post( '/api/collection', { file: 'events.json', patch: { label: 'Happenings', renameFile: true } }, 'PUT' );

        const happenings = await ( await fetch( `${base}/api/collection?${new URLSearchParams( { file: 'happenings.json', t: server.token } ).toString()}` ) ).json() as { label: string };

        assert.equal( happenings.label, 'Happenings' );

        const index = await ( await fetch( `${base}/preview-index/happenings?t=${server.token}` ) ).text();

        assert.match( index, /Harvest loaf tasting/, 'the self-referencing repeat followed the rename' );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );

        // Back to the fixture names for the tests that follow.
        await post( '/api/collection', { file: 'happenings.json', patch: { label: 'Events', renameFile: true } }, 'PUT' );
        await post( '/api/collection', {
            file: 'events.json',
            patch: { fields: {
                title: { type: 'text', label: 'Title', required: true },
                eventDate: { type: 'date', label: 'Event Date' },
                details: { type: 'markdown', label: 'Details' },
            } },
        }, 'PUT' );
        await post( '/api/taxonomy', { file: 'rooms-and-halls.json' }, 'DELETE' );
    } );

    it( 'hierarchical taxonomies nest terms and refuse silent flattening', async () =>
    {
        const post = async ( path: string, body: unknown, method = 'POST' ) =>
            await fetch( `${base}${path}?t=${server.token}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify( body ),
            } );

        await post( '/api/taxonomy', { label: 'Regions', hierarchical: true } );

        const parent = await ( await post( '/api/term', { file: 'regions.json' } ) ).json() as { id: string };
        const child = await ( await post( '/api/term', { file: 'regions.json' } ) ).json() as { id: string };

        await post( '/api/term', { file: 'regions.json', id: parent.id, name: 'Coast' }, 'PUT' );
        await post( '/api/term', { file: 'regions.json', id: child.id, name: 'North shore', parent: parent.id }, 'PUT' );

        const loaded = await ( await fetch( `${base}/api/taxonomy?${new URLSearchParams( { file: 'regions.json', t: server.token } ).toString()}` ) ).json() as {
            hierarchical: boolean;
            terms: { id: string; parent?: string }[];
        };

        assert.equal( loaded.hierarchical, true );
        assert.equal( loaded.terms.find( ( term ) => term.id === child.id )?.parent, parent.id );

        // Un-hierarchical while nested is refused; un-nest first.
        const refused = await post( '/api/taxonomy', { file: 'regions.json', patch: { hierarchical: false } }, 'PUT' );

        assert.equal( refused.status, 409 );

        await post( '/api/term', { file: 'regions.json', id: child.id, parent: null }, 'PUT' );

        const allowed = await post( '/api/taxonomy', { file: 'regions.json', patch: { hierarchical: false } }, 'PUT' );

        assert.equal( allowed.status, 200 );

        const site = await ( await fetch( `${base}/api/site?t=${server.token}` ) ).json() as { issues: unknown[] };

        assert.deepEqual( site.issues, [] );
        await post( '/api/taxonomy', { file: 'regions.json' }, 'DELETE' );
    } );

    it( 'creates a collection without a public index when asked', async () =>
    {
        const created = await ( await fetch( `${base}/api/collection?t=${server.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { label: 'Private notes', index: false } ),
        } ) ).json() as { file: string };

        const query = new URLSearchParams( { file: created.file, t: server.token } );
        const loaded = await ( await fetch( `${base}/api/collection?${query.toString()}` ) ).json() as { index: boolean };

        assert.equal( loaded.index, false );

        await fetch( `${base}/api/collection?t=${server.token}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify( { file: created.file } ),
        } );
    } );
} );
