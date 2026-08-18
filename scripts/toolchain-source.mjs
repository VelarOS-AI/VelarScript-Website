import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const TOOLCHAIN_RECEIPT = ".velarscript-toolchain-source.json";
export const TOOLCHAIN_PACKAGES = Object.freeze([
  "@velarscript/cli",
  "@velarscript/compiler",
  "@velarscript/desktop",
  "@velarscript/node",
  "@velarscript/script-analysis",
  "@velarscript/text-buffer",
  "@velarscript/web",
  "create-velar",
]);

const sourceExclusions = new Set([".git", "node_modules", "dist", "release", "coverage"]);

export async function sourceTreeSha256(root) {
  return treeSha256(root, sourceExclusions);
}

export async function installedPackageSha256(nodeModules, name) {
  return treeSha256(join(nodeModules, ...name.split("/")), new Set(["node_modules"]));
}

async function treeSha256(root, excludedNames) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludedNames.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Toolchain identity cannot include symbolic link '${relative(root, path)}'`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  const rootStatus = await lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new Error(`Toolchain identity root '${root}' is not an owned directory`);
  await visit(root);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}
