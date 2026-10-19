import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

/* Spec R-WEB-2/3/4, T18: scripts/add-sri.js and scripts/check-built-headers.js on a small built tree. */
const require = createRequire(import.meta.url);
const { completeHeaders } = require("../../scripts/connect-csp.js") as {
  completeHeaders: (text: string, pages: Record<string, Record<string, string>>, origins: string[]) => string;
};
const { addSri } = require("../../scripts/add-sri.js") as { addSri: (dir: string) => { scripts: number; preloads: number; inline: number } };
const { checkOut } = require("../../scripts/check-built-headers.js") as { checkOut: (dir: string) => string[] };

const SCRIPT = "console.log('chunk');";
const HEADERS = readFileSync(join(__dirname, "../../public/_headers"), "utf8");
const page = (extra = "") =>
  `<!doctype html><html><head><script src="/_next/static/chunks/a.js" async=""></script>` +
  `<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/a.js"/>${extra}</head>` +
  `<body><script>self.__x=1</script></body></html>`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A built tree: the strict pages, a chunk, and `_headers` completed the way the build does. */
function build(): string {
  const dir = mkdtempSync(join(tmpdir(), "built-"));
  dirs.push(dir);
  execFileSync("mkdir", ["-p", join(dir, "connect"), join(dir, "agents"), join(dir, "_next/static/chunks")]);
  writeFileSync(join(dir, "_next/static/chunks/a.js"), SCRIPT);
  for (const file of ["connect/authorize.html", "agents/enable-paid.html"]) writeFileSync(join(dir, file), page());
  addSri(dir);
  const pages = {
    "/connect/*": { "/connect/authorize": readFileSync(join(dir, "connect/authorize.html"), "utf8") },
    "/agents/enable-paid": { "/agents/enable-paid": readFileSync(join(dir, "agents/enable-paid.html"), "utf8") },
  };
  writeFileSync(join(dir, "_headers"), completeHeaders(HEADERS, pages, []));
  return dir;
}

describe("add-sri", () => {
  it("adds sha384 integrity to scripts and script preloads, and leaves inline scripts alone", () => {
    const dir = build();
    const html = readFileSync(join(dir, "connect/authorize.html"), "utf8");
    expect(html).toMatch(/<script src="\/_next\/static\/chunks\/a\.js" async="" integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous">/);
    expect(html).toMatch(/<link rel="preload" as="script" fetchPriority="low" href="[^"]+" integrity="sha384-[^"]+" crossorigin="anonymous"\/>/);
    expect(html).toContain("<script>self.__x=1</script>");
  });

  it("is idempotent", () => {
    const dir = build();
    const before = readFileSync(join(dir, "connect/authorize.html"), "utf8");
    addSri(dir);
    expect(readFileSync(join(dir, "connect/authorize.html"), "utf8")).toBe(before);
  });

  it("fails on a referenced script that is missing, or from another origin", () => {
    const dir = build();
    writeFileSync(join(dir, "x.html"), '<script src="/_next/static/chunks/gone.js"></script>');
    expect(() => addSri(dir)).toThrow(/not in/);
    writeFileSync(join(dir, "x.html"), '<script src="https://cdn.example.com/a.js"></script>');
    expect(() => addSri(dir)).toThrow(/outside this origin/);
  });
});

describe("check-built-headers", () => {
  it("passes a correctly built tree", () => {
    expect(checkOut(build())).toEqual([]);
  });

  it("fails a script without integrity", () => {
    const dir = build();
    const file = join(dir, "connect/authorize.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(/ integrity="[^"]+"/g, ""));
    expect(checkOut(dir).join("\n")).toMatch(/has no integrity/);
  });

  it("fails a script whose bytes changed after hashing", () => {
    const dir = build();
    writeFileSync(join(dir, "_next/static/chunks/a.js"), "evil()");
    expect(checkOut(dir).join("\n")).toMatch(/does not match the file/);
  });

  it("fails frame-ancestors 'self' on /connect/authorize", () => {
    const dir = build();
    const file = join(dir, "_headers");
    const lines = readFileSync(file, "utf8").split("\n");
    const at = lines.findIndex((line) => line === "/connect/authorize");
    lines[at + 1] = lines[at + 1].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    writeFileSync(file, lines.join("\n"));
    expect(checkOut(dir).join("\n")).toMatch(/\/connect\/authorize.*frame-ancestors/);
  });

  it("fails when a page's own block is deleted", () => {
    const dir = build();
    const file = join(dir, "_headers");
    const blocks = readFileSync(file, "utf8").split("\n\n");
    writeFileSync(file, blocks.filter((block) => !block.startsWith("/connect/authorize\n")).join("\n\n"));
    expect(checkOut(dir).join("\n")).toMatch(/\/connect\/authorize: no block named for this page/);
  });

  it("fails a widened script-src, a missing X-Frame-Options and a missing referrer policy", () => {
    const dir = build();
    const file = join(dir, "_headers");
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace("script-src 'self'", "script-src 'self' https://cdn.example.com").replace(/ {2}X-Frame-Options: DENY\n/, "").replace("Referrer-Policy: no-referrer", "Referrer-Policy: origin"));
    const out = checkOut(dir).join("\n");
    expect(out).toMatch(/script-src widened/);
    expect(out).toMatch(/X-Frame-Options must be DENY/);
    expect(out).toMatch(/Referrer-Policy must be no-referrer/);
  });

  it("fails when the CLI is run on a broken tree", () => {
    const dir = build();
    const file = join(dir, "connect/authorize.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(/ integrity="[^"]+"/g, ""));
    const run = spawnSync("node", [join(__dirname, "../../scripts/check-built-headers.js"), dir], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("has no integrity");
  });
});
