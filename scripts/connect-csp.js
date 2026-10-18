#!/usr/bin/env node
/**
 * Completes the strict Content-Security-Policy of `/connect/*` and
 * `/agents/enable-paid` in `out/_headers`, after `next build` (spec R-WEB-2).
 *
 * `public/_headers` carries the policy as `strictPolicy()` writes it, with
 * `script-src 'self'` alone. A static export cannot start under that: Next
 * writes its bootstrap and flight data as inline `<script>`s. So, for each
 * strict path, this adds the SHA-256 of every inline script in the pages that
 * path serves (each hash allows exactly that text and nothing else) and the
 * API origin the pages call, and nothing more.
 *
 * It fails the build when a strict block, its policy or its pages are missing,
 * or when the line would pass Cloudflare Pages' 2,000-character limit, rather
 * than ship a page that cannot start or a policy that was cut short.
 *
 * Run: node scripts/connect-csp.js   (part of `pnpm build`)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { STRICT_PATHS, fallbackPolicy, strictPolicy } = require("./csp-policy");

/** Cloudflare Pages' limit on one `_headers` line. */
const MAX_LINE = 2000;

/** Inline scripts: a `<script>` element with no `src`. */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/** The base64 SHA-256 of each distinct, non-empty inline script in `html`. */
function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1];
    if (!body) continue;
    hashes.add(crypto.createHash("sha256").update(body, "utf8").digest("base64"));
  }
  return hashes;
}

/** Script elements with a `src`. */
const EXTERNAL_SCRIPT = /<script\b[^>]*\ssrc=["']?([^"'\s>]+)/gi;

/**
 * Refuses a page that loads a script from anywhere but this origin (no
 * third-party script, no analytics, on a strict page: spec R-WEB-2). The
 * policy would refuse it in the browser anyway; this catches it at build.
 */
function assertOwnScriptsOnly(urlPath, html) {
  for (const match of html.matchAll(EXTERNAL_SCRIPT)) {
    const src = match[1];
    if (!src.startsWith("/") || src.startsWith("//")) {
      throw new Error(`${urlPath}: loads a script from outside this origin: ${src}`);
    }
  }
}

/** The exported HTML files a `_headers` path pattern serves. */
function pagesFor(outDir, pattern) {
  if (pattern.endsWith("/*")) {
    const dir = path.join(outDir, pattern.slice(1, -2));
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".html"))
      .map((file) => path.join(dir, file));
  }
  const base = path.join(outDir, pattern.slice(1));
  return [`${base}.html`, path.join(base, "index.html")].filter((file) => fs.existsSync(file));
}

/** The URL path an exported file is served at: `out/connect/authorize.html` → `/connect/authorize`. */
function urlPathOf(outDir, file) {
  const rel = path.relative(outDir, file).split(path.sep).join("/");
  return `/${rel.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`.replace(/\/$/, "") || "/";
}

/** An origin from a URL in the environment, or null. */
function originOf(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

/**
 * `headersText` with each strict block's policy completed.
 *
 * `pages[pattern]` maps each page a pattern serves (its URL path) to its HTML.
 * - An exact path (`/agents/enable-paid`) gets its policy completed in place.
 * - A splat (`/connect/*`) serves several pages, and one line holding the
 *   full policy and every page's hashes would pass the line limit. So each
 *   page gets its own block with the full policy and only its own hashes,
 *   and the splat keeps `fallbackPolicy()` with every page's hashes (plus its
 *   X-Frame-Options and Referrer-Policy) for any response under it with no
 *   block of its own. A request matches both blocks; Cloudflare Pages joins
 *   the two policies, and a browser enforces both.
 * A pattern with no pages built yet keeps the bare policy.
 */
function completeHeaders(headersText, pages, connectOrigins) {
  const bare = strictPolicy();
  const hashesOf = (html) => {
    const hashes = new Set();
    for (const page of html) for (const hash of inlineScriptHashes(page)) hashes.add(hash);
    return [...hashes].sort();
  };
  const completed = (html) => strictPolicy({ scriptHashes: hashesOf(html), connectOrigins });
  for (const served of Object.values(pages)) {
    for (const [urlPath, html] of Object.entries(served ?? {})) assertOwnScriptsOnly(urlPath, html);
  }
  const out = [];
  const done = new Set();
  // Per-page blocks of a splat, written once the splat's own block has ended.
  let pending = [];
  let block = null;
  for (const line of headersText.split("\n")) {
    if (pending.length && (line.trim() === "" || /^\S/.test(line))) {
      out.push(...pending, "");
      pending = [];
    }
    if (/^\S/.test(line)) block = line.trim();
    const match = STRICT_PATHS.includes(block) ? /^(\s+Content-Security-Policy:\s*)(.*)$/.exec(line) : null;
    if (!match) {
      out.push(line);
      continue;
    }
    if (match[2] !== bare) throw new Error(`${block}: its policy is not strictPolicy(); fix public/_headers`);
    done.add(block);
    const served = Object.entries(pages[block] ?? {});
    if (!served.length) {
      out.push(line);
    } else if (block.endsWith("/*")) {
      out.push(`${match[1]}${fallbackPolicy({ scriptHashes: hashesOf(served.map(([, html]) => html)) })}`);
      for (const [urlPath, html] of served) {
        pending.push("", urlPath, `${match[1]}${completed([html])}`);
      }
    } else {
      out.push(`${match[1]}${completed(served.map(([, html]) => html))}`);
    }
  }
  out.push(...pending);
  for (const pattern of STRICT_PATHS) {
    if (!done.has(pattern)) throw new Error(`${pattern}: no Content-Security-Policy block in _headers`);
  }
  for (const line of out) {
    if (line.length > MAX_LINE) throw new Error(`a _headers line is ${line.length} characters, over ${MAX_LINE}`);
  }
  return out.join("\n");
}

function main() {
  const outDir = path.resolve(__dirname, "..", "out");
  const file = path.join(outDir, "_headers");
  const pages = {};
  for (const pattern of STRICT_PATHS) {
    pages[pattern] = Object.fromEntries(
      pagesFor(outDir, pattern).map((page) => [urlPathOf(outDir, page), fs.readFileSync(page, "utf8")]),
    );
  }
  if (!Object.keys(pages["/connect/*"]).length) throw new Error("/connect/*: no exported pages found under out/connect");
  const api = originOf(process.env.NEXT_PUBLIC_API_BASE_URL);
  const text = completeHeaders(fs.readFileSync(file, "utf8"), pages, api ? [api] : []);
  fs.writeFileSync(file, text);
  for (const pattern of STRICT_PATHS) {
    console.log(`connect-csp: ${pattern}: ${Object.keys(pages[pattern]).join(", ") || "no pages yet"}`);
  }
  // How close each policy line is to the limit, so a growing page is seen before it fails the build.
  let block = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) block = line.trim();
    else if (/^\s+Content-Security-Policy:/.test(line)) {
      console.log(`connect-csp: ${block}: ${line.length}/${MAX_LINE} characters (${MAX_LINE - line.length} left)`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`connect-csp: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { completeHeaders, inlineScriptHashes, assertOwnScriptsOnly };
