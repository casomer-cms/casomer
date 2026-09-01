import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadContentDocuments } from './contentDocuments.ts';
import { type SchemaIssue } from '../schema/fields.ts';

async function scratchDirectory ( files: Readonly<Record<string, unknown>> ): Promise<string>
{
    const directory = await mkdtemp( join( tmpdir(), 'casomer-content-' ) );

    for ( const [ name, value ] of Object.entries( files ) )
    {
        await writeFile( join( directory, name ), typeof value === 'string' ? value : JSON.stringify( value ), 'utf8' );
    }

    return directory;
}

describe( 'self-describing content documents', () =>
{
    it( 'loads a collection: label, normalized fields, entries', async () =>
    {
        const directory = await scratchDirectory( {
            'events.json': {
                casomerSchema: 1,
                kind: 'collection',
                label: 'Events',
                fields: { title: 'text!', eventDate: 'date' },
                entries: [ { id: 'aa11bb22-cc33-4d44-8e55-ff6677889900', title: 'Fair', eventDate: '2026-09-01' } ],
            },
        } );
        const issues: SchemaIssue[] = [];
        const documents = await loadContentDocuments( directory, issues, new Map() );

        assert.deepEqual( issues, [] );
        assert.equal( documents.collections[ 0 ]?.label, 'Events' );
        assert.equal( documents.collections[ 0 ]?.fields.title?.required, true );
        assert.equal( documents.collections[ 0 ]?.entries[ 0 ]?.values.title, 'Fair' );
        assert.equal( documents.collections[ 0 ]?.entries[ 0 ]?.hasOwnBlocks, false );
    } );

    it( 'answers a typo in kind with a did-you-mean, never silence', async () =>
    {
        const directory = await scratchDirectory( {
            'oops.json': { casomerSchema: 1, kind: 'colection', label: 'Oops' },
        } );
        const issues: SchemaIssue[] = [];

        await loadContentDocuments( directory, issues, new Map() );
        assert.equal( issues.length, 1 );
        assert.match( issues[ 0 ]?.message ?? '', /collection/ );
    } );

    it( 'silently ignores files that are not ours', async () =>
    {
        const directory = await scratchDirectory( {
            'package.json': { name: 'somebody-elses' },
            'tsconfig.json': { compilerOptions: {} },
            'broken.json': '{ not json',
        } );
        const issues: SchemaIssue[] = [];
        const documents = await loadContentDocuments( directory, issues, new Map() );

        assert.deepEqual( issues, [] );
        assert.deepEqual( documents.collections, [] );
        assert.deepEqual( documents.taxonomies, [] );
    } );

    it( 'rejects unknown entry keys with the collection field vocabulary', async () =>
    {
        const directory = await scratchDirectory( {
            'events.json': {
                casomerSchema: 1,
                kind: 'collection',
                label: 'Events',
                fields: { title: 'text!' },
                entries: [ { id: 'aa11bb22-cc33-4d44-8e55-ff6677889900', title: 'Fair', titel: 'typo' } ],
            },
        } );
        const issues: SchemaIssue[] = [];

        await loadContentDocuments( directory, issues, new Map() );
        assert.equal( issues.length, 1 );
        assert.match( issues[ 0 ]?.message ?? '', /titel/ );
        assert.match( issues[ 0 ]?.message ?? '', /title/ );
    } );

    it( 'enforces global id uniqueness across pages and entries', async () =>
    {
        const directory = await scratchDirectory( {
            'events.json': {
                casomerSchema: 1,
                kind: 'collection',
                label: 'Events',
                entries: [ { id: 'aa11bb22-cc33-4d44-8e55-ff6677889900', title: 'Fair' } ],
            },
        } );
        const issues: SchemaIssue[] = [];
        const seen = new Map( [ [ 'aa11bb22-cc33-4d44-8e55-ff6677889900', 'pages[0]' ] ] );

        await loadContentDocuments( directory, issues, seen );
        assert.equal( issues.length, 1 );
        assert.match( issues[ 0 ]?.message ?? '', /globally unique/ );
    } );

    it( 'loads a taxonomy with its terms', async () =>
    {
        const directory = await scratchDirectory( {
            'venues.json': {
                casomerSchema: 1,
                kind: 'taxonomy',
                label: 'Venues',
                terms: [ { id: 'cc33dd44-ee55-4f66-8a77-889900aabbcc', name: 'The corner shop' } ],
            },
        } );
        const issues: SchemaIssue[] = [];
        const documents = await loadContentDocuments( directory, issues, new Map() );

        assert.deepEqual( issues, [] );
        assert.equal( documents.taxonomies[ 0 ]?.label, 'Venues' );
        assert.equal( documents.taxonomies[ 0 ]?.terms[ 0 ]?.name, 'The corner shop' );
    } );
} );
