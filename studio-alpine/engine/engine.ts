// The preview engine: the PRODUCT's own render path, bundled for the
// browser. This is the piece that is identical whichever chrome
// framework wins: parse once, then per edit resolve, compile markdown,
// render, morph. The chrome only posts props at it.

// The bake-off's own copy of the card template: every FAQ row renders
// a visible line even while empty, so added items always show in the
// preview. (The fixture's template stays snapshot-pinned.)
import templateText from './card-template.html?raw';
import cardManifest from '../../fixtures/site-basic/fixture-kit/components/card/casomer.json';
import morphPlugin from '@alpinejs/morph';

import { parseTemplate, renderTemplate } from '../../src/compiler/template.ts';
import { compileMarkdownFields } from '../../src/compiler/assemblePage.ts';
import { resolveRenderPayload, type RenderPayload } from '../../src/resolver/resolvePayload.ts';
import { normalizeFields } from '../../src/schema/fields.ts';

const fields = normalizeFields( ( cardManifest as { fields: unknown } ).fields );
const template = parseTemplate( templateText );

export { morphPlugin };

export function renderCard ( props: Record<string, unknown> ): string
{
    const payload = compileMarkdownFields( fields, resolveRenderPayload( fields, props ) as RenderPayload );

    return renderTemplate( template, payload, fields );
}
