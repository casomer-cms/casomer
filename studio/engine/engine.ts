// The canvas engine (DEVELOPMENT sections 5 and 6.1): the PRODUCT's
// own render path - template parser, resolver, markdown pass - bundled
// for the browser, plus the morph plugin the canvas applies updates
// with. This is what makes editing per-keystroke: the chrome renders
// the edited block here and the bridge morphs it into the live canvas,
// so Alpine state, focus, and scroll survive the update.

import morphPlugin from '@alpinejs/morph';

import { parseTemplate, renderTemplate, type TemplateNode } from '../../src/compiler/template.ts';
import { compileMarkdownFields } from '../../src/compiler/assemblePage.ts';
import { resolveRenderPayload, type RenderPayload } from '../../src/resolver/resolvePayload.ts';
import { type NormalizedFields } from '../../src/schema/fields.ts';

export { morphPlugin };

export interface BlockRenderer
{
    render ( props: Record<string, unknown> ): string;
}

export function createBlockRenderer ( fields: NormalizedFields, templateText: string ): BlockRenderer
{
    const template: readonly TemplateNode[] = parseTemplate( templateText );

    return {
        render ( props )
        {
            const payload = compileMarkdownFields( fields, resolveRenderPayload( fields, props ) as RenderPayload );

            return renderTemplate( template, payload, fields );
        },
    };
}
