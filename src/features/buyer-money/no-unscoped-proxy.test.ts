// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Built from parts so that this file does not match itself. */
const UNSCOPED = ["npx -y", "assay-mcp"].join(" ");

/** The proxy is published as a scoped package; an install line naming the bare name would run someone else's package. */
describe("the unscoped proxy package is never named in an install line", () => {
  it("appears in no tracked file outside docs/history", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !f.startsWith("docs/history/"));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // deleted in the working tree
      }
      if (text.includes(UNSCOPED)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});

/** A bare `assay-mcp <subcommand>` in a user-facing string would send a user to a stranger's package. Comments are ignored. */
describe("no user-facing string runs the bare assay-mcp command", () => {
  const BARE = new RegExp(["assay", "-mcp (status|enable-paid|settings|limits|login|logout|doctor|add|allow-paid|disallow-paid)\\b"].join(""));
  const stripComments = (text: string) =>
    text
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l))
      .map((l) => l.replace(/\s\/\/ .*$/, ""))
      .join("\n");

  it("appears in no source string under src", () => {
    const files = execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((f) => /\.(ts|tsx|json)$/.test(f) && !/\.vectors\.json$/.test(f));
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue;
      }
      if (BARE.test(stripComments(text))) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
