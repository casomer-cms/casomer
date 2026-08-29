import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeComponentManifest,
    normalizePackageManifest,
    parseComponentReference,
    ManifestSchemaError,
    ComponentReferenceError,
    type SchemaIssue,
} from './manifest.ts';

const issuesFrom = ( work: () => unknown ): SchemaIssue[] =>
{
    try
    {
        work();
        return [];
    }
    catch ( error )
    {
        if ( error instanceof ManifestSchemaError ) { return [ ...error.issues ]; }

        throw error;
    }
};

// The core/markdown manifest from SCHEMA appendix A, abbreviated.
const markdownManifest = {
    id: 'markdown',
    title: 'Markdown',
    description: 'Write Markdown, get clean HTML.',
    template: './template.html',
    fields: {
        content: { type: 'markdown', required: true, label: 'Content' },
        width: { type: 'select', label: 'Measure', options: { fromTokens: 'widths' }, default: 'prose' },
    },
    anchors: [ { id: 'first-heading', label: 'First heading', kind: 'text' } ],
};

describe( 'normalizeComponentManifest', () =>
{
    it( 'normalizes the appendix A markdown manifest', () =>
    {
        const manifest = normalizeComponentManifest( markdownManifest );

        assert.equal( manifest.id, 'markdown' );
        assert.equal( manifest.templatePath, './template.html' );
        assert.equal( manifest.fields.content?.type, 'markdown' );
        assert.deepEqual( manifest.anchors, [ { id: 'first-heading', label: 'First heading', kind: 'text' } ] );
    } );

    it( 'rejects unknown manifest keys with a suggestion', () =>
    {
        const [ issue ] = issuesFrom( () => normalizeComponentManifest( { ...markdownManifest, anchros: [] } ) );

        assert.equal( issue?.path, 'manifest.anchros' );
        assert.ok( issue?.message.includes( 'Did you mean "anchors"?' ) );
    } );

    it( 'requires id, title, template, and fields', () =>
    {
        const issues = issuesFrom( () => normalizeComponentManifest( {} ) );

        assert.deepEqual(
            issues.map( ( issue ) => issue.path ).sort(),
            [ 'manifest.fields', 'manifest.id', 'manifest.template', 'manifest.title' ],
        );
    } );

    it( 'rejects component ids outside the lowercase-hyphen shape', () =>
    {
        const [ issue ] = issuesFrom( () => normalizeComponentManifest( { ...markdownManifest, id: 'CardGrid' } ) );

        assert.ok( issue?.message.includes( 'card-grid' ) );
    } );

    it( 'rejects template paths that are not ./-relative', () =>
    {
        const [ issue ] = issuesFrom( () => normalizeComponentManifest( { ...markdownManifest, template: 'template.html' } ) );

        assert.equal( issue?.path, 'manifest.template' );
    } );

    it( 'surfaces field problems with manifest-rooted paths', () =>
    {
        const broken = { ...markdownManifest, fields: { body: 'markdwon' } };
        const [ issue ] = issuesFrom( () => normalizeComponentManifest( broken ) );

        assert.equal( issue?.path, 'manifest.fields.body' );
        assert.ok( issue?.message.includes( 'markdown' ) );
    } );

    it( 'rejects duplicate anchor ids and strict-checks anchor keys', () =>
    {
        const issues = issuesFrom( () => normalizeComponentManifest( {
            ...markdownManifest,
            anchors: [
                { id: 'image', labell: 'Image' },
                { id: 'image' },
            ],
        } ) );

        assert.ok( issues.some( ( issue ) => issue.message.includes( 'Did you mean "label"?' ) ) );
        assert.ok( issues.some( ( issue ) => issue.message.includes( 'Duplicate anchor id' ) ) );
    } );

    it( 'defaults anchor labels from the id', () =>
    {
        const manifest = normalizeComponentManifest( {
            ...markdownManifest,
            anchors: [ { id: 'first-heading' } ],
        } );

        assert.equal( manifest.anchors[ 0 ]?.label, 'First Heading' );
    } );
} );

describe( 'normalizePackageManifest', () =>
{
    const packageManifest = {
        schema: 1,
        name: '@casomer/components',
        components: [ './components/markdown', './components/hero' ],
    };

    it( 'normalizes the section 1 package manifest', () =>
    {
        const manifest = normalizePackageManifest( packageManifest );

        assert.equal( manifest.schemaVersion, 1 );
        assert.equal( manifest.name, '@casomer/components' );
        assert.deepEqual( manifest.componentPaths, [ './components/markdown', './components/hero' ] );
    } );

    it( 'rejects unknown schema versions by naming the mismatch', () =>
    {
        const [ issue ] = issuesFrom( () => normalizePackageManifest( { ...packageManifest, schema: 2 } ) );

        assert.ok( issue?.message.includes( 'schema 1' ) );
        assert.ok( issue?.message.includes( 'newer Casomer' ) );
    } );

    it( 'reserves the core package name', () =>
    {
        const [ issue ] = issuesFrom( () => normalizePackageManifest( { ...packageManifest, name: 'core' } ) );

        assert.ok( issue?.message.includes( 'reserved' ) );
    } );

    it( 'rejects invalid npm names, empty component lists, and duplicates', () =>
    {
        assert.ok( issuesFrom( () => normalizePackageManifest( { ...packageManifest, name: 'Not A Name' } ) )
            .some( ( issue ) => issue.message.includes( 'npm package name' ) ) );

        assert.ok( issuesFrom( () => normalizePackageManifest( { ...packageManifest, components: [] } ) )
            .some( ( issue ) => issue.path === 'manifest.components' ) );

        assert.ok( issuesFrom( () => normalizePackageManifest( { ...packageManifest, components: [ './a', './a' ] } ) )
            .some( ( issue ) => issue.message.includes( 'Duplicate' ) ) );
    } );
} );

describe( 'parseComponentReference', () =>
{
    it( 'parses core, scoped, and unscoped references', () =>
    {
        assert.deepEqual(
            parseComponentReference( 'core/markdown' ),
            { packageName: 'core', componentId: 'markdown' },
        );
        assert.deepEqual(
            parseComponentReference( '@casomer/components/hero' ),
            { packageName: '@casomer/components', componentId: 'hero' },
        );
        assert.deepEqual(
            parseComponentReference( 'bigkit/card-grid' ),
            { packageName: 'bigkit', componentId: 'card-grid' },
        );
    } );

    it( 'rejects references without a package or without an id', () =>
    {
        assert.throws( () => parseComponentReference( 'markdown' ), ComponentReferenceError );
        assert.throws( () => parseComponentReference( 'core/' ), ComponentReferenceError );
        assert.throws( () => parseComponentReference( '/markdown' ), ComponentReferenceError );
    } );

    it( 'rejects invalid package names and component ids', () =>
    {
        assert.throws( () => parseComponentReference( 'Bad Name/hero' ), ComponentReferenceError );
        assert.throws( () => parseComponentReference( 'kit/Hero!' ), ComponentReferenceError );
    } );
} );
