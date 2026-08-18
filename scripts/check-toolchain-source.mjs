#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installedPackageSha256,
  sourceTreeSha256,
  TOOLCHAIN_PACKAGES,
  TOOLCHAIN_RECEIPT,
} from "./toolchain-source.mjs";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = join(websiteRoot, "node_modules");
const receiptPath = join(nodeModules, TOOLCHAIN_RECEIPT);
let receipt;
try {
  receipt = JSON.parse(await readFile(receiptPath, "utf8"));
} catch (error) {
  throw new Error(`Installed VelarScript toolchain has no valid source receipt at '${receiptPath}'; run 'npm run bootstrap:local -- /path/to/VelarScript'`, { cause: error });
}

if (receipt?.formatVersion !== 1 || receipt?.kind !== "velarscript-website-toolchain-source") {
  throw new Error("Installed VelarScript toolchain source receipt has an unsupported shape");
}
const sourceRoot = await realpath(receipt.sourceRoot);
const liveTree = await sourceTreeSha256(sourceRoot);
if (liveTree !== receipt.source?.treeSha256) {
  throw new Error(`Installed compiler came from source tree ${receipt.source?.treeSha256 ?? "<missing>"}, but '${sourceRoot}' is now ${liveTree}; bootstrap again so the site and language are checked from one source`);
}
const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: sourceRoot, encoding: "utf8" });
if (head.status !== 0 || head.stdout.trim() !== receipt.source?.commit) {
  throw new Error(`Installed compiler records commit ${receipt.source?.commit ?? "<missing>"}, but the language source checkout is ${head.status === 0 ? head.stdout.trim() : "unreadable"}`);
}

const names = receipt.packages?.map((item) => item.name);
if (JSON.stringify(names) !== JSON.stringify(TOOLCHAIN_PACKAGES)) {
  throw new Error(`Installed toolchain receipt does not name the complete package set: ${JSON.stringify(names)}`);
}
for (const package_ of receipt.packages) {
  const manifest = JSON.parse(await readFile(join(nodeModules, ...package_.name.split("/"), "package.json"), "utf8"));
  if (manifest.name !== package_.name || manifest.version !== package_.version) {
    throw new Error(`${package_.name}: installed manifest does not match the source receipt`);
  }
  const installedSha256 = await installedPackageSha256(nodeModules, package_.name);
  if (installedSha256 !== package_.installedSha256) {
    throw new Error(`${package_.name}: installed files do not match the toolchain produced from '${sourceRoot}'`);
  }
}

console.log(`Checked installed VelarScript ${receipt.version} against language source ${receipt.source.commit} (${receipt.source.treeSha256})`);
