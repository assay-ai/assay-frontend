#!/usr/bin/env node
/**
 * Adds Subresource Integrity to every script the exported pages load, after
 * `next build` and before `connect-csp.js` (spec R-WEB-3).
 *
 * A static export has no reliable built-in SRI, so this hashes the exact bytes
 * of each referenced file in `out/` (SHA-384) and writes `integrity` and
 * `crossorigin="anonymous"` on the tag. A `<link rel="preload" as="script">`
 * for the same file gets the same attributes, so the browser reuses the
 * preload instead of fetching the script twice.
 *
 * It fails the build when a referenced script is missing from `out/` or comes
 * from outside this origin. Inline scripts are left alone (the strict CSP
 * allows them by hash, see `connect-csp.js`) and only counted in the report.
 * A script a page adds at run time (a lazily loaded chunk) is not in the HTML
 * and so is not covered; see `check-built-headers.js` for what it reports.
 *
 * Run: node scripts/add-sri.js   (part of `pnpm build`)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const PRELOAD_SCRIPT_TAG = /<link\b(?=[^>]*\brel=["']?preload\b)(?=[^>]*\bas=["']?script\b)[^>]*>/gi;
const ATTR = (name) => new RegExp(`\\s${name}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s/>])`, "gi");

/** The value of attribute `name` in a tag, or null. */
function attr(tag, name) {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

/** `sha384-<base64>` of the exact bytes. */
function integrityOf(bytes) {
  return `sha384-${crypto.createHash("sha384").update(bytes).digest("base64")}`;
}

/** `tag` with its integrity and crossorigin attributes replaced by the given ones. */
function withIntegrity(tag, integrity) {
  const bare = tag.replace(ATTR("integrity"), "").replace(ATTR("crossorigin"), "");
  const end = bare.endsWith("/>") ? 2 : 1;
  return `${bare.slice(0, -end).trimEnd()} integrity="${integrity}" crossorigin="anonymous"${bare.slice(-end) === "/>" ? "/>" : ">"}`;
}

/** The file in `outDir` a script URL names; throws when it is not a file of this origin. */
function resolveSource(outDir, page, src) {
  if (!src.startsWith("/") || src.startsWith("//")) {
    throw new Error(`${page}: loads a script from outside this origin: ${src}`);
  }
  const clean = decodeURIComponent(src.split(/[?#]/)[0]);
  const file = path.resolve(outDir, `.${clean}`);
  if (!file.startsWith(outDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${page}: references ${src}, which is not in ${path.basename(outDir)}/`);
  }
  return file;
}

/** Every `.html` file under `dir`. */
function htmlFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(dir, file));
}

/** Adds SRI to the pages of `outDir`; returns what it did. */
function addSri(outDir) {
  const root = path.resolve(outDir);
  const cache = new Map();
  const hashOf = (page, src) => {
    const file = resolveSource(root, page, src);
    if (!cache.has(file)) cache.set(file, integrityOf(fs.readFileSync(file)));
    return cache.get(file);
  };
  const report = { pages: 0, scripts: 0, preloads: 0, inline: 0 };
  for (const file of htmlFiles(root)) {
    const page = path.relative(root, file).split(path.sep).join("/");
    let html = fs.readFileSync(file, "utf8");
    html = html.replace(SCRIPT_TAG, (tag) => {
      const src = attr(tag, "src");
      if (src === null) {
        report.inline += 1;
        return tag;
      }
      report.scripts += 1;
      return withIntegrity(tag, hashOf(page, src));
    });
    html = html.replace(PRELOAD_SCRIPT_TAG, (tag) => {
      const href = attr(tag, "href");
      if (href === null) return tag;
      report.preloads += 1;
      return withIntegrity(tag, hashOf(page, href));
    });
    fs.writeFileSync(file, html);
    report.pages += 1;
  }
  return report;
}

function main() {
  const outDir = path.resolve(__dirname, "..", "out");
  if (!fs.existsSync(outDir)) throw new Error("out/ does not exist; run `next build` first");
  const r = addSri(outDir);
  console.log(
    `add-sri: ${r.pages} pages, ${r.scripts} script tags and ${r.preloads} script preloads now carry sha384 integrity; ` +
      `${r.inline} inline scripts left alone (allowed by hash in the strict CSP)`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`add-sri: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { addSri, integrityOf, attr };
