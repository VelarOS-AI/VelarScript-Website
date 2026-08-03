#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidate = join(websiteRoot, "release", "deployment", "site");
const cli = join(websiteRoot, "node_modules", "@velarscript", "cli", "dist", "cli.js");
const manifest = JSON.parse(await readFile(join(candidate, "velar-build.json"), "utf8"));
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, [cli, "preview", candidate, "--port", String(port)], {
  cwd: websiteRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
let previewOutput = "";
let previewError = "";
preview.stdout.on("data", (chunk) => {
  previewOutput = appendBounded(previewOutput, chunk);
});
preview.stderr.on("data", (chunk) => {
  previewError = appendBounded(previewError, chunk);
});

try {
  await waitUntilReady(preview, () => previewOutput.includes("Velar production preview:"));
  const verification = await runCli([
    "verify-deployment",
    candidate,
    "--url",
    origin,
    "--json",
  ]);
  const report = JSON.parse(verification.stdout);
  if (report?.formatVersion !== 1
    || report?.kind !== "velar-deployment-verification"
    || report?.target?.origin !== origin
    || report?.build?.buildId !== manifest.buildId
    || !Number.isSafeInteger(report?.checks?.files) || report.checks.files <= 0
    || !Number.isSafeInteger(report?.checks?.routes) || report.checks.routes <= 0
    || !Number.isSafeInteger(report?.checks?.headers) || report.checks.headers <= 0) {
    throw new Error("the local deployment server returned an incomplete verification report");
  }
  process.stdout.write(
    `Verified Website deployment ${manifest.buildId} over HTTP `
    + `(${report.checks.files} files, ${report.checks.routes} routes, ${report.checks.headers} headers)\n`,
  );
} finally {
  await terminate(preview);
}

function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("could not reserve a loopback deployment port"));
        return;
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

function waitUntilReady(child, ready) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      child.off("error", failed);
      child.off("exit", exited);
      error ? rejectReady(error) : resolveReady();
    };
    const inspect = () => {
      if (ready()) finish();
    };
    const failed = (error) => finish(error);
    const exited = (code, signal) => finish(new Error(
      `deployment server exited before readiness${signal ? ` with signal ${signal}` : ` with exit code ${code}`}\n${previewOutput}\n${previewError}`,
    ));
    const timer = setTimeout(() => finish(new Error(`deployment server did not become ready within 15 seconds\n${previewOutput}\n${previewError}`)), 15_000);
    child.stdout.on("data", inspect);
    child.once("error", failed);
    child.once("exit", exited);
    inspect();
  });
}

function runCli(arguments_) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: websiteRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`velar ${arguments_[0]} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}\n${stdout}\n${stderr}`));
    });
  });
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(true), 3_000)),
  ]);
  if (!timedOut) return;
  child.kill("SIGKILL");
  await exited;
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length <= 1_048_576
    ? next
    : `${next.slice(0, 1_048_550)}\n[deployment output truncated]`;
}
