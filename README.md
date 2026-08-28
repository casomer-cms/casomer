<div align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/casomer-cms/website/main/docs/casomer-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/casomer-cms/website/main/docs/casomer-light.svg">
        <img alt="casomer" height="96" src="https://raw.githubusercontent.com/casomer-cms/website/main/docs/casomer-w-bg.svg">
    </picture>
    <div><a href="https://www.npmjs.com/package/casomer"><img alt="npm" src="https://img.shields.io/npm/v/casomer?label=npm&color=E8A13D"></a></div>
    <h2>The JSON-native CMS. Visual editing in, static sites out.</h2>
    <div><a href='https://ko-fi.com/G0G2231VF9' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi3.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a></div>
    <div><span>&nbsp;</span></div>
</div>

Your whole site - content, components, structure - lives as JSON. Publish compiles it to pre-rendered static HTML with view transitions that make static feel alive. Git-friendly. Self-host it, or let casomer cloud handle the nitty gritty.```

> ⚠️ **Casomer is in early active development.** Watch this repo or check [casomer.com](https://casomer.com) for the first real release.

## What Casomer will be

Casomer is a content management system with an unusual architecture: your entire site - structure, content, components, configuration - lives as JSON. Editing happens in a WYSIWYG editor (desktop app or web) with a live preview. Publishing compiles that JSON into fully static, pre-generated HTML served at the edge, enhanced with [Alpine.js](https://alpinejs.dev) and the browser-native [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) so static pages navigate like a fluid app.

- **JSON as the source of truth** - relational data, custom taxonomies, and post types via plain JSON files. Diffable, portable, Git-friendly.
- **Static output, dynamic feel** - pre-rendered HTML with smooth view transitions. No runtime database. Lightning fast by construction.
- **Component library** - install components, configure them visually, publish.
- **Easy development** - write your own components, an intuitive structure that can accomodate any idea.
- **Git-native** - every publish is a commit. Track, review, and revert your entire site's history. CI-friendly.
- **Self-host or SaaS** - run it yourself, or let Casomer Cloud handle the nitty gritty.

## Install

```bash
npm install -g casomer
cd my-project
caso
```

The `caso` command currently prints a friendly note. Soon it will build websites.

## License

Casomer will be **source-available**: free for personal use (including self-hosting), licensed for commercial use. Final license terms are being drafted - see [LICENSE.md](./LICENSE.md) for the current placeholder terms.

---

© Casomer™. All rights reserved.
