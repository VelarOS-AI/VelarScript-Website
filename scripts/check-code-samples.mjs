import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Every code sample on this site is checked by the suffix of the constant that
// holds it. There is no central registry to keep in sync: the name a page
// author writes is the whole declaration of what the sample is.
//
//   *ShellCode *TextCode *JsonCode *TreeCode *JsCode *TsCode *CssCode
//   *HtmlCode    — not VelarScript, so not compiled.
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

const counts = { application: 0, excerpt: 0, counterExample: 0, skipped: 0 };
const projects = new Map();
const samplesById = new Map(samples.map((sample) => [sample.id, sample]));

try {
  for (const sample of samples) {
    if (skippedSuffixes.some((suffix) => sample.name.endsWith(suffix))) {
      counts.skipped += 1;
      continue;
    }
    const target = targetSuffixes.find(([suffix]) => sample.name.endsWith(suffix))?.[1] ?? "web";
    const chunk = sample.name.endsWith("ChunkCode")
      ? undefined
      : samplesById.get(`${sample.id.slice(0, -"Code".length)}ChunkCode`);
    const diagnostics = await checkSample(sample, target, chunk);
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
  const produced = new Set(diagnostics.codes);
  for (const quoted of new Set(output.match(/VEL\d+/gu) ?? [])) {
    if (!produced.has(quoted)) {
      failures.push(`${outputId}: quotes ${quoted}, which the sample does not produce (it produces ${[...produced].join(", ")})`);
    }
  }
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
  const directory = await projectFor(target);
  const isBrowserTest = sample.name.endsWith("BrowserTestCode");
  const isTest = !isBrowserTest && /^test "/mu.test(sample.source);
  await rm(join(directory, "sample.test.vel"), { force: true });
  await rm(join(directory, "sample.browser.test.vel"), { force: true });
  await rm(join(directory, "chunk.vel"), { force: true });
  await writeFile(join(directory, "main.vel"), isTest || isBrowserTest ? "export const placeholder = 1\n" : sample.source, "utf8");
  if (isTest) await writeFile(join(directory, "sample.test.vel"), sample.source, "utf8");
  if (isBrowserTest) await writeFile(join(directory, "sample.browser.test.vel"), sample.source, "utf8");
  if (chunk !== undefined) await writeFile(join(directory, "chunk.vel"), chunk.source, "utf8");
  // A sample that shows the CSS escape hatch names a stylesheet. What the page
  // teaches is the import and its cascade position, so an empty stylesheet is
  // enough for the compiler to resolve the resource.
  for (const match of sample.source.matchAll(/^import css unsafe "\.\/([\w./-]+\.css)"/gmu)) {
    await mkdir(dirname(join(directory, match[1])), { recursive: true });
    await writeFile(join(directory, match[1]), "", "utf8");
  }
  const execution = spawnSync(join(root, "node_modules", ".bin", "velar"), ["check"], { cwd: directory, encoding: "utf8" });
  const text = execution.status === 0 ? "" : (execution.stderr || execution.stdout).trimEnd();
  return { text, codes: text.match(/VEL\d+/gu) ?? [] };
}

async function projectFor(target) {
  const existing = projects.get(target);
  if (existing !== undefined) return existing;
  const directory = await mkdtemp(join(tmpdir(), `velarscript-website-samples-${target}-`));
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  await writeFile(join(directory, "velar.json"), `${JSON.stringify(manifestFor(target), null, 2)}\n`, "utf8");
  projects.set(target, directory);
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

async function velarFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await velarFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".vel")) files.push(path);
  }
  return files.sort();
}
