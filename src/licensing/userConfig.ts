// The user-level config (BUSINESS 5.3, EDITOR: the account badge):
// ~/.config/casomer/config.json, a person's, never a site's. The
// profile lives here (name, email, github, avatar), the supporter
// state (supporterConfirm, supporterWall, supporterMoments), and the
// licensing witnesses (grace, licenses). Site repos may be public, so
// nothing in here ever goes into a site folder.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type UserConfig = Record<string, unknown>;

export function userConfigDirectory (): string
{
    const override = process.env.CASOMER_CONFIG_DIR;

    // Tests point this somewhere disposable; a person's config is
    // never touched by a test.
    if ( typeof override === 'string' && override !== '' ) { return override; }

    return join( homedir(), '.config', 'casomer' );
}

export function userConfigFile (): string
{
    return join( userConfigDirectory(), 'config.json' );
}

export async function readUserConfig (): Promise<UserConfig>
{
    try
    {
        const value = JSON.parse( await readFile( userConfigFile(), 'utf8' ) ) as unknown;

        return value !== null && typeof value === 'object' && !Array.isArray( value ) ? value as UserConfig : {};
    }
    catch
    {
        return {};
    }
}

// Read, change, write: every writer goes through here so the file
// keeps its other keys and its four-space shape.
export async function updateUserConfig ( mutate: ( config: UserConfig ) => void ): Promise<UserConfig>
{
    const config = await readUserConfig();

    mutate( config );
    await mkdir( userConfigDirectory(), { recursive: true } );
    await writeFile( userConfigFile(), `${JSON.stringify( config, null, 4 )}\n`, 'utf8' );
    return config;
}

// A string-keyed record under a config key, or an empty one.
export function recordAt ( config: UserConfig, key: string ): Record<string, unknown>
{
    const value = config[ key ];

    return value !== null && typeof value === 'object' && !Array.isArray( value ) ? value as Record<string, unknown> : {};
}
