// A universal conformance check: rendered component markup must be
// well-formed, because one unclosed tag corrupts every component after
// it on the page. This is a validator over output, not a render-path
// transformation, so the Alpine-untouched invariant is unaffected.
// Deliberately strict: components close what they open, explicitly;
// void elements and self-closing syntax are the only exemptions.

const voidElements = new Set( [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
] );

// Attribute values may contain ">", so the tag pattern consumes quoted
// spans opaquely.
const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;

export function checkMarkupBalance ( html: string ): string[]
{
    const source = html.replace( /<!--[\s\S]*?-->/g, '' );
    const problems: string[] = [];
    const openStack: string[] = [];

    for ( const match of source.matchAll( tagPattern ) )
    {
        const isCloser = match[ 1 ] === '/';
        const tag = ( match[ 2 ] as string ).toLowerCase();
        const attributes = ( match[ 3 ] ?? '' ) as string;
        const selfClosed = match[ 4 ] === '/' || /\/\s*$/.test( attributes );

        if ( isCloser )
        {
            const expected = openStack.pop();

            if ( expected === undefined )
            {
                problems.push( `</${tag}> closes nothing; there is no open tag.` );
            }
            else if ( expected !== tag )
            {
                problems.push( `</${tag}> closes <${expected}>; tags must close in the order they open.` );
            }

            continue;
        }

        if ( voidElements.has( tag ) || selfClosed ) { continue; }

        openStack.push( tag );
    }

    for ( const tag of openStack.reverse() )
    {
        problems.push( `<${tag}> is never closed.` );
    }

    return problems;
}
