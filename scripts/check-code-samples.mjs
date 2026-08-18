import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareDiagnosticCodeSets } from "./sample-diagnostic-codes.mjs";

// Every code sample on this site is checked by the suffix of the constant that
// holds it. There is no central registry to keep in sync: the name a page
// author writes is the whole declaration of what the sample is.
//
//   *ShellCode *TextCode *JsonCode *TreeCode *TsCode *CssCode *HtmlCode
//                — not VelarScript, so not compiled.
//   *JsCode      — third-party JavaScript only: the React and Vue code a page
//                  compares against. It is never allowed to hold a block that
//                  claims to be VelarScript's own output, because nothing here
//                  compiles it — such a claim goes in *EmittedCode, which is
//                  checked against the compiler.
//   *EmittedCode — an assertion that this JavaScript is what the same-prefix
//                  source sample emits. The source may be spelled *Code,
//                  *NodeCode, *AppCode or *DesktopCode and is looked for in
//                  that order; the sample is built and dist/main.js is compared
//                  byte for byte, so a page cannot drift from the emitter.
//   *AppCode     — a complete web program, checked as a project entry.
//   *NodeCode    — a module for the Node target, checked in a Node project.
//   *DesktopCode — a module for the Desktop target, checked with the Desktop
//                  extension activated.
//   *ErrorCode   — a teaching counter-example: it must still fail to compile,
//                  so it cannot quietly become legal code. When the page also
//                  prints the compiler's answer in a same-prefix *ErrorOutput
//                  constant, every VEL code quoted there must appear in the
//                  diagnostics the sample really produces.
//   *BrowserTestCode — a browser-test module: checked as sample.browser.test.vel,
//                  the only module kind allowed to import velar/web-test.
//   *ChunkCode   — a neighbour module: checked on its own like any excerpt, and
//                  also written as chunk.vel beside the same-prefix sample, so a
//                  page can compile a real relative import or a lazy(...) chunk.
//   *Code        — an ordinary excerpt: it must produce no diagnostics.
//
// Every VelarScript sample goes through `velar check` in a temporary project.
// The in-process `inspectModule` only parses, so it accepts unknown names,
// wrong types, and the truthiness conditions these pages teach against — a
// gate built on it would pass counter-examples the compiler rejects.
const skippedSuffixes = ["ShellCode", "TextCode", "JsonCode", "TreeCode", "JsCode", "TsCode", "CssCode", "HtmlCode"];
const targetSuffixes = [["AppCode", "web"], ["NodeCode", "node"], ["DesktopCode", "desktop"]];
const emittedSuffix = "EmittedCode";
const sourceSuffixes = ["Code", "NodeCode", "AppCode", "DesktopCode"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const samples = [];
const errorOutputs = new Map();
const failures = [];

// A sample is a string literal, and `velar format` picks its delimiter from the
// text: a block that contains a double quote is canonically written with
// backticks. Both spellings are read here, because the alternative would be
// asking page authors to write samples the formatter then rewrites.
const literal = '(?:"(?:\\\\.|[^"\\\\])*"|`(?:\\\\.|[^`\\\\])*`)';
const escapes = new Map([["n", "\n"], ["t", "\t"], ["r", "\r"], ["0", "\0"]]);

for (const file of await velarFiles(join(root, "src"))) {
  const path = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  const constants = new RegExp(`\\bconst\\s+([A-Za-z_]\\w*Code)\\s*=\\s*(${literal})`, "gu");
  for (const match of source.matchAll(constants)) samples.push(readSample(path, match[1], match[2]));
  const outputs = new RegExp(`\\bconst\\s+([A-Za-z_]\\w*ErrorOutput)\\s*=\\s*(${literal})`, "gu");
  for (const match of source.matchAll(outputs)) {
    const output = readSample(path, match[1], match[2]);
    errorOutputs.set(output.id, output.source);
  }
  if (path === "src/content.vel") {
    let index = 0;
    const fields = new RegExp(`\\bcode\\s*:\\s*(${literal})`, "gu");
    for (const match of source.matchAll(fields)) samples.push(readSample(path, `code:${index += 1}`, match[1]));
  }
}

const counts = { application: 0, excerpt: 0, counterExample: 0, emitted: 0, skipped: 0 };
const projects = new Map();
const samplesById = new Map(samples.map((sample) => [sample.id, sample]));

try {
  for (const sample of samples) {
    if (sample.name.endsWith(emittedSuffix)) {
      counts.emitted += 1;
      await checkEmitted(sample);
      continue;
    }
    if (skippedSuffixes.some((suffix) => sample.name.endsWith(suffix))) {
      counts.skipped += 1;
      continue;
    }
    const target = targetSuffixes.find(([suffix]) => sample.name.endsWith(suffix))?.[1] ?? "web";
    const diagnostics = await checkSample(sample, target, chunkFor(sample));
    if (sample.name.endsWith("ErrorCode")) {
      counts.counterExample += 1;
      checkCounterExample(sample, diagnostics);
      continue;
    }
    if (sample.name.endsWith("AppCode")) counts.application += 1;
    else counts.excerpt += 1;
    if (diagnostics.text !== "") failures.push(`${sample.id}: sample does not compile\n${diagnostics.text}`);
  }
} finally {
  for (const directory of projects.values()) await rm(directory, { recursive: true, force: true });
}

if (samples.length === 0) failures.push("No website code samples were found");
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log([
    `Checked ${samples.length} website code samples:`,
    `${counts.application} complete applications,`,
    `${counts.excerpt} compiled excerpts,`,
    `${counts.counterExample} teaching counter-examples,`,
    `${counts.emitted} emitted-output assertions,`,
    `${counts.skipped} non-VelarScript blocks.`,
  ].join(" "));
}

function checkCounterExample(sample, diagnostics) {
  // Keyed off the whole failure text, not off VEL codes: some real rejections
  // (a Node-only module in a web project) carry no code at all.
  if (diagnostics.text === "") {
    failures.push(`${sample.id}: counter-example produced no diagnostic, so it no longer teaches anything`);
    return;
  }
  const outputId = `${sample.id.slice(0, -"ErrorCode".length)}ErrorOutput`;
  const output = errorOutputs.get(outputId);
  if (output === undefined) return;
  const comparison = compareDiagnosticCodeSets(output, diagnostics.text);
  if (comparison.missing.length > 0 || comparison.unexpected.length > 0) {
    failures.push(`${outputId}: documented diagnostic codes must equal the sample's diagnostics; documented [${comparison.quoted.join(", ")}], produced [${comparison.produced.join(", ")}]`
      + `${comparison.missing.length > 0 ? `, missing [${comparison.missing.join(", ")}]` : ""}`
      + `${comparison.unexpected.length > 0 ? `, unexpected [${comparison.unexpected.join(", ")}]` : ""}`);
  }
}

// A page that prints emitted JavaScript is making a claim about the compiler,
// so the claim is answered by the compiler rather than by the author's memory:
// the paired source is built and the emitted module is compared to the text.
async function checkEmitted(sample) {
  const prefix = sample.id.slice(0, -emittedSuffix.length);
  const source = sourceSuffixes.map((suffix) => samplesById.get(prefix + suffix)).find((found) => found !== undefined);
  if (source === undefined) {
    const wanted = sourceSuffixes.map((suffix) => sample.name.slice(0, -emittedSuffix.length) + suffix).join(", ");
    failures.push(`${sample.id}: claims to be emitted output, but this file declares no source sample to emit it from. Name the source ${wanted}, or use a *JsCode constant if the block is third-party JavaScript.`);
    return;
  }
  const target = targetSuffixes.find(([suffix]) => source.name.endsWith(suffix))?.[1] ?? "web";
  const built = await buildSample(source, target, chunkFor(source));
  if (built.failure !== undefined) {
    failures.push(`${sample.id}: ${source.name} does not build, so what it emits cannot be checked\n${built.failure}`);
    return;
  }
  const raw = await readFile(join(built.directory, "dist", "main.js"), "utf8").catch(() => undefined);
  if (raw === undefined) {
    const produced = await emittedPaths(join(built.directory, "dist"));
    failures.push(`${sample.id}: the ${target} build emits no dist/main.js, so there is no single module to quote — that target bundles and content-hashes instead. Pair a *${emittedSuffix} block with a *NodeCode source. This build produced: ${produced.join(", ")}`);
    return;
  }
  const emitted = emittedBlock(raw);
  if (emitted === sample.source) return;
  failures.push([
    `${sample.id}: this is not what ${source.name} emits today.`,
    `Below is the real emitted module in full, and then the same text as a sample literal to paste over the constant.`,
    "",
    emitted,
    "",
    `const ${sample.name} = ${asLiteral(emitted)}`,
  ].join("\n"));
}

// The emitted file, reduced to the block of lines a page can quote. Two
// exclusions, and no others; everything else is compared byte for byte. The
// //# sourceMappingURL= line names the output file rather than saying anything
// about the output, and the final newline belongs to the file rather than to
// the block.
function emittedBlock(text) {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("//# sourceMappingURL="))
    .join("\n")
    .replace(/\n$/u, "");
}

// Written the way `velar format` would write it, so a pasted constant survives
// format:check: a text containing a double quote is delimited with backticks.
function asLiteral(text) {
  const delimiter = text.includes('"') ? "`" : '"';
  const body = text
    .replaceAll("\\", "\\\\")
    .replaceAll(delimiter, `\\${delimiter}`)
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n");
  return `${delimiter}${body}${delimiter}`;
}

function chunkFor(sample) {
  if (sample.name.endsWith("ChunkCode")) return undefined;
  return samplesById.get(`${sample.id.slice(0, -"Code".length)}ChunkCode`);
}

function readSample(path, name, text) {
  return { id: `${path}:${name}`, name, source: decodeLiteral(text) };
}

function decodeLiteral(text) {
  const body = text.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") {
      decoded += body[index];
      continue;
    }
    index += 1;
    const marker = body[index];
    if (marker === "u" && body[index + 1] === "{") {
      const end = body.indexOf("}", index);
      decoded += String.fromCodePoint(Number.parseInt(body.slice(index + 2, end), 16));
      index = end;
      continue;
    }
    decoded += escapes.get(marker) ?? marker;
  }
  return decoded;
}

async function checkSample(sample, target, chunk) {
  const directory = await projectFor(target, "check");
  const isBrowserTest = sample.name.endsWith("BrowserTestCode");
  const isTest = !isBrowserTest && /^test "/mu.test(sample.source);
  await rm(join(directory, "sample.test.vel"), { force: true });
  await rm(join(directory, "sample.browser.test.vel"), { force: true });
  await rm(join(directory, "chunk.vel"), { force: true });
  await writeFile(join(directory, "main.vel"), isTest || isBrowserTest ? "export const placeholder = 1\n" : sample.source, "utf8");
  if (isTest) await writeFile(join(directory, "sample.test.vel"), sample.source, "utf8");
  if (isBrowserTest) await writeFile(join(directory, "sample.browser.test.vel"), sample.source, "utf8");
  if (chunk !== undefined) await writeFile(join(directory, "chunk.vel"), chunk.source, "utf8");
  await writeStylesheets(directory, sample);
  const execution = spawnSync(join(root, "node_modules", ".bin", "velar"), ["check"], { cwd: directory, encoding: "utf8" });
  const text = execution.status === 0 ? "" : (execution.stderr || execution.stdout).trimEnd();
  return { text, codes: text.match(/VEL\d+/gu) ?? [] };
}

// Emitting is `velar build`, not `velar check`, and it runs in its own project
// so that a dist directory is never left behind in the one the checks share.
async function buildSample(sample, target, chunk) {
  const directory = await projectFor(target, "build");
  await rm(join(directory, "dist"), { recursive: true, force: true });
  await rm(join(directory, "chunk.vel"), { force: true });
  await writeFile(join(directory, "main.vel"), sample.source, "utf8");
  if (chunk !== undefined) await writeFile(join(directory, "chunk.vel"), chunk.source, "utf8");
  await writeStylesheets(directory, sample);
  const execution = spawnSync(join(root, "node_modules", ".bin", "velar"), ["build"], { cwd: directory, encoding: "utf8" });
  if (execution.status !== 0) return { failure: (execution.stderr || execution.stdout).trimEnd() };
  return { directory };
}

// A sample that shows the CSS escape hatch names a stylesheet. What the page
// teaches is the import and its cascade position, so an empty stylesheet is
// enough for the compiler to resolve the resource.
async function writeStylesheets(directory, sample) {
  for (const match of sample.source.matchAll(/^import css unsafe "\.\/([\w./-]+\.css)"/gmu)) {
    await mkdir(dirname(join(directory, match[1])), { recursive: true });
    await writeFile(join(directory, match[1]), "", "utf8");
  }
}

async function projectFor(target, kind) {
  const key = `${kind}:${target}`;
  const existing = projects.get(key);
  if (existing !== undefined) return existing;
  const directory = await mkdtemp(join(tmpdir(), `velarscript-website-samples-${kind}-${target}-`));
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  await writeFile(join(directory, "velar.json"), `${JSON.stringify(manifestFor(target), null, 2)}\n`, "utf8");
  projects.set(key, directory);
  return directory;
}

function manifestFor(target) {
  if (target === "node") return { formatVersion: 2, entry: "main.vel" };
  if (target === "desktop") {
    return {
      formatVersion: 2,
      entry: "main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "VelarScript sample",
        identifier: "cn.velaros.velarscript.sample",
        permissions: { files: ["app-data", "project"], processes: [], terminal: false, network: [], environment: [], secrets: [] },
      },
    };
  }
  return { formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] };
}

async function emittedPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

async function velarFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await velarFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".vel")) files.push(path);
  }
  return files.sort();
}
