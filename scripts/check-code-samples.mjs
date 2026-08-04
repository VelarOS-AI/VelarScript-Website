import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectModule } from "@velarscript/compiler";
import { velarCompilerExtension } from "@velarscript/web/compiler";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nonVelarSamples = new Set([
  "src/pages/docs-getting-started.vel:createCode",
  "src/pages/docs-getting-started.vel:scriptsCode",
  "src/pages/docs-overview.vel:firstRunCode",
  "src/pages/docs-overview.vel:stackCode",
  "src/pages/docs-project.vel:treeCode",
  "src/pages/docs-project.vel:manifestCode",
  "src/pages/docs-project.vel:packageCode",
  "src/pages/docs-project.vel:commandsCode",
  "src/pages/docs-project.vel:libraryCode",
  "src/pages/language-modules.vel:packageCode",
  "src/pages/learn.vel:createCode",
  "src/pages/learn.vel:dependencyCode",
  "src/pages/learn.vel:shipCode",
  "src/pages/testing-deployment.vel:buildCode",
  "src/pages/testing-deployment.vel:deployCode",
  "src/pages/web-docs.vel:activateCode",
]);
const completeSamples = new Set([
  "src/pages/core-library.vel:textCode",
  "src/pages/core-library.vel:urlCode",
  "src/pages/core-library.vel:timeCode",
  "src/pages/core-library.vel:idLogCode",
  "src/pages/docs-getting-started.vel:componentCode",
  "src/pages/home.vel:heroCode",
  "src/pages/language-classes.vel:basicCode",
  "src/pages/language-classes.vel:inheritanceCode",
  "src/pages/language-classes.vel:privateCode",
  "src/pages/language-classes.vel:staticCode",
  "src/pages/language-collections.vel:setCode",
  "src/pages/language-docs.vel:valuesCode",
  "src/pages/language-docs.vel:objectCode",
  "src/pages/language-functions.vel:functionCode",
  "src/pages/language-types.vel:recordCode",
  "src/pages/language-types.vel:recursiveCode",
  "src/pages/language-types.vel:unionCode",
  "src/pages/learn.vel:valuesCode",
  "src/pages/learn.vel:componentCode",
  "src/pages/testing-deployment.vel:browserTestCode",
  "src/pages/web-browser.vel:appCode",
  "src/pages/web-data.vel:configCode",
  "src/pages/web-data.vel:httpCode",
  "src/pages/web-data.vel:storageCode",
  "src/pages/web-docs.vel:importsCode",
  "src/pages/web-reactivity.vel:stateCode",
  "src/pages/web-reactivity.vel:lifecycleCode",
]);
const samples = [];
const failures = [];

for (const file of await velarFiles(join(root, "src"))) {
  const path = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  const constants = /\bconst\s+([A-Za-z_]\w*Code)\s*=\s*("(?:\\.|[^"\\])*")/gu;
  for (const match of source.matchAll(constants)) samples.push(readSample(path, match[1], match[2]));
  if (path === "src/content.vel") {
    let index = 0;
    const fields = /\bcode\s*:\s*("(?:\\.|[^"\\])*")/gu;
    for (const match of source.matchAll(fields)) samples.push(readSample(path, `code:${index += 1}`, match[1]));
  }
}

for (const sample of samples) {
  if (nonVelarSamples.has(sample.id)) continue;
  const result = inspectModule(sample.source, { path: sample.id, extensions: [velarCompilerExtension] });
  for (const diagnostic of result.diagnostics) failures.push(`${sample.id}: ${diagnostic.code} ${diagnostic.message}`);
}

const missingComplete = [...completeSamples].filter((id) => !samples.some((sample) => sample.id === id));
for (const id of missingComplete) failures.push(`${id}: declared complete sample was not found`);
if (failures.length === 0) await checkCompleteSamples(samples.filter((sample) => completeSamples.has(sample.id)));

if (samples.length === 0) failures.push("No website code samples were found");
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${samples.length} website code samples (${completeSamples.size} complete VelarScript examples)`);
}

function readSample(path, name, literal) {
  try {
    return { id: `${path}:${name}`, source: JSON.parse(literal) };
  } catch (error) {
    failures.push(`${path}:${name}: invalid source string: ${error instanceof Error ? error.message : String(error)}`);
    return { id: `${path}:${name}`, source: "" };
  }
}

async function checkCompleteSamples(complete) {
  const directory = await mkdtemp(join(tmpdir(), "velarscript-website-samples-"));
  try {
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(join(directory, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: ["@velarscript/web"],
    }, null, 2)}\n`, "utf8");
    const command = join(root, "node_modules", ".bin", "velar");
    for (const sample of complete) {
      await writeFile(join(directory, "main.vel"), sample.source, "utf8");
      const execution = spawnSync(command, ["check"], { cwd: directory, encoding: "utf8" });
      if (execution.status !== 0) failures.push(`${sample.id}: complete example does not compile\n${execution.stderr || execution.stdout}`.trimEnd());
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
