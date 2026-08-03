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

Prepare the provider-neutral production candidate with:

```sh
npm run deploy:prepare
npm run deploy:smoke
```

This builds the site twice, verifies byte-for-byte reproducibility, then
atomically writes `release/deployment/site` with the Velar-owned neutral host
contract, CSP, asset hashes, caching, and SPA fallback rules. It refuses to replace
an unrelated directory and does not deploy. Successful CI runs retain that
exact directory as a commit-named downloadable artifact and publish a signed
GitHub/Sigstore provenance attestation for its `velar-build.json`; that manifest
contains the SHA-256 identity of every deployable asset.
`deploy:smoke` serves that candidate on an ephemeral loopback port and runs the
deployment verifier across the real HTTP file, route, MIME, and security-header
boundary; it always tears the preview process down afterward.

Production is independently hosted at <https://velarscript.velaros.cn>. The
repository-local deployment command archives the clean, pushed `main` commit,
reruns all validation against that snapshot, uploads it to the VelarOS production
server under `/opt/velarscript-website/releases/<commit>`, and atomically switches
the independent `current` link. It may reuse the SSH identity settings from the
VelarOS Website deployment file without sharing source code or release state:

```sh
VELARSCRIPT_DEPLOY_CONFIG=/path/to/velaros-website/.env.deploy.local npm run deploy:stage
VELARSCRIPT_DEPLOY_CONFIG=/path/to/velaros-website/.env.deploy.local npm run deploy:local
```

`deploy:stage` validates and uploads an immutable release without changing the
public pointer. It is used before the first Caddy/DNS activation. `deploy:local`
uploads the same source snapshot, atomically activates it, verifies the complete
public deployment contract, and confirms the remote pointer.

After deployment, compare the hosted bytes, routes, MIME types, and headers with
the exact local candidate using:

```sh
npm run verify:deployment -- --url https://velarscript.velaros.cn
```
