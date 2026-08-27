# Casomer

**The JSON-native CMS. Visual editing in, static sites out — with view transitions that make static feel alive.**

> ⚠️ **Status: in active development.** This package currently reserves the `casomer` name and the `caso` CLI command. Watch this repo or check [casomer.com](https://casomer.com) for the first real release.

## What Casomer will be

Casomer is a content management system with an unusual architecture: your entire site — structure, content, components, configuration — lives as JSON. Editing happens in a WYSIWYG editor (desktop app or web) with a live preview. Publishing compiles that JSON into fully static, pre-generated HTML served at the edge, enhanced with [Alpine.js](https://alpinejs.dev) and the browser-native [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) so static pages navigate like a fluid app.

- **JSON as the source of truth** — relational data, custom taxonomies, and post types via plain JSON files. Diffable, portable, Git-friendly.
- **Static output, dynamic feel** — pre-rendered HTML with smooth view transitions. No runtime database. Lightning fast by construction.
- **Component library** — install components, configure them visually, publish.
- **Git-native** — every publish is a commit. Track, review, and revert your entire site's history. CI-friendly.
- **Self-host or SaaS** — run it yourself, or let Casomer Cloud handle the nitty gritty.

## Install (placeholder)

```bash
npm install -g casomer
caso
```

The `caso` command currently prints a friendly note. Soon it will build websites.

## Etymology

A *casomer* would be, in the tradition of isomers and metamers, a structure that presents different forms from the same underlying parts. By happy accident, *časoměr* is also Czech for "timekeeper." We found out after choosing the name. We kept it.

## License

Casomer will be **source-available**: free for personal use (including self-hosting), licensed for commercial use. Final license terms are being drafted — see [LICENSE.md](./LICENSE.md) for the current placeholder terms.

---

© Casomer. All rights reserved (for now — see above).
