#!/usr/bin/env node
/**
 * Copies the language-neutral test vectors the Connect UI shares with
 * `assay-mcp` (spec 8.3.1 server names, 7.12 install commands) from a git ref
 * (tag or commit) of an `assay-mcp` checkout, and records the ref, the commit
 * and each file's sha256 next to them.
 *
 * Run: node scripts/sync-assay-mcp-vectors.js <assay-mcp-checkout> <ref>
 *
 * The files are read with `git show <ref>:vectors/...`, so the working tree of
 * the checkout never matters. The frontend test verifies the recorded hashes,
 * so an edited copy fails CI until it is re-synced from a ref.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILES = {
  "vectors/server-names.json": "src/features/connect/server-name.vectors.json",
  "vectors/commands.json": "src/features/connect/commands.vectors.json",
};
const SOURCE_FILE = "src/features/connect/assay-mcp-vectors.source.json";

const [checkout, ref] = process.argv.slice(2);
if (!checkout || !ref) {
  console.error("usage: node scripts/sync-assay-mcp-vectors.js <assay-mcp-checkout> <ref>");
  process.exit(2);
}

// A ref is a tag or a commit: never an option (a leading "-") and never a character git treats specially.
if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.startsWith("-")) {
  console.error(`refusing the ref "${ref}": use a tag or commit made of letters, digits, ".", "_", "/" and "-", not starting with "-"`);
  process.exit(2);
}

const git = (...args) => execFileSync("git", ["-C", path.resolve(checkout), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const root = path.resolve(__dirname, "..");
const commit = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();

const files = {};
for (const [from, to] of Object.entries(FILES)) {
  const text = git("show", "--end-of-options", `${ref}:${from}`);
  JSON.parse(text);
  fs.writeFileSync(path.join(root, to), text);
  files[to] = { from, sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex") };
}
fs.writeFileSync(path.join(root, SOURCE_FILE), `${JSON.stringify({ ref, commit, files }, null, 2)}\n`);
console.log(`synced ${Object.keys(files).length} files from ${ref} (${commit})`);
