// The caso CLI entry: a thin dispatcher over the verbs in commands.ts,
// invoked by bin/caso.js with type stripping enabled.

import { runBuild, runCredential, runInit, runPreview, runPublish, runSave, runStudio } from './commands.ts';

const [ , , command, ...rest ] = process.argv;

const verbs: Readonly<Record<string, ( argv: readonly string[] ) => Promise<number>>> = {
    studio: runStudio,
    save: runSave,
    build: runBuild,
    preview: runPreview,
    init: runInit,
    publish: runPublish,
    credential: runCredential,
};

try
{
    const verb = verbs[ command ?? '' ];

    if ( verb === undefined )
    {
        console.error( `Unknown command "${command ?? ''}". Available: ${Object.keys( verbs ).join( ', ' )}.` );
        process.exitCode = 1;
    }
    else
    {
        process.exitCode = await verb( rest );
    }
}
catch ( error )
{
    console.error( ( error as Error ).message );
    process.exitCode = 1;
}
