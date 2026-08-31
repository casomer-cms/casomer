// Component conformance is derived, never bespoke (DEVELOPMENT section
// 7): the manifest is the test generator, and this loop cannot tell
// whose component it is testing. Core components and the fixture
// package flow through the identical public mechanism; when the
// standard library and marketplace packages exist, they join the same
// loop unchanged. That is the whole point: no component of ours ever
// gets a test path a third-party author lacks.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCoreComponents } from './coreComponents.ts';
import { checkMarkupBalance } from './htmlWellFormed.ts';
import { renderComponentInstance } from './assemblePage.ts';
import { loadPackageFromDirectory, type LoadedComponent } from '../schema/loadPackage.ts';

const fixtureRoot = fileURLToPath( new URL( '../../fixtures/site-basic/', import.meta.url ) );

interface ConformanceSubject
{
    readonly origin: string;
    readonly component: LoadedComponent;
}

async function collectSubjects (): Promise<ConformanceSubject[]>
{
    const subjects: ConformanceSubject[] = [];

    for ( const component of ( await loadCoreComponents() ).values() )
    {
        subjects.push( { origin: 'core', component } );
    }

    const { loadedPackage } = await loadPackageFromDirectory( join( fixtureRoot, 'fixture-kit' ) );

    for ( const component of loadedPackage?.components.values() ?? [] )
    {
        subjects.push( { origin: loadedPackage?.manifest.name ?? '', component } );
    }

    return subjects;
}

const subjects = await collectSubjects();

describe( 'derived component conformance', () =>
{
    for ( const { origin, component } of subjects )
    {
        const reference = `${origin}/${component.manifest.id}`;

        it( `${reference}: every declared anchor exists in the template`, async () =>
        {
            const template = await readFile( component.templateFile, 'utf8' );

            for ( const anchor of component.manifest.anchors )
            {
                assert.ok(
                    template.includes( `data-anchor="${anchor.id}"` ),
                    `the anchor "${anchor.id}" is declared but not present; morph links attach to anchors, so a missing one is a broken promise`,
                );
            }
        } );

        it( `${reference}: declares each anchor exactly once in the template`, async () =>
        {
            const template = await readFile( component.templateFile, 'utf8' );

            for ( const anchor of component.manifest.anchors )
            {
                const occurrences = template.split( `data-anchor="${anchor.id}"` ).length - 1;

                assert.equal(
                    occurrences,
                    1,
                    `the anchor "${anchor.id}" appears ${occurrences} times; names must be unique per snapshot, so anchors are declared once`,
                );
            }
        } );

        it( `${reference}: ships at least one example`, () =>
        {
            assert.ok(
                component.manifest.examples.length > 0,
                'examples are the derived conformance fixtures, the editor preview, and the docs; a component without one is untestable and invisible',
            );
        } );

        for ( const example of component.manifest.examples )
        {
            it( `${reference}: renders the "${example.name}" example`, async () =>
            {
                const html = await renderComponentInstance( component, example.props );

                assert.ok( html.trim().length > 0, 'an example renders to markup, not to nothing' );
                assert.ok( !html.includes( 'undefined' ), 'no absent value leaks into output' );
                assert.deepEqual(
                    checkMarkupBalance( html ),
                    [],
                    'well-formed markup: one unclosed tag would corrupt every component after this one',
                );
            } );
        }
    }
} );
