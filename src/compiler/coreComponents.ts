// The core components of SCHEMA section 1.1: present in every site, no
// install, versioned with caso, living in the reserved core/ id space.
// Core has no special powers: these load through the same manifest
// format and loader shape as any package component, from the
// core-components/ directory that ships inside the casomer package.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeComponentManifest } from '../schema/manifest.ts';
import { type LoadedComponent } from '../schema/loadPackage.ts';

const coreDirectory = fileURLToPath( new URL( '../../core-components/', import.meta.url ) );
const coreIds = [ 'markdown', 'image', 'link', 'heading' ];

export async function loadCoreComponents (): Promise<ReadonlyMap<string, LoadedComponent>>
{
    const components = new Map<string, LoadedComponent>();

    for ( const id of coreIds )
    {
        const directory = join( coreDirectory, id );
        const manifest = normalizeComponentManifest(
            JSON.parse( await readFile( join( directory, 'casomer.json' ), 'utf8' ) ),
        );

        components.set( id, {
            manifest,
            directory,
            templateFile: join( directory, manifest.templatePath ),
        } );
    }

    return components;
}
