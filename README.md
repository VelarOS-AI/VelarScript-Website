# VelarScript Website

[![VelarScript Website CI](https://github.com/VelarOS-AI/VelarScript-Website/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript-Website/actions/workflows/ci.yml)

The official VelarScript site: a language guide, a library and toolchain
reference, and the example index. Its pages, components, controlled Look styles,
navigation data, and tests are written in VelarScript; repository automation
stays in small explicit JavaScript and shell scripts.

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
- `packages/site-ui`: the paper, ink, and sea foundation, the locale composer,
  the syntax renderer, and the page-level primitives built on those primitives.
- `packages/docs-kit`: the documentation shell, page header, section list,
  code block, callout, member table, and chapter pager.
- `src`: the site itself — `content.vel` declares the navigation, `app.vel`
  declares the routes, and `src/pages` holds one module per page.

The information architecture is three sections. `/guide` is one ordered chain
of thirty chapters — four for getting started, thirteen for the language, and
thirteen for the Web extension — declared once in `content.vel` so the sidebar
and the chapter pager read the same list. `/reference` is nine pages covering
the library contract, the resident namespaces, the pure and capability modules,
the CLI, the project manifest, the escape hatches, and the Desktop extension.
`/examples` indexes the applications kept in the language repository.

Every code block on the site is compiled before it can be published.
`npm run samples:check` reads each sample from the page that declares it and
decides what to do with it from the constant's name suffix: `*ShellCode`,
`*TextCode`, `*JsonCode`, `*TreeCode`, `*JsCode`, `*TsCode`, `*CssCode`, and
`*HtmlCode` are not VelarScript and are skipped; `*AppCode` is checked as a
complete web program; `*NodeCode` and `*DesktopCode` are checked against those
targets; `*ErrorCode` is a teaching counter-example that must still produce a
diagnostic, and every `VEL` code quoted in a same-prefix `*ErrorOutput` constant
must appear in the diagnostics that sample really produces; every other `*Code`
must compile with no diagnostics. There is no central registry to keep in sync.

`npm run packages:check` performs a dry package inventory for all three source
packages; `npm run validate` includes that gate before the production build.

The public CI pins the toolchain checkout to one exact source commit and runs
the same bootstrap, validation, production verification, and Chromium/Firefox/
WebKit browser suite used locally.

Prepare the provider-neutral production candidate with:

```sh
npm run deploy:prepare
npm run deploy:smoke
```

This builds the site twice, verifies byte-for-byte reproducibility, then
atomically writes `release/deployment/site` with the VelarScript-owned neutral host
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
