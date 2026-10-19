#!/usr/bin/env node
/**
 * The Privy confirmation is never hidden (spec R-WEB-5).
 *
 * Fails when:
 * - any source file under `src/` sets `showWalletUIs` to anything but the
 *   literal `true` (`showWalletUIs: false`, or a variable that could be false);
 * - a file that builds or names an `AuthorizeDelegate` or `SetLimits` request
 *   calls `signTypedData(` without `showWalletUIs: true` in that call;
 * - one of the two known signing sites (`REQUIRED_FILES`) is gone or no longer
 *   calls `signTypedData(`, so a move cannot silently skip the check.
 *
 * Test files are not scanned: they hold the bad examples this check refuses.
 * Run: node scripts/check-wallet-ui.js   (also run by src/config/check-wallet-ui.test.ts)
 */
const fs = require("fs");
const path = require("path");

/** Where `AuthorizeDelegate` and `SetLimits` are signed today. */
const REQUIRED_FILES = [
  "src/features/delegation/relayed-delegation.ts",
  "src/features/escrow/relayed-submission.ts",
];

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(ts|tsx|js|jsx)$/;
const PAYMENT_TYPES = /AuthorizeDelegate|AUTHORIZE_DELEGATE|SetLimits|SET_LIMITS/;

/** The text with comments blanked out (strings kept), so a comment cannot satisfy or trip a rule. */
function stripComments(text) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
      i += 1;
    }
  }
  return out;
}

/** The argument text of every `signTypedData(` call (not `evmSignTypedData(`, not a declaration). */
function signTypedDataCalls(code) {
  const calls = [];
  const re = /(?<![\w$])signTypedData\s*\(/g;
  let match;
  while ((match = re.exec(code))) {
    const before = code.slice(Math.max(0, match.index - 9), match.index);
    if (/function\s*$/.test(before)) continue;
    let depth = 1;
    let j = match.index + match[0].length;
    const start = j;
    while (j < code.length && depth > 0) {
      if (code[j] === "(") depth += 1;
      else if (code[j] === ")") depth -= 1;
      j += 1;
    }
    calls.push({ index: match.index, args: code.slice(start, j - 1) });
  }
  return calls;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Problems in one file's text, as "file:line: message" strings. */
function checkSource(file, text) {
  const problems = [];
  const code = stripComments(text);
  const setting = /showWalletUIs\s*:(?!\s*true\b)\s*([^,};\s]*)/g;
  let match;
  while ((match = setting.exec(code))) {
    problems.push(`${file}:${lineOf(code, match.index)}: showWalletUIs must be the literal true, not ${match[1] || "this"}`);
  }
  const shorthand = /[{,]\s*showWalletUIs\s*[,}]/g;
  while ((match = shorthand.exec(code))) {
    problems.push(`${file}:${lineOf(code, match.index)}: showWalletUIs must be the literal true`);
  }
  if (PAYMENT_TYPES.test(code)) {
    for (const call of signTypedDataCalls(code)) {
      if (!/showWalletUIs\s*:\s*true\b/.test(call.args)) {
        problems.push(
          `${file}:${lineOf(code, call.index)}: signTypedData( for AuthorizeDelegate/SetLimits without { showWalletUIs: true }`,
        );
      }
    }
  }
  return problems;
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) files.push(full);
  }
  return files;
}

/** Every problem in the repository at `root`. */
function checkRepo(root) {
  const problems = [];
  for (const file of sourceFiles(path.join(root, "src"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    problems.push(...checkSource(rel, fs.readFileSync(file, "utf8")));
  }
  for (const rel of REQUIRED_FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      problems.push(`${rel}: missing; update REQUIRED_FILES in scripts/check-wallet-ui.js`);
      continue;
    }
    if (signTypedDataCalls(stripComments(fs.readFileSync(file, "utf8"))).length === 0) {
      problems.push(`${rel}: no signTypedData( call found; update REQUIRED_FILES in scripts/check-wallet-ui.js`);
    }
  }
  return problems;
}

if (require.main === module) {
  const problems = checkRepo(path.resolve(__dirname, ".."));
  if (problems.length) {
    for (const problem of problems) console.error(`check-wallet-ui: ${problem}`);
    process.exit(1);
  }
  console.log("check-wallet-ui: ok");
}

module.exports = { checkSource, checkRepo, REQUIRED_FILES };
