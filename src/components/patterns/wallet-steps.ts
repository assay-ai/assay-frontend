/**
 * The logic behind `<SignAction>`, with no React in it: run an ordered list of
 * wallet steps, report progress, and stop cleanly on the first refusal.
 *
 * Kept generic on purpose — a step is a label, a cost badge and a promise.
 * Nothing here knows about chains, transactions or Privy; a caller wraps its
 * own `signAndSend` in `run()`.
 */

export type WalletStepCost = "free" | "gas";

export interface WalletStepResult {
  /** A link to the transaction on an explorer, when there is one. */
  explorerUrl?: string;
  /** Anything the caller wants to hand to the next step. */
  data?: unknown;
}

/** Where a running step is. Reported by the step itself through `context.report`. */
export type WalletStepStage = "preparing" | "wallet" | "submitted";

export interface WalletStepReport {
  stage: WalletStepStage;
  /** Once submitted: the transaction on an explorer. */
  explorerUrl?: string;
  /** Once submitted: whatever identifies it (a tx hash), handed back on a retry. */
  data?: unknown;
}

export interface WalletStepContext {
  /** What the earlier steps returned. */
  results: readonly (WalletStepResult | undefined)[];
  /**
   * Tell the tracker where you are: `"preparing"` while building the
   * transaction, `"wallet"` when the prompt is open, `"submitted"` (with the
   * explorer link and tx hash) the moment it is broadcast. Report
   * `"submitted"` BEFORE waiting for confirmation: it is what makes a retry safe.
   */
  report: (report: WalletStepReport) => void;
  /**
   * Set on a retry of a step that had already been submitted when it failed
   * (e.g. the receipt wait timed out). Do NOT send again: check the status of
   * `previousAttempt.data` (the tx hash) and resolve or throw from that.
   */
  previousAttempt?: WalletStepReport;
  /**
   * What the wallet's own confirmation should say for this step (lot 1 D14):
   * the step's `promptTitle` (default its label) and its `promptDescription`,
   * with "Signature 2 of 2." in front when the flow has more than one. Hand
   * it to `withWalletPrompt` on the step's signer.
   */
  prompt?: WalletStepPrompt;
}

/** The text of a wallet prompt; the same shape as `WalletPromptText` in `useSigner`. */
export interface WalletStepPrompt {
  title?: string;
  description?: string;
}

/** The prompt text of step `index` of `count`. */
export function stepPrompt(step: Pick<WalletStep, "label" | "promptTitle" | "promptDescription">, index: number, count: number): WalletStepPrompt {
  const description = [count > 1 ? `Signature ${index + 1} of ${count}.` : null, step.promptDescription ?? null]
    .filter(Boolean)
    .join(" ");
  return { title: step.promptTitle ?? step.label, ...(description ? { description } : {}) };
}

export interface WalletStep {
  id: string;
  /** What the person approves, in their words: "Approve USDG", "Deposit $20". */
  label: string;
  /** "free" for a signature only, "gas" when the person pays a network fee. */
  cost: WalletStepCost;
  /**
   * Leave this step out — e.g. "approve" when the allowance already covers the
   * amount. Decided by the caller from data it already has, so the tracker
   * never promises a prompt that does not come.
   */
  skip?: boolean;
  /** The wallet prompt's title, with the amount; default `label`. */
  promptTitle?: string;
  /** One sentence for the wallet prompt: what this signature does, with the amount. */
  promptDescription?: string;
  /**
   * This step may finish without a prompt (an approval the allowance already
   * covers), so the sheet says "up to N signatures".
   */
  mayNotPrompt?: boolean;
  /**
   * Opens the wallet and resolves when this step is done (confirmed). Throw
   * (or reject) to stop the sequence. See `WalletStepContext` for `report`.
   */
  run: (context: WalletStepContext) => Promise<WalletStepResult | void>;
}

export type StepStatus = "upcoming" | "active" | "done" | "declined" | "failed";

export type WalletRunState =
  | { phase: "idle"; results: (WalletStepResult | undefined)[] }
  | {
      phase: "running";
      index: number;
      /** Where the step says it is; "wallet" until it reports otherwise. */
      stage: WalletStepStage;
      explorerUrl?: string;
      results: (WalletStepResult | undefined)[];
    }
  | { phase: "declined"; index: number; results: (WalletStepResult | undefined)[] }
  | {
      phase: "failed";
      index: number;
      error: unknown;
      /** Present when the step had been broadcast before it failed: retrying must not resend. */
      submitted?: WalletStepReport;
      results: (WalletStepResult | undefined)[];
    }
  | { phase: "success"; results: (WalletStepResult | undefined)[] };

export const IDLE: WalletRunState = { phase: "idle", results: [] };

/**
 * Whether an error is the person saying no in their wallet, as opposed to
 * something breaking. Covers EIP-1193 (`4001`), viem's
 * `UserRejectedRequestError`, Solana wallet adapters and Privy's wording.
 * Walks `cause`, because viem wraps the provider error.
 */
export function isUserRejection(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const e = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown; shortMessage?: unknown };
  if (e.code === 4001 || e.code === "ACTION_REJECTED" || e.code === "user_rejected") return true;
  if (typeof e.name === "string" && /UserRejected|WalletSignTransactionError|user.?cancel/i.test(e.name)) return true;
  const text = [e.message, e.shortMessage].filter((v) => typeof v === "string").join(" ");
  if (/user (rejected|denied|declined|cancell?ed)|rejected the request|request (was )?rejected|declined by user|user_cancelled|closed the modal/i.test(text)) {
    return true;
  }
  return isUserRejection(e.cause, depth + 1);
}

/** Per-step status for the tracker, from the run state. */
export function stepStatuses(count: number, state: WalletRunState): StepStatus[] {
  return Array.from({ length: count }, (_, i): StepStatus => {
    if (state.phase === "success") return "done";
    if (state.phase === "idle") return state.results[i] !== undefined ? "done" : "upcoming";
    if (i < state.index) return "done";
    if (i > state.index) return "upcoming";
    if (state.phase === "running") return "active";
    return state.phase === "declined" ? "declined" : "failed";
  });
}

/**
 * Runs `steps` from `startAt`, calling `onChange` on every transition, and
 * returns the final state. A retry passes the previous state's `index` as
 * `startAt` and its `results` (steps that went through are not signed twice),
 * and `previousAttempt` when the failed step had been submitted.
 */
export async function runWalletSteps(
  steps: readonly WalletStep[],
  options: {
    startAt?: number;
    results?: (WalletStepResult | undefined)[];
    previousAttempt?: WalletStepReport;
    onChange?: (state: WalletRunState) => void;
    isRejection?: (error: unknown) => boolean;
  } = {},
): Promise<WalletRunState> {
  const { startAt = 0, onChange, isRejection = isUserRejection } = options;
  const results = [...(options.results ?? [])].slice(0, startAt);

  for (let index = startAt; index < steps.length; index++) {
    const previousAttempt = index === startAt ? options.previousAttempt : undefined;
    let submitted: WalletStepReport | undefined = previousAttempt;
    let running: Extract<WalletRunState, { phase: "running" }> = {
      phase: "running",
      index,
      stage: previousAttempt ? "submitted" : "wallet",
      explorerUrl: previousAttempt?.explorerUrl,
      results: [...results],
    };
    onChange?.(running);
    const report = (next: WalletStepReport) => {
      if (next.stage === "submitted") submitted = next;
      running = { ...running, stage: next.stage, explorerUrl: next.explorerUrl ?? running.explorerUrl };
      onChange?.(running);
    };
    try {
      const prompt = stepPrompt(steps[index]!, index, steps.length);
      const result = await steps[index]!.run({ results: [...results], report, previousAttempt, prompt });
      results[index] = { explorerUrl: submitted?.explorerUrl, ...(result ?? {}) };
    } catch (error) {
      const state: WalletRunState =
        isRejection(error) && !submitted
          ? { phase: "declined", index, results: [...results] }
          : { phase: "failed", index, error, submitted, results: [...results] };
      onChange?.(state);
      return state;
    }
  }

  const done: WalletRunState = { phase: "success", results: [...results] };
  onChange?.(done);
  return done;
}

/** The last explorer link any step returned — the one a success screen links to. */
export function lastExplorerUrl(results: readonly (WalletStepResult | undefined)[]): string | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    const url = results[i]?.explorerUrl;
    if (url) return url;
  }
  return undefined;
}

/** "Signature 1 of 2" — the tracker headline. Single-step flows get no counter. */
/**
 * Said under the button before a flow with more than one wallet prompt starts
 * (lot 1 D14), so the second signature never comes as a surprise.
 */
export function signatureCountNote(steps: readonly Pick<WalletStep, "mayNotPrompt">[]): string | null {
  if (steps.length <= 1) return null;
  const upTo = steps.some((step) => step.mayNotPrompt) ? "Up to " : "";
  return `${upTo}${steps.length} signatures in your wallet, one after the other`;
}

export function trackerHeadline(count: number, state: WalletRunState, noun = "Signature"): string | null {
  if (count <= 1) return null;
  if (state.phase === "success") return `${count} of ${count} done`;
  const index = state.phase === "idle" ? 0 : state.index;
  return `${noun} ${index + 1} of ${count}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * DEMO ONLY: the same steps, walked through without a wallet. Same ids,
 * labels, costs and skips, so the tracker and the success state look exactly
 * like the real run; each `run` waits a moment and returns `demo:<id>`. The
 * real `run` is never called, so nothing is signed or sent.
 */
export function simulatedSteps(steps: readonly WalletStep[], delayMs = 700): WalletStep[] {
  return steps.map((step) => ({
    id: step.id,
    label: step.label,
    cost: step.cost,
    skip: step.skip,
    mayNotPrompt: step.mayNotPrompt,
    run: async ({ report }) => {
      report({ stage: "wallet" });
      await wait(delayMs);
      return { data: `demo:${step.id}` };
    },
  }));
}
