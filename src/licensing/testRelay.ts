// Test support: a stand-in for casomer.com's relay on a local port,
// answering the routes caso calls with one of a few moods, so the
// tests that need the registry's word (revocation at publish, the
// subscription behind a supporter key, the portal) never leave the
// machine. Point CASOMER_RELAY_ORIGIN at .origin for the test's life.

import { createServer, type Server } from 'node:http';

export type RelayMood = 'valid' | 'subscribed' | 'revoked' | 'unknown' | 'down' | 'silent';

export interface TestRelay
{
    readonly origin: string;
    mood: RelayMood;
    readonly seen: { path: string; body: Record<string, unknown> }[];
    close (): Promise<void>;
}

export async function startTestRelay ( mood: RelayMood = 'valid' ): Promise<TestRelay>
{
    const seen: { path: string; body: Record<string, unknown> }[] = [];
    const state = { mood };
    const server: Server = createServer( ( request, response ) =>
    {
        let raw = '';

        request.on( 'data', ( chunk: Buffer ) => { raw += chunk.toString( 'utf8' ); } );
        request.on( 'end', () =>
        {
            const body = raw === '' ? {} : JSON.parse( raw ) as Record<string, unknown>;

            seen.push( { path: request.url ?? '', body } );

            if ( state.mood === 'silent' ) { return; }

            if ( state.mood === 'down' )
            {
                response.writeHead( 530, { 'content-type': 'text/plain' } );
                response.end( 'error code: 1016' );

                return;
            }

            const valid = state.mood === 'valid' || state.mood === 'subscribed';
            const answers: Record<string, unknown> = {
                '/api/keys/verify': valid
                    ? { valid: true, revoked: false, subscription: state.mood === 'subscribed' }
                    : ( state.mood === 'revoked' ? { valid: false, revoked: true, reason: 'revoked' } : { valid: false, revoked: false, reason: 'unknown' } ),
                '/api/licenses/activate': { activated: valid },
                '/api/supporters/wall': { saved: valid, removed: valid },
                '/api/billing/portal': state.mood === 'subscribed' ? { url: 'https://billing.stripe.com/p/session/test' } : { error: 'no subscription behind that key' },
            };
            const answer = answers[ request.url ?? '' ];
            const status = request.url === '/api/billing/portal' && state.mood !== 'subscribed' ? 404 : ( answer === undefined ? 404 : 200 );

            response.writeHead( status, { 'content-type': 'application/json' } );
            response.end( JSON.stringify( answer ?? { error: 'no such route' } ) );
        } );
    } );

    await new Promise<void>( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    return {
        origin: `http://127.0.0.1:${port}`,
        get mood () { return state.mood; },
        set mood ( next: RelayMood ) { state.mood = next; },
        seen,
        close: async () =>
        {
            server.closeAllConnections();
            await new Promise<void>( ( resolve ) => server.close( () => resolve() ) );
        },
    };
}
