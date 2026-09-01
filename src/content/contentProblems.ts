// Required-field problems across a site's collections (SCHEMA
// sections 2 and 3, enforcement doctrine): computed identically for
// the build (where they refuse a publish) and for Studio (where they
// power the save speed bump and the abandon prompt). Cheap on
// purpose - no rendering, just values against fields.

import { missingRequiredFields } from '../resolver/resolvePayload.ts';
import { type SchemaIssue } from '../schema/manifest.ts';
import { type LoadedCollection } from './contentDocuments.ts';

export function entryRequiredProblems ( collections: readonly LoadedCollection[] ): SchemaIssue[]
{
    const problems: SchemaIssue[] = [];

    for ( const collection of collections )
    {
        const stem = collection.file.replace( /\.json$/, '' );

        for ( const [ index, entry ] of collection.entries.entries() )
        {
            // A draft is parked: omitted from the output, exempt from
            // enforcement until its draft switch clears.
            if ( entry.draft === true ) { continue; }

            for ( const problem of missingRequiredFields( collection.fields, entry.values ) )
            {
                problems.push( {
                    path: `${stem}.entries[${index}].${problem.key}`,
                    message: `"${problem.label}" is required and empty on "${String( entry.values.title ?? '' ) || 'an untitled entry'}".`,
                } );
            }
        }
    }

    return problems;
}
