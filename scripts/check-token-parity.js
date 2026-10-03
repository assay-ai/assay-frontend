#!/usr/bin/env node
/**
 * Guards the one drift that is invisible everywhere else.
 *
 * tailwind-merge cannot parse this design system's token names, so `cn()`
 * declares them explicitly in src/utils/index.ts. A token added to
 * tailwind.config.js but not declared there gets SILENTLY DROPPED the first
 * time it shares a prefix with another class on the same element — the source
 * looks right, the CSS rule exists, and tsc is clean. That shipped once: every
 * filled Button rendered dark text on its own accent, and every bordered
 * surface rendered at border-width 0.
 *
 * Run: node scripts/check-token-parity.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cfg = require(path.join(root, "tailwind.config.js"));
const src = fs.readFileSync(path.join(root, "src/utils/index.ts"), "utf8");

function declared(listName) {
  const m = src.match(new RegExp(`const ${listName} = \\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return new Set((m[1].match(/"[^"]+"/g) || []).map((s) => s.slice(1, -1)));
}

const checks = [
  { label: "fontSize", actual: Object.keys(cfg.theme.extend.fontSize || {}), list: "FONT_SIZES" },
];

let failed = false;
for (const { label, actual, list } of checks) {
  const want = declared(list);
  if (!want) {
    console.error(`FAIL  could not find ${list} in src/utils/index.ts`);
    failed = true;
    continue;
  }
  const missing = actual.filter((k) => !want.has(k));
  const stale = [...want].filter((k) => !actual.includes(k));
  if (missing.length || stale.length) {
    failed = true;
    if (missing.length) console.error(`FAIL  ${label}: in tailwind.config.js but not in cn()'s ${list}: ${missing.join(", ")}`);
    if (stale.length) console.error(`FAIL  ${label}: in cn()'s ${list} but no longer in tailwind.config.js: ${stale.join(", ")}`);
  } else {
    console.log(`ok    ${label}: ${actual.length} tokens, cn() agrees`);
  }
}

if (failed) {
  console.error("\ncn() and tailwind.config.js disagree. Classes in the gap will be silently dropped at runtime.");
  process.exit(1);
}
