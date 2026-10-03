/**
 * The frontend's source lock.
 *
 * The backend carries two of these (an ESLint `no-restricted-syntax` rule and
 * assay-backend `test/unit/chains/solana/settlement-client-only.spec.ts`) for one reason:
 * an instruction for the settlement program that is assembled by hand is a
 * second encoder for an account ordering the program checks and nothing here
 * tests. In this exact instruction family that costs real money — put the rent payer in the slot that means "the buyer"
 * and the transaction drains someone else's escrow while every other check
 * stays green.
 *
 * The browser's contract is narrower than the backend's and this test states
 * it: the backend builds every settlement transaction unsigned, answers with
 * base64 wire bytes, and the browser's whole job is to put a wallet signature
 * on them. So `src/` needs no Anchor, no IDL, no generated client and
 * no program id — and if it ever imports one, that is the change to argue
 * about in review, not to discover in an incident.
 *
 * The one transaction this repo does build is `deposit-transaction.ts`: an
 * ordinary SPL `TransferChecked` plus a Memo, touching no program of ours.
 * It is allowed by name, and by name only.
 *
 * Two residuals this file cannot close, on record so nobody reads the test
 * titles as covering more than they do:
 *
 * 1. **This lock guards construction, not mutation.** Its markers are
 *    `createTransactionMessage` and `appendTransactionMessageInstructions`
 *    (plural). `appendTransactionMessageInstruction` (singular — a real
 *    `@solana/kit` export) and `decompileTransactionMessage` are not markers.
 *    Now that the browser legitimately holds settlement wire bytes, so
 *    the cheapest route to a bad instruction is no longer to build one from
 *    scratch — it is to decompile the server's transaction, append an
 *    instruction, and re-compile before signing. Nothing does this today;
 *    this lock would not notice if something did.
 * 2. **A vendored generated client evades the package list.** `FORBIDDEN_IMPORTS`
 *    matches package specifiers. A settlement client checked into `src/` and
 *    imported with a relative path trips none of them. Its only remaining
 *    tripwire is the literal `SETTLEMENT_PROGRAM_ID` string.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The directory this lock scans: `src/`, found by walking up rather
 * than by counting `".."`.
 *
 * This used to be `join(__dirname, "..", "..")`, correct while the file lived
 * at `src/libs/solana/`. Moving it one level deeper to `src/libs/chains/solana/`
 * silently repointed it at `src/libs/` — eight files instead of three hundred —
 * and every ban below would then have been asserted over a directory that
 * contains none of the code they exist to police. The `FILES.length > 100`
 * assertion is what caught it, which is the entire reason that assertion is
 * here; but a lock whose scope depends on its own nesting depth is a trap
 * primed to fire on the next move, so the depth coupling is removed rather
 * than re-counted.
 *
 * `resolveSrc` throws instead of returning a guess. A source lock that cannot
 * find its source must fail, never quietly scan whatever it landed on.
 */
function resolveSrc(): string {
  let dir = __dirname;
  while (basename(dir) !== "src") {
    const parent = join(dir, "..");
    if (parent === dir) {
      throw new Error(
        `source lock: no 'src' directory above ${__dirname}; this lock is scanning nothing`,
      );
    }
    dir = parent;
  }
  return dir;
}

const SRC = resolveSrc();

/**
 * This file's own path, relative to `SRC`.
 *
 * Every assertion below excludes it, because stating a ban means writing the
 * banned string down: the forbidden package names, the program id and the
 * transaction-builder calls all appear here as literals. Without the exclusion
 * the lock reports itself as its only offender and can never be green. The
 * exclusion is by exact path, so a second file cannot inherit it.
 */
const THIS_FILE = "libs/chains/solana/settlement-client-only.test.ts";

/** The settlement program's own id. It has no business in a bundle. */
const SETTLEMENT_PROGRAM_ID = "DbHEzzA6CwKRY9xLGSzDgqei7VmnHpF6YociozaN8qFR";

/**
 * Packages that exist to build or decode settlement instructions. Importing any
 * of them means this repo has started doing the backend's job.
 */
const FORBIDDEN_IMPORTS = [
  "@coral-xyz/anchor",
  "@project-serum/anchor",
  "@x402/settlement-client",
  "settlement-client",
  "@solana/web3.js",
];

/**
 * The only file permitted to assemble a transaction, and the only programs it
 * may assemble one from. Adding a path here is a deliberate act with a reviewer
 * attached; that is the point of the list.
 */
const TRANSACTION_BUILDERS_ALLOWED = ["libs/chains/solana/deposit-transaction.ts"];

const ALLOWED_INSTRUCTION_PACKAGES = [
  "@solana-program/compute-budget",
  "@solana-program/memo",
  "@solana-program/token",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    // Next compiles .js/.jsx/.mjs/.cjs under src/ as readily as .ts/.tsx; a
    // walker that only sees TypeScript is a hole none of the assertions
    // below can see through, since they only ever read what FILES contains.
    return /\.(m|c)?[jt]sx?$/.test(entry) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((full) => ({
  path: relative(SRC, full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

describe("the browser never builds a settlement-program instruction", () => {
  it("scans a non-trivial number of files, so a broken walker cannot pass silently", () => {
    // A test that reads zero files asserts nothing and stays green forever.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN_IMPORTS)("imports %s nowhere", (pkg) => {
    // Match imports in any quote style (double, single, backtick) but only in import contexts.
    // This prevents matching prose mentions like `@solana/web3.js` in comments/docs.
    // from and bare `import "pkg"` require \s+ (must have space); import( and
    // require( use \s* (optional space). The optional `(/[^"'`]*)?` after the
    // package name also catches a subpath specifier (`pkg/dist/cjs`) — the
    // package name no longer has to be the *entire* specifier, just its start.
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(
      `(from\\s+|import\\s+|import\\(\\s*|require\\(\\s*)["'\`]${escapedPkg}(/[^"'\`]*)?["'\`]`,
    );
    const offenders = FILES.filter((f) => f.path !== THIS_FILE && importPattern.test(f.text)).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it("names the settlement program id nowhere", () => {
    const offenders = FILES.filter(
      (f) => f.path !== THIS_FILE && f.text.includes(SETTLEMENT_PROGRAM_ID),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("assembles a transaction message in exactly one file", () => {
    const offenders = FILES.filter(
      (f) =>
        f.path !== THIS_FILE &&
        (f.text.includes("appendTransactionMessageInstructions") ||
          f.text.includes("createTransactionMessage")),
    )
      .map((f) => f.path)
      .filter(
        (p) =>
          !TRANSACTION_BUILDERS_ALLOWED.includes(p) &&
          !TRANSACTION_BUILDERS_ALLOWED.some(
            (allowed) => p === allowed.replace(/\.ts$/, ".test.ts"),
          ),
      );
    expect(offenders).toEqual([]);

    // Positive assertion: the allowed builder must still contain a transaction-message marker.
    // Without this, deleting the builder's body would pass the test (vacuous guard).
    const builder = FILES.find((f) => f.path === TRANSACTION_BUILDERS_ALLOWED[0]);
    expect(
      builder && (builder.text.includes("appendTransactionMessageInstructions") || builder.text.includes("createTransactionMessage")),
      "the allowed builder must contain a transaction-message marker",
    ).toBeTruthy();
  });

  // Named for exactly what this inspects, not for the broader claim its old
  // title made: it only reads `from "@solana..."` specifiers in the allowed
  // builder, in any quote style. A non-`@solana`-prefixed instruction package,
  // or the same package pulled in via `import(...)`, `require(...)`, a bare
  // side-effect import, or a subpath, is not inspected here — those forms are
  // covered for the *forbidden* list above, but this assertion is narrower by
  // design: it only widens the search inside one already-allowed file's
  // `@solana*` imports, it does not re-run the forbidden-import scan.
  it("the allowed builder's `from \"@solana...\"` imports are limited to SPL, system and kit packages", () => {
    const builder = FILES.find((f) => f.path === TRANSACTION_BUILDERS_ALLOWED[0]);
    expect(builder, "the allowed builder still exists at its declared path").toBeDefined();

    // Match imports in any quote style (double, single, backtick).
    const imported = [...builder!.text.matchAll(/from\s+["'\`](@solana[^"'\`]*)["'\`]/g)].map((m) => m[1]);
    const unexpected = imported.filter(
      (pkg) => pkg !== "@solana/kit" && !ALLOWED_INSTRUCTION_PACKAGES.includes(pkg),
    );
    expect(unexpected).toEqual([]);
  });
});
