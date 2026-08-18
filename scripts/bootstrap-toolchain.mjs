#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageSha256, TOOLCHAIN_PACKAGES, TOOLCHAIN_RECEIPT } from "./toolchain-source.mjs";

const websiteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [toolchainInput, ...extraArguments] = process.argv.slice(2);

if (!toolchainInput || extraArguments.length > 0) {
  throw new Error("Usage: npm run bootstrap:local -- /path/to/VelarScript");
}

const requestedRoot = isAbsolute(toolchainInput)
  ? toolchainInput
  : resolve(websiteRoot, toolchainInput);
const toolchainRoot = await realpath(requestedRoot);
if (!(await stat(toolchainRoot)).isDirectory()) {
  throw new Error("The VelarScript source path must be a directory");
}

const toolchainManifest = JSON.parse(await readFile(join(toolchainRoot, "package.json"), "utf8"));
if (toolchainManifest?.name !== "velarscript-workspace") {
  throw new Error("The source path is not a VelarScript workspace");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "velar-website-toolchain-"));
const releaseDirectory = join(temporaryRoot, "release");

try {
  await run(process.execPath, [
    join(toolchainRoot, "scripts", "release-toolchain.mjs"),
    "rehearse",
    "--output-dir",
    releaseDirectory,
  ], toolchainRoot);

  const release = JSON.parse(await readFile(join(releaseDirectory, "velar-toolchain-release.json"), "utf8"));
  if (release?.formatVersion !== 1
    || release?.kind !== "velar-toolchain-release"
    || release?.mode !== "rehearse"
    || release?.publish?.performed !== false
    || JSON.stringify(release?.packages?.map((item) => item.name)) !== JSON.stringify(TOOLCHAIN_PACKAGES)) {
    throw new Error("The VelarScript rehearsal manifest is incomplete or invalid");
  }

  const tarballs = release.packages.map((item) => join(releaseDirectory, item.fileName));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npm, [
    "install",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    "--",
    ...tarballs,
  ], websiteRoot);
  const nodeModules = join(websiteRoot, "node_modules");
  const packages = [];
  for (const package_ of release.packages) {
    packages.push({
      name: package_.name,
      version: package_.version,
      tarballSha256: package_.sha256,
      installedSha256: await installedPackageSha256(nodeModules, package_.name),
    });
  }
  const receipt = {
    formatVersion: 1,
    kind: "velarscript-website-toolchain-source",
    version: release.version,
    sourceRoot: toolchainRoot,
    source: release.source,
    packages,
  };
  const receiptPath = join(nodeModules, TOOLCHAIN_RECEIPT);
  const temporaryReceipt = `${receiptPath}.${process.pid}`;
  await writeFile(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await rename(temporaryReceipt, receiptPath);
  process.stdout.write(`Installed verified VelarScript toolchain ${release.version}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, arguments_, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}
