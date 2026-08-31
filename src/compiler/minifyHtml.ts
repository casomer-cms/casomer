// HTML minification for compiled pages (DEVELOPMENT section 8: source is
// spacious, artifacts are minified). Deliberately conservative: a
// whitespace run containing a newline collapses to a single space, which
// is what normal HTML flow renders it as - and to nothing at all when
// either neighbor is a block-level tag, because whitespace at a block
// boundary never renders: leading space after a block opens, trailing
// space before one closes, space between blocks. Only whitespace whose
// neighbors are both inline content renders, and that always survives
// as its single space, so rendered flow never changes. Three regions are never
// touched: pre, textarea, script, and style content; and quoted
// attribute values, so an Alpine expression is passed through byte for
// byte no matter what it contains. caso build --pretty skips
// minification via prettifyHtml; the readable build is the
// pretty-printer.

// Elements that participate in inline text flow: whitespace beside them
// is meaningful and always survives as a single space.
const inlineElements = new Set( [
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data',
    'del', 'dfn', 'em', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'map',
    'mark', 'meter', 'output', 'picture', 'progress', 'q', 'rp', 'rt',
    'ruby', 's', 'samp', 'select', 'slot', 'small', 'span', 'strong',
    'sub', 'sup', 'svg', 'textarea', 'time', 'u', 'var', 'wbr',
] );

// Content copied verbatim, whitespace and all.
const protectedElements = new Set( [ 'pre', 'textarea', 'script', 'style' ] );

const tagNamePattern = /^<\/?!?([a-zA-Z][a-zA-Z0-9-]*)/;

function tagNameAt ( html: string, index: number ): string
{
    return tagNamePattern.exec( html.slice( index, index + 32 ) )?.[ 1 ]?.toLowerCase() ?? '';
}

// A single left-to-right pass tracking tag, quote, and protected-element
// context, so whitespace decisions always see their real neighbors.
export function minifyHtml ( html: string ): string
{
    const output: string[] = [];
    let inTag = false;
    let quote = '';
    let lastTagName = '';
    let pendingTagName = '';
    let index = 0;

    while ( index < html.length )
    {
        const character = html[ index ] as string;

        if ( quote !== '' )
        {
            output.push( character );

            if ( character === quote ) { quote = ''; }

            index += 1;
            continue;
        }

        if ( inTag && ( character === '"' || character === '\'' ) )
        {
            quote = character;
            output.push( character );
            index += 1;
            continue;
        }

        if ( character === '<' )
        {
            inTag = true;
            pendingTagName = tagNameAt( html, index );

            if ( protectedElements.has( pendingTagName ) && html[ index + 1 ] !== '/' )
            {
                const closer = new RegExp( `</${pendingTagName}\\s*>`, 'i' );
                const closerMatch = closer.exec( html.slice( index ) );
                const end = closerMatch === null ? html.length : index + closerMatch.index + closerMatch[ 0 ].length;

                output.push( html.slice( index, end ) );
                lastTagName = pendingTagName;
                inTag = false;
                index = end;
                continue;
            }
        }

        if ( character === '>' )
        {
            inTag = false;
            lastTagName = pendingTagName;
        }

        if ( character === ' ' || character === '\t' || character === '\n' || character === '\r' )
        {
            let end = index;
            let sawNewline = false;

            while ( end < html.length && /[ \t\n\r]/.test( html[ end ] as string ) )
            {
                if ( html[ end ] === '\n' ) { sawNewline = true; }

                end += 1;
            }

            // Whitespace at a block boundary never renders; only a run
            // flanked by inline content on both sides is meaningful.
            const previousCharacter = output[ output.length - 1 ]?.slice( -1 ) ?? '';
            const nextTagName = html[ end ] === '<' ? tagNameAt( html, end ) : '';
            const previousIsBlockTag = previousCharacter === '>'
                && lastTagName !== '' && !inlineElements.has( lastTagName );
            const nextIsBlockTag = nextTagName !== '' && !inlineElements.has( nextTagName );

            if ( !previousIsBlockTag && !nextIsBlockTag )
            {
                output.push( sawNewline || end - index > 1 ? ' ' : character );
            }

            index = end;
            continue;
        }

        output.push( character );
        index += 1;
    }

    return `${output.join( '' ).trim()}\n`;
}
