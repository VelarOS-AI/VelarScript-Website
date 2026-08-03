# Velar Website

[![Velar Website CI](https://github.com/VelarOS-AI/VelarScript-Website/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript-Website/actions/workflows/ci.yml)

The official Velar language and Web framework website. Runtime, components,
styles, content, tests, and pages are written in Velar; npm manifests and static
brand assets are the only non-Velar project files.

Contribution and private security-reporting expectations are recorded in
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

```sh
npm run bootstrap:local -- ../VelarScript
npm run dev
```

Until the first npm release, `bootstrap:local` accepts a VelarScript source
checkout, creates a verified non-publishing toolchain rehearsal, and installs
those exact compiler, Web framework, creator, and CLI packages without changing
this project's manifest or creating a lockfile. It never imports compiler
source directly. After the stable toolchain is published, ordinary
`npm install` becomes the only bootstrap command.

The project is organized bottom-up:

- `packages/ui`: private, theme-neutral accessibility, interaction, and layout
  primitives built from native browser behavior.
- `packages/site-ui`: VelarOS-aligned brand and marketing-site components built
  on the neutral primitives.
- `packages/docs-kit`: documentation navigation and content patterns composed
  from the UI and brand layers.
- `src`: official language content and product pages built from those packages.

`npm run packages:check` performs a dry package inventory for all three source
packages; `npm run validate` includes that gate before the production build.
The first interactive dogfood set covers disclosure, modal focus ownership,
checked DOM IDs, form field relationships, and framework-owned validation
errors.

The public CI pins the toolchain checkout to one exact source commit and runs
the same bootstrap, validation, production verification, and Chromium/Firefox/
WebKit browser suite used locally.

Prepare the provider-specific but still local external-preview candidate with:

```sh
npm run preview:prepare
```

This builds the site twice, verifies byte-for-byte reproducibility, then
atomically writes `release/external-preview/site` with Velar-owned `_headers`,
`_redirects`, CSP, asset hashes, and SPA fallback rules. It refuses to replace
an unrelated directory and does not deploy. Successful CI runs retain that
exact directory as a commit-named downloadable artifact.
After an explicitly authorized deployment, compare the hosted bytes, routes,
MIME types, and headers with the local candidate using:

```sh
npm run verify:deployment -- --url https://preview.example.com
```
