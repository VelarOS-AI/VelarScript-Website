import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Chinese on this site is written in Chinese, not translated into it.
// Most of that cannot be checked by a machine — "does this read like a person
// wrote it" is settled by a person, and docs/chinese-voice.md says so. What a
// machine can hold is the banned list: the specific shapes that turned up when
// the site was audited, each one a literal rendering of an English word or an
// English sentence shape that Chinese does not use.
//
// So this gate is deliberately narrow. It does not judge style. It catches the
// handful of spellings that were decided against, so that a later edit cannot
// quietly walk them back in. Anything it flags has a named replacement in
// docs/chinese-voice.md.
const banned = [
  {
    pattern: /书写表面/gu,
    why: "a literal rendering of \"writing surface\"; not a Chinese term",
    instead: "写起来像… / 看得见的那一面",
  },
  {
    pattern: /真值性/gu,
    why: "a coined translation of \"truthiness\"",
    instead: "truthiness（空字符串和 0 不会被当成 false）",
  },
  {
    pattern: /无主的/gu,
    why: "a literal rendering of \"unowned\"",
    instead: "没人管的",
  },
  {
    pattern: /报告身份/gu,
    why: "a literal rendering of \"reports an identity\"",
    instead: "只说「是哪一个」",
  },
  {
    pattern: /正是[^。；！？\n]{0,40}的原因/gu,
    why: "an English cleft sentence (\"X is what makes Y\") transliterated",
    instead: "split the cause and the effect into two short clauses",
  },
  {
    pattern: /承载/gu,
    why: "translationese; it reads as a word chosen to match an English verb",
    instead: "say the plain thing the sentence is about",
  },
  {
    pattern: /的事实(?=[，。；：]|$)/gmu,
    why: "an English nominalisation (\"the fact that…\") carried into Chinese",
    instead: "state the thing directly instead of naming it as a fact",
  },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let scanned = 0;

for (const file of await velarFiles(join(root, "src"))) {
  const path = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  scanned += 1;
  for (const { pattern, why, instead } of banned) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(
        `${path}:${line}: 「${match[0]}」 — ${why}\n    write instead: ${instead}\n    see docs/chinese-voice.md`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} banned Chinese spelling(s). The list and its replacements are in docs/chinese-voice.md.`);
  process.exitCode = 1;
} else {
  console.log(`Checked Chinese voice in ${scanned} VelarScript source files: no banned spellings.`);
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
