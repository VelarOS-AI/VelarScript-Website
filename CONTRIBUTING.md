# Contributing to the Velar Website

The Website is both product documentation and a real Velar application. It
must remain buildable from public source without local compiler links.

During the pre-release phase, clone the VelarScript toolchain beside this
repository and run:

```sh
npm run bootstrap:local -- ../VelarScript
npm run validate
npm run deploy:prepare
npm run deploy:smoke
npm run test:browser:all
```

Build reusable behavior from `packages/ui` upward through `packages/site-ui`
and `packages/docs-kit`; pages should compose those layers rather than duplicate
their behavior. Accessibility relationships, keyboard paths, focus ownership,
and responsive behavior require browser coverage. If the Website exposes a
language or Web API problem, fix it in VelarScript and pin the Website CI to the
new verified source identity instead of hiding it here.

Do not deploy the Website, change its future canonical domain, or publish its
component packages without explicit authorization.

For delivery review, download the commit-named CI artifact, run `velar verify`
against the extracted directory, and verify `velar-build.json` with GitHub's
artifact-attestation command. A provider must deploy those verified bytes
without rebuilding them.
