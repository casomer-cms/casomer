// The bake-off's shared input: the REAL card manifest, normalized by
// the REAL schema module, dumped as JSON for both lanes. The inspector
// in slice 3 consumes exactly this shape, so whatever each lane has to
// do here is what it would have to do for real.

import { readFile, writeFile } from 'node:fs/promises';

import { normalizeFields } from '../src/schema/fields.ts';

const cardManifest = JSON.parse(
    await readFile( new URL( '../fixtures/site-basic/fixture-kit/components/card/casomer.json', import.meta.url ), 'utf8' ),
);
const siteConfig = JSON.parse(
    await readFile( new URL( '../fixtures/site-basic/content/site.json', import.meta.url ), 'utf8' ),
);

// The stress default: 200 repeater items, so both lanes carry the
// same heavy list from first paint and the preview renders it all.
const initialProps = structuredClone( cardManifest.examples[ 1 ].props );

initialProps.faqs = Array.from( { length: 200 }, ( _, index ) => ( {
    question: `Question ${index + 1}`,
    answer: `Answer **${index + 1}** of two hundred.`,
} ) );

const manifest = {
    id: cardManifest.id,
    title: cardManifest.title,
    packageName: 'fixture-kit',
    fields: normalizeFields( cardManifest.fields ),
    initialProps,
    tokens: {
        widths: siteConfig.theme.widths,
    },
};

await writeFile( new URL( './manifest.json', import.meta.url ), JSON.stringify( manifest, null, 4 ) + '\n', 'utf8' );
console.log( 'manifest.json written' );
