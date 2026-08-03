#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectManifest = join(websiteRoot, "velar.json");
const defaultOutput = join(websiteRoot, "release", "deployment", "site");
const cli = join(websiteRoot, "node_modules", "@velarscript", "cli", "dist", "cli.js");

export async function prepareDeployment(outputDirectory = defaultOutput) {
  const output = resolve(outputDirectory);
  await assertReplaceableOutput(output);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.velar-${basename(output)}-`));

  try {
    const first = join(staging, "first");
    const second = join(staging, "second");
    const firstBuild = await buildAndVerify(first);
    const secondBuild = await buildAndVerify(second);
    if (firstBuild.buildId !== secondBuild.buildId) {
      throw new Error("deployment builds produced different build identities");
    }

    const firstInventory = await inventory(first);
    const secondInventory = await inventory(second);
    if (JSON.stringify(firstInventory) !== JSON.stringify(secondInventory)) {
      throw new Error("deployment builds are not byte-for-byte reproducible");
    }

    await assertReplaceableOutput(output);
    await rm(output, { recursive: true, force: true });
    await rename(first, output);
    return {
      outputDirectory: output,
      buildId: firstBuild.buildId,
      files: firstInventory.length,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildAndVerify(directory) {
  await runCli(["build", projectManifest, "--out-dir", directory]);
  await runCli(["verify", directory]);
  const manifest = JSON.parse(await readFile(join(directory, "velar-build.json"), "utf8"));
  const deployment = JSON.parse(await readFile(join(directory, "velar-deploy.json"), "utf8"));
  if (manifest?.formatVersion !== 3
    || manifest?.kind !== "velar-framework-build"
    || manifest?.framework?.id !== "@velarscript/web"
    || manifest?.framework?.apiVersion !== "0.8"
    || manifest?.sourceMaps !== false
    || typeof manifest?.buildId !== "string"
    || !/^[0-9a-f]{64}$/u.test(manifest.buildId)
    || deployment?.formatVersion !== 2
    || deployment?.kind !== "velar-static-deployment"
    || deployment?.base !== "/"
    || deployment?.adapter !== null) {
    throw new Error("deployment candidate does not match the self-hosted Website contract");
  }
  return manifest;
}

async function assertReplaceableOutput(output) {
  const rootWithinOutput = relative(output, websiteRoot);
  if (dirname(output) === output
    || rootWithinOutput === ""
    || (!rootWithinOutput.startsWith("..") && !isAbsolute(rootWithinOutput))) {
    throw new Error(`refusing unsafe deployment output '${output}'`);
  }

  try {
    const information = await lstat(output);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`deployment output '${output}' exists and is not a real directory`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  try {
    await runCli(["verify", output]);
    const deployment = JSON.parse(await readFile(join(output, "velar-deploy.json"), "utf8"));
    if (deployment?.adapter !== null || deployment?.base !== "/") throw new Error("wrong deployment contract");
  } catch {
    throw new Error(`refusing to replace '${output}' because it is not an existing Website deployment candidate`);
  }
}

async function inventory(root) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("deployment output cannot contain symbolic links");
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const body = await readFile(path);
        files.push({
          path: relative(root, path).replaceAll("\\", "/"),
          sizeBytes: body.byteLength,
          sha256: createHash("sha256").update(body).digest("hex"),
        });
      } else {
        throw new Error("deployment output can contain only files and directories");
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function runCli(arguments_) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: websiteRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`velar ${arguments_[0]} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}\n${stdout}\n${stderr}`));
    });
  });
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return defaultOutput;
  if (arguments_.length === 2 && arguments_[0] === "--output-dir" && arguments_[1]) {
    return resolve(websiteRoot, arguments_[1]);
  }
  throw new Error("Usage: npm run deploy:prepare -- [--output-dir <directory>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareDeployment(parseArguments(process.argv.slice(2)));
    process.stdout.write(`Prepared reproducible Velar Website deployment ${result.buildId} (${result.files} files) -> ${result.outputDirectory}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
