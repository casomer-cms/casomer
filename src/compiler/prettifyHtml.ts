// The pretty build path: caso build --pretty produces genuinely
// pretty-printed pages, not merely unminified ones. Raw assembled HTML
// is a concatenation of scaffold indentation, template authoring, and
// markdown renderer output, so its whitespace is ragged; prettifying
// first collapses it (the same rendering-lossless normalization the
// minifier uses) and then re-indents with js-beautify's HTML beautifier
// at the house four spaces. This is the DEVELOPMENT section 8 shelf
// note about js-beautify, cashed in.

import beautifyPackage from 'js-beautify';

import { minifyHtml } from './minifyHtml.ts';

const beautifyHtml = beautifyPackage.html;

export function prettifyHtml ( html: string ): string
{
    const pretty = beautifyHtml( minifyHtml( html ), {
        indent_size: 4,
        wrap_line_length: 0,
        preserve_newlines: false,
        end_with_newline: true,
    } );

    return pretty;
}
