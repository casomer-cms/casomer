// caso preview (SCHEMA section 15): serves the built dist/ locally, for
// verifying output as delivered. Zero dependencies: a static file server
// is well within the platform. Binds 127.0.0.1 only; this is a local
// verification tool, never a deployed service.

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const contentTypes: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
};

export interface PreviewServer
{
    readonly url: string;
    readonly port: number;
    close (): Promise<void>;
}

function candidateFiles ( urlPath: string ): string[]
{
    if ( urlPath.endsWith( '/' ) ) { return [ `${urlPath}index.html` ]; }

    return extname( urlPath ) === '' ? [ `${urlPath}/index.html`, urlPath ] : [ urlPath ];
}

function resolveWithin ( root: string, urlPath: string ): string | undefined
{
    const resolved = normalize( join( root, ...urlPath.split( '/' ).filter( ( part ) => part !== '' ) ) );

    return resolved === root || resolved.startsWith( root + sep ) ? resolved : undefined;
}

export function startPreviewServer ( directory: string, port = 0 ): Promise<PreviewServer>
{
    const root = normalize( directory );

    const server: Server = createServer( ( request, response ) =>
    {
        void ( async () =>
        {
            const urlPath = decodeURIComponent( new URL( request.url ?? '/', 'http://localhost' ).pathname );

            for ( const candidate of candidateFiles( urlPath ) )
            {
                const file = resolveWithin( root, candidate );

                if ( file === undefined ) { continue; }

                try
                {
                    const body = await readFile( file );

                    response.writeHead( 200, { 'content-type': contentTypes[ extname( file ) ] ?? 'application/octet-stream' } );
                    response.end( body );
                    return;
                }
                catch { /* try the next candidate */ }
            }

            response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
            response.end( 'Not found.' );
        } )();
    } );

    return new Promise( ( resolve, reject ) =>
    {
        server.once( 'error', reject );
        server.listen( port, '127.0.0.1', () =>
        {
            const address = server.address();
            const boundPort = typeof address === 'object' && address !== null ? address.port : port;

            resolve( {
                url: `http://127.0.0.1:${boundPort}/`,
                port: boundPort,
                close: () => new Promise( ( closed ) => server.close( () => closed() ) ),
            } );
        } );
    } );
}
