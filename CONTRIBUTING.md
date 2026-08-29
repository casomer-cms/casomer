# Contributing to Casomer

> **Casomer is in early active development and is not accepting code
> contributions yet.** This document describes how contributing will work
> once the first release lands. Until then, bug reports and ideas are
> welcome as [issues](https://github.com/casomer-cms/casomer/issues).

## The deal, plainly

Casomer is source-available under the
[Business Source License 1.1](./LICENSE.md). Development is funded by
commercial licenses and Casomer Cloud. Before you contribute, you should
understand exactly what that means for your work - no fine print, no
surprises later:

- **You keep the copyright to your contribution.** Nothing is assigned
  away. Your name stays in the git history, permanently.
- **You grant Casomer a license to your contribution** - perpetual,
  irrevocable, worldwide, royalty-free, and sublicensable, including the
  right to relicense it. This is what lets us ship your work under the
  BUSL, sell commercial licenses that include it, and convert it to MIT
  on schedule (see below). The agreement also includes a patent grant
  covering your contribution.
- **Your contribution becomes open source on a fixed timer.** Every
  version of Casomer automatically becomes MIT four years after that
  version is first published - each release carries its own four-year
  clock, written into its license text at release, not a promise we are
  asking you to take on faith. Every merged contribution is on the
  clock of the releases that include it.
- **Contributions are voluntary and unpaid.** There is no compensation,
  royalty, or ownership stake in Casomer, now or later.

If that deal does not sit right with you, we genuinely understand - it
is a real ask, and choosing not to contribute is a fair response to it.

## The CLA

The first time you open a pull request, a bot will ask you to sign the
Contributor License Agreement - once, covering all casomer-cms
repositories. There are two versions:

- **Individual** - you own your work and can license it.
- **Corporate** - your employer owns work you produce, so your employer
  signs. If you are contributing on the clock or in a field related to
  your job, check which applies to you before signing.

No pull request is merged without a signed CLA. This is not optional
paperwork: without it, we legally could not include your code in
commercial licenses or in the MIT conversion, and the project's model
would not work.

## Contributing code

1. **Open an issue first** for anything bigger than a small fix. Casomer
   declines features deliberately (see the README's non-goals) - a
   five-minute conversation beats a declined pull request.
2. **Fork, branch, and keep pull requests small and focused.** One
   change per PR.
3. **CI must pass.** Formatting, linting, and the test suites run on
   every pull request - including Casomer's machine-enforced rules
   (design-token purity in templates, accessibility checks, and
   friends). A failing check is a fix request, not a suggestion.
4. **A maintainer reviews and merges.** Review feedback aims to be
   specific and kind; we ask the same of responses to it.

## Code style

The codebase should read like it was written by one careful human
developer:

- Names are full words, descriptive in proportion to their scope.
- Functions are small and single-purpose.
- Comments say what the code cannot - constraints, invariants, the
  reason behind a non-obvious choice. No narration, no changelog
  archaeology.
- Plain human punctuation in comments, messages, and strings.
- Formatting is owned by the formatter and applies itself: editors
  with ESLint integration format on save (workspace settings are
  committed), and a pre-commit hook formats whatever you stage. You do
  not need to learn or apply the style - write code however you like
  and let the tooling dress it. CI is only the backstop.

## Conduct

Be kind, be specific, assume good faith. Maintainers will enforce that
in both directions.
