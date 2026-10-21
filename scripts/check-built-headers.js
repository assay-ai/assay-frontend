#!/usr/bin/env node
/**
 * Checks the built `out/` of the strict pages (`/connect/*`,
 * `/agents/enable-paid`) after `pnpm build` (spec R-WEB-2, R-WEB-3, R-WEB-4, T18).
 *
 * Static checks, always:
 * - every `<script src>` and script preload of those pages carries a `sha384`
 *   integrity that matches the bytes of the file in `out/`, and `crossorigin`;
 * - `out/_headers` carries, for each strict path and each page under it, the
 *   strict policy of `csp-policy.js` (the one source: every directive but the
 *   two it completes must equal `strictPolicy()`), with `script-src` holding
 *   `'self'` and exactly that page's inline-script hashes, `frame-ancestors
 *   'none'`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
 *
 * Browser check (R-WEB-4): the built site is served with `_headers` applied
 * and each strict page is loaded in an iframe of another origin and of its own;
 * Chrome must refuse every one. The same load reports scripts added at run
 * time without integrity, and fails on a CSP or integrity violation. It needs
 * Chrome (`CHROME_BIN`, or a standard install): without it the step is skipped
 * with a message, unless `CI` is set, where a missing Chrome fails. Needs
 * Node.js 22+ (the global `WebSocket`).
 *
 * Run: node scripts/check-built-headers.js [outDir]   (after `pnpm build`)
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { STRICT_PATHS, strictPolicy, fallbackPolicy } = require("./csp-policy");
const { integrityOf, attr } = require("./add-sri");
const { pagesFor, urlPathOf, inlineScriptHashes } = require("./connect-csp");

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const PRELOAD_SCRIPT_TAG = /<link\b(?=[^>]*\brel=["']?preload\b)(?=[^>]*\bas=["']?script\b)[^>]*>/gi;

/** `{ pattern: { header: [values] } }` for the blocks of a `_headers` text, in order of appearance. */
function parseHeaders(text) {
  const blocks = [];
  for (const line of text.split("\n")) {
    if (/^\S/.test(line) && !line.startsWith("#")) blocks.push({ pattern: line.trim(), headers: {} });
    const header = /^\s+([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (header && blocks.length) (blocks.at(-1).headers[header[1].toLowerCase()] ??= []).push(header[2].trim());
  }
  return blocks;
}

/** Whether a `_headers` pattern (a path or a `/x/*` splat) matches a URL path. */
function matches(pattern, urlPath) {
  return pattern.endsWith("*") ? urlPath.startsWith(pattern.slice(0, -1)) : pattern === urlPath;
}

/** The directives of a policy: `name → [tokens]`. */
function directives(policy) {
  const out = {};
  for (const part of policy.split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name) out[name] = tokens;
  }
  return out;
}

/** Problems with the script tags of one page. */
function checkScripts(outDir, page, html) {
  const problems = [];
  const check = (tag, url, what) => {
    if (!url || !url.startsWith("/") || url.startsWith("//")) {
      problems.push(`${page}: ${what} from outside this origin: ${url}`);
      return;
    }
    const file = path.join(outDir, decodeURIComponent(url.split(/[?#]/)[0]));
    if (!fs.existsSync(file)) {
      problems.push(`${page}: ${what} ${url} is not in out/`);
      return;
    }
    const integrity = attr(tag, "integrity");
    if (!integrity) problems.push(`${page}: ${what} ${url} has no integrity`);
    else if (!integrity.startsWith("sha384-")) problems.push(`${page}: ${what} ${url} integrity is not sha384`);
    else if (integrity !== integrityOf(fs.readFileSync(file))) problems.push(`${page}: ${what} ${url} integrity does not match the file`);
    if (attr(tag, "crossorigin") === null && !/\scrossorigin[\s/>]/i.test(tag)) problems.push(`${page}: ${what} ${url} has no crossorigin`);
  };
  for (const tag of html.match(SCRIPT_TAG) ?? []) {
    const src = attr(tag, "src");
    if (src !== null) check(tag, src, "script");
  }
  for (const tag of html.match(PRELOAD_SCRIPT_TAG) ?? []) check(tag, attr(tag, "href"), "script preload");
  return problems;
}

/** Problems with the policy and headers one block gives one page. */
function checkPolicy(page, block, html) {
  const problems = [];
  const where = `${page} (block ${block.pattern})`;
  const policies = block.headers["content-security-policy"] ?? [];
  if (policies.length !== 1) return [`${where}: needs exactly one Content-Security-Policy, found ${policies.length}`];
  const got = directives(policies[0]);
  // A splat block is the fallback policy (no default/connect/frame-src); a page's own block is the full strict policy.
  // The page's own block also names the API origin the build was given (NEXT_PUBLIC_API_BASE_URL), and nothing else.
  let api = [];
  try {
    api = process.env.NEXT_PUBLIC_API_BASE_URL ? [new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin] : [];
  } catch {}
  const want = directives(block.pattern.endsWith("*") ? fallbackPolicy() : strictPolicy({ connectOrigins: api }));
  const hashes = [...inlineScriptHashes(html)].map((hash) => `'sha256-${hash}'`).sort();
  for (const name of Object.keys(want)) {
    if (name === "script-src") continue;
    if (JSON.stringify(got[name]) !== JSON.stringify(want[name])) problems.push(`${where}: ${name} is not the strict policy's: ${(got[name] ?? ["missing"]).join(" ")}`);
  }
  for (const name of Object.keys(got)) if (!want[name]) problems.push(`${where}: unexpected directive ${name}`);
  const script = got["script-src"] ?? [];
  if (script[0] !== "'self'") problems.push(`${where}: script-src must start with 'self'`);
  const extras = script.slice(1);
  for (const token of extras) {
    if (!/^'sha256-[A-Za-z0-9+/=]+'$/.test(token)) problems.push(`${where}: script-src widened with ${token}`);
  }
  // The page's own block lists exactly its hashes; a splat fallback lists every page's, so it may hold more.
  const missing = hashes.filter((hash) => !extras.includes(hash));
  if (missing.length) problems.push(`${where}: script-src lacks ${missing.length} inline-script hash(es) of the page`);
  const exact = !block.pattern.endsWith("*");
  if (exact && extras.length !== hashes.length) problems.push(`${where}: script-src holds hashes the page does not need`);
  return problems;
}

/** All problems of a built `out/`. */
function checkOut(outDir) {
  const root = path.resolve(outDir);
  const problems = [];
  const headersFile = path.join(root, "_headers");
  if (!fs.existsSync(headersFile)) return ["out/_headers is missing"];
  const blocks = parseHeaders(fs.readFileSync(headersFile, "utf8"));
  const pages = [];
  for (const pattern of STRICT_PATHS) {
    const found = pagesFor(root, pattern);
    if (!found.length) problems.push(`${pattern}: no exported page`);
    for (const file of found) pages.push({ pattern, file, urlPath: urlPathOf(root, file) });
  }
  for (const { pattern, file, urlPath } of pages) {
    const html = fs.readFileSync(file, "utf8");
    problems.push(...checkScripts(root, urlPath, html));
    // The splat's own block, then the block named for this page when there is one.
    const own = blocks.filter((block) => block.pattern === pattern || block.pattern === urlPath);
    if (!own.some((block) => block.pattern === pattern)) problems.push(`${urlPath}: no ${pattern} block in _headers`);
    // Each page needs a block named for it (the build writes one per page), so a page whose block is gone is not left on the splat fallback.
    if (!own.some((block) => block.pattern === urlPath)) problems.push(`${urlPath}: no block named for this page in _headers`);
    for (const block of own) problems.push(...checkPolicy(urlPath, block, html));
    // Framing and referrer headers: Cloudflare joins every matching block, so read their union.
    const union = (name) => own.flatMap((block) => block.headers[name] ?? []).join(",");
    if (union("x-frame-options") !== "DENY") problems.push(`${urlPath}: X-Frame-Options must be DENY, found "${union("x-frame-options")}"`);
    if (union("referrer-policy") !== "no-referrer") problems.push(`${urlPath}: Referrer-Policy must be no-referrer, found "${union("referrer-policy")}"`);
  }
  return problems;
}

/* ---- Browser check ------------------------------------------------------ */

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

/** Serves `out/` with its `_headers` applied (repeated headers comma-joined, as Cloudflare Pages does). */
function serve(outDir, extra = {}) {
  const blocks = parseHeaders(fs.readFileSync(path.join(outDir, "_headers"), "utf8"));
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split(/[?#]/)[0]);
    if (extra[urlPath]) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(extra[urlPath]);
      return;
    }
    const candidates = [urlPath, `${urlPath}.html`, path.join(urlPath, "index.html")].map((p) => path.join(outDir, p));
    const file = candidates.find((c) => c.startsWith(outDir) && fs.existsSync(c) && fs.statSync(c).isFile());
    const headers = {};
    const clean = urlPath.replace(/\.html$/, "").replace(/\/index$/, "") || "/";
    for (const block of blocks) {
      if (!matches(block.pattern, clean) && !matches(block.pattern, urlPath)) continue;
      for (const [name, values] of Object.entries(block.headers)) headers[name] = [headers[name], ...values].filter(Boolean).join(", ");
    }
    if (!file) {
      res.writeHead(404, headers);
      res.end("not found");
      return;
    }
    res.writeHead(200, { ...headers, "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** A minimal DevTools-protocol client over Node's built-in WebSocket. */
async function cdp(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((target) => target.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && waiting.has(message.id)) waiting.get(message.id)(message);
    else events.push(message);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mine = ++id;
      waiting.set(mine, (message) => resolve(message.result ?? { error: message.error }));
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  return { send, events, close: () => ws.close() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  return null;
}

/** Loads the strict pages in iframes and as pages; returns problems and notes. */
async function browserCheck(outDir, chrome) {
  const problems = [];
  const notes = [];
  const root = path.resolve(outDir);
  const strict = [];
  for (const pattern of STRICT_PATHS) for (const file of pagesFor(root, pattern)) strict.push(urlOf(root, file));
  // Another origin (another port) frames the strict pages; a page of the site frames them from the same origin.
  let frames = () => "";
  const site = await serve(root, {
    "/frame-control": "<!doctype html><title>control</title>ok",
    get "/same-origin-frames"() {
      return frames("");
    },
  });
  const origin = `http://127.0.0.1:${site.address().port}`;
  frames = (base) =>
    `<!doctype html><title>frames</title>${[...strict, "/frame-control"].map((p) => `<iframe name="${p}" src="${base}${p}"></iframe>`).join("")}`;
  const outsiderServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(frames(origin));
  });
  await new Promise((resolve) => outsiderServer.listen(0, "127.0.0.1", resolve));
  const outsiderUrl = `http://127.0.0.1:${outsiderServer.address().port}/`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "built-headers-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "about:blank"], { stdio: "ignore" });
  try {
    const up = await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false), 20000);
    if (!up) throw new Error("Chrome did not start");
    const client = await cdp(port);
    await client.send("Page.enable");
    await client.send("Log.enable");
    await client.send("Runtime.enable");

    const refused = async (label, url) => {
      await client.send("Page.navigate", { url });
      await sleep(2500);
      const { frameTree } = await client.send("Page.getFrameTree");
      const children = frameTree.childFrames ?? [];
      for (const target of [...strict, "/frame-control"]) {
        const child = children.find((c) => c.frame.name === target);
        // A frame that is missing is a failure, not a refusal: only a browser error page counts as refused.
        if (!child) {
          problems.push(`${label}: the frame for ${target} is missing, so nothing was tested`);
          continue;
        }
        const blocked = child.frame.url.startsWith("chrome-error:") || Boolean(child.frame.unreachableUrl);
        if (target === "/frame-control") {
          if (blocked) problems.push(`iframe test: the control page was refused too, so the test proves nothing (${label})`);
        } else if (!blocked) problems.push(`${label}: ${target} loaded in an iframe`);
      }
    };
    await refused("other origin", outsiderUrl);
    await refused("same origin", `${origin}/same-origin-frames`);

    // Each strict page as a page: no CSP or integrity violation, and the scripts it adds itself.
    for (const target of strict) {
      client.events.length = 0;
      await client.send("Page.navigate", { url: `${origin}${target}` });
      await sleep(4000);
      const violations = client.events
        .filter((e) => e.method === "Log.entryAdded" || e.method === "Runtime.consoleAPICalled")
        .map((e) => JSON.stringify(e.params).slice(0, 400))
        .filter((text) => /Content Security Policy|integrity|Refused to/i.test(text));
      for (const text of violations) {
        // A third-party frame (Privy's auth iframe) enforces ITS OWN
        // frame-ancestors list, which names the app's real origins and never
        // this throwaway 127.0.0.1 server. That refusal is about the test
        // origin, not about our policy, so it is a note; our own pages being
        // refused framing, or any other violation, still fails.
        const framed = /Framing '([^']+)' violates the following Content Security Policy directive: \\?"frame-ancestors/.exec(text);
        if (framed && new URL(framed[1]).origin !== origin) {
          notes.push(`${target}: ${new URL(framed[1]).origin} refuses to be framed by the test origin (its own frame-ancestors)`);
          continue;
        }
        problems.push(`${target}: ${text}`);
      }
      const runtime = await client.send("Runtime.evaluate", {
        expression: "JSON.stringify([...document.scripts].filter(s => s.src && !s.integrity).map(s => new URL(s.src).pathname))",
        returnByValue: true,
      });
      const plain = JSON.parse(runtime.result?.value ?? "[]");
      notes.push(`${target}: ${plain.length} script(s) in the live DOM without integrity${plain.length ? ` (${plain.slice(0, 3).join(", ")})` : ""}`);
    }
    client.close();
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    site.close();
    outsiderServer.close();
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  return { problems, notes };
}

function urlOf(root, file) {
  return urlPathOf(root, file);
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "out"));
  const problems = checkOut(outDir);
  for (const problem of problems) console.error(`check-built-headers: ${problem}`);
  if (problems.length) process.exit(1);
  console.log("check-built-headers: scripts, policies and framing headers of the strict pages are as required");
  const chrome = findChrome();
  if (!chrome) {
    if (process.env.CI) {
      console.error("check-built-headers: no Chrome found in CI; the iframe test cannot run");
      process.exit(1);
    }
    console.log("check-built-headers: SKIPPED the headless Chrome iframe test (no Chrome found; set CHROME_BIN). It runs in CI.");
    return;
  }
  const result = await browserCheck(outDir, chrome);
  for (const note of result.notes) console.log(`check-built-headers: note: ${note}`);
  for (const problem of result.problems) console.error(`check-built-headers: ${problem}`);
  if (result.problems.length) process.exit(1);
  console.log("check-built-headers: Chrome refused every strict page in an iframe, and loading them raised no CSP or integrity error");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`check-built-headers: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}

module.exports = { checkOut, parseHeaders };
