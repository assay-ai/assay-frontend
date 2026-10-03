#!/usr/bin/env node
/**
 * The only check that can see the backend adding a gas-grant refusal reason.
 *
 * `GasGrantRefusal` exists three times: as an `enum` in the backend, as a union
 * of string literals in `src/interfaces/escrow.ts`, and as the keys of
 * `REFUSAL_TEXT` in `src/features/escrow/withdraw-gas-grant-note.ts`. Only the
 * last two are connected — `Record<GasGrantRefusal, …>` makes a member added to
 * the union a compile error until somebody writes its sentence.
 *
 * The first link is the one nothing held. The union is hand-written, so a
 * member the BACKEND adds is not a compile error anywhere: the union is simply
 * short, the table is exhaustive over the short union, `tsc` is clean, the
 * build is green, and the screen falls through to the outage sentence. That
 * has happened: `GRANT_IN_FLIGHT` ("another attempt at this buyer's once-ever
 * gas is in flight; retry in a moment") reached a buyer as "the faucet could
 * not be consulted", which is a different problem with a different answer.
 *
 * So this script reads the backend's own enum and compares all three sets. It
 * also writes `src/interfaces/gas-grant-refusal.backend.json`, the snapshot
 * `gas-grant-refusal.contract.test.ts` asserts against in `pnpm test`, where no
 * backend checkout exists.
 *
 * ## What it does NOT do
 *
 * It needs a checkout of the backend (assay-backend), which this
 * repository does not contain, so it is not wired into `pnpm test` or the
 * pre-push hook: a gate that fails on every machine without the backend is a
 * gate somebody deletes. Run it by hand whenever you touch this vocabulary or
 * update to a new backend version.
 *
 * It reads ONLY the directory named by `X402_BACKEND_SRC`; it never guesses a
 * sibling path. Without it, it exits **2**, not 0: "could not compare" is not
 * "they agree".
 *
 * Run:
 *   X402_BACKEND_SRC=/path/to/assay-backend/src node scripts/check-gas-grant-refusals.js
 *   X402_BACKEND_SRC=… node scripts/check-gas-grant-refusals.js --write  # refresh the snapshot too
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const SNAPSHOT = path.join(root, "src/interfaces/gas-grant-refusal.backend.json");

/** Where the enum lives, relative to the backend's `src/`. */
const PORT_FILE = "modules/settlement/ports/withdraw-gas-grant.port.ts";

/** The backend `src/` root, supplied explicitly by whoever runs the check. */
const CANDIDATES = [process.env.X402_BACKEND_SRC].filter(Boolean);

function findPortFile() {
  const tried = [];
  for (const src of CANDIDATES) {
    const candidate = path.join(src, PORT_FILE);
    tried.push(candidate);
    if (fs.existsSync(candidate)) return { file: candidate, tried };
  }
  return { file: null, tried };
}

/**
 * The backend enum's members, and an assertion the mirror silently depends on:
 * every member's VALUE equals its NAME. The frontend union is a union of the
 * names; if the backend ever gave a member a different string value, the names
 * would still match and the wire would still carry something this build has
 * never seen.
 */
function backendMembers(source) {
  const block = source.match(/export enum GasGrantRefusal \{([\s\S]*?)\n\}/);
  if (!block) return { error: "could not find `export enum GasGrantRefusal { … }`" };

  const members = [];
  const renamed = [];
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/gm;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    members.push(m[1]);
    if (m[1] !== m[2]) renamed.push(`${m[1]} = '${m[2]}'`);
  }
  if (members.length === 0) return { error: "the enum body parsed to zero members" };
  if (renamed.length > 0)
    return {
      error:
        "a member's wire value differs from its name, which the frontend union cannot " +
        `mirror by name alone: ${renamed.join(", ")}`,
    };
  return { members };
}

/** The union in `src/interfaces/escrow.ts`, by text — a type has no runtime form. */
function unionMembers() {
  const source = fs.readFileSync(path.join(root, "src/interfaces/escrow.ts"), "utf8");
  const block = source.match(/export type GasGrantRefusal =([\s\S]*?);/);
  if (!block) return { error: "could not find `export type GasGrantRefusal = …;`" };
  const members = (block[1].match(/"([A-Z][A-Z0-9_]*)"/g) || []).map((s) => s.slice(1, -1));
  if (members.length === 0) return { error: "the union parsed to zero members" };
  return { members };
}

/** The copy table's keys, by text, from `withdraw-gas-grant-note.ts`. */
function copyTableMembers() {
  const source = fs.readFileSync(
    path.join(root, "src/features/escrow/withdraw-gas-grant-note.ts"),
    "utf8",
  );
  const block = source.match(/const REFUSAL_TEXT: Record<GasGrantRefusal, RefusalCopy> = \{([\s\S]*?)\n\};/);
  if (!block) return { error: "could not find `const REFUSAL_TEXT: Record<GasGrantRefusal, RefusalCopy> = { … };`" };
  const members = (block[1].match(/^ {2}([A-Z][A-Z0-9_]*):/gm) || []).map((s) => s.trim().slice(0, -1));
  if (members.length === 0) return { error: "the copy table parsed to zero keys" };
  return { members };
}

function diff(label, backend, local) {
  const missing = backend.filter((k) => !local.includes(k));
  const extra = local.filter((k) => !backend.includes(k));
  const lines = [];
  if (missing.length)
    lines.push(`FAIL  ${label}: on the backend but not here: ${missing.join(", ")}`);
  if (extra.length)
    lines.push(`FAIL  ${label}: here but not on the backend: ${extra.join(", ")}`);
  if (lines.length === 0) console.log(`ok    ${label}: ${local.length} reasons, agrees`);
  return lines;
}

function main() {
  const { file, tried } = findPortFile();
  if (!file) {
    console.error("NOT A PASS — the backend enum could not be read, so nothing was compared.");
    if (tried.length === 0) console.error("X402_BACKEND_SRC is not set.");
    else {
      console.error("Tried:");
      for (const p of tried) console.error(`  ${p}`);
    }
    console.error("Set X402_BACKEND_SRC to the backend's src/ directory and run again.");
    process.exit(2);
  }

  const backend = backendMembers(fs.readFileSync(file, "utf8"));
  if (backend.error) {
    console.error(`NOT A PASS — ${file}: ${backend.error}`);
    process.exit(2);
  }

  const union = unionMembers();
  const table = copyTableMembers();
  for (const [label, parsed] of [["union", union], ["copy table", table]]) {
    if (parsed.error) {
      console.error(`NOT A PASS — the frontend ${label} could not be parsed: ${parsed.error}`);
      process.exit(2);
    }
  }

  console.log(`read  ${file}`);
  console.log(`      ${backend.members.length} reasons: ${backend.members.join(", ")}`);

  const failures = [
    ...diff("src/interfaces/escrow.ts GasGrantRefusal", backend.members, union.members),
    ...diff("withdraw-gas-grant-note.ts REFUSAL_TEXT", backend.members, table.members),
  ];

  const snapshot = {
    _comment:
      "Generated by scripts/check-gas-grant-refusals.js from the backend enum named in " +
      "`source`. Do not hand-edit: gas-grant-refusal.contract.test.ts asserts the frontend " +
      "union and copy table against this, and the script is what re-derives it.",
    source: `<backend>/src/${PORT_FILE}`,
    enum: "GasGrantRefusal",
    reasons: backend.members,
  };

  if (process.argv.includes("--write")) {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`wrote ${path.relative(root, SNAPSHOT)}`);
  } else if (!fs.existsSync(SNAPSHOT)) {
    failures.push(`FAIL  snapshot: ${path.relative(root, SNAPSHOT)} does not exist — run with --write`);
  } else {
    const have = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")).reasons || [];
    failures.push(...diff(path.relative(root, SNAPSHOT), backend.members, have));
  }

  if (failures.length > 0) {
    for (const line of failures) console.error(line);
    console.error(
      "\nThe backend's refusal vocabulary and this bundle's disagree. A reason in the gap is " +
        "shown to a buyer as the OUTAGE sentence — a different problem with a different answer.",
    );
    process.exit(1);
  }
  console.log("ok    all three agree");
}

main();
