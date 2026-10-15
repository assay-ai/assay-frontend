"use client";

import { Check, Download, Link2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { formatClock } from "@/libs/local-time";
import { cn } from "@/utils";

import { CopyChip } from "./copy-chip";
import { recordHandoff, useHandoff } from "./handoff-record";
import { downloadJson, safeBatchFile, safeBatchFileName, type SafeBatchTransaction } from "./safe-batch";
import { SignAction, type WalletStep, type WalletStepResult } from "./sign-action";
import type { WalletRunState } from "./wallet-steps";

/**
 * A transaction this app built for someone else's key — sign it here when the
 * wallet connected in this browser IS that key, otherwise hand it over as a
 * Safe batch file. One button either way. What the call does (`summary`: the
 * decoded action, contract, chain, signer) is always shown next to it; only
 * the raw calldata sits under "Technical details".
 *
 * With `trackIds`, what this browser did is remembered per record (see
 * `handoff-record.ts`): "File downloaded at 10:12, waiting for the signature"
 * or "Sent at 10:12" with the explorer link, after a reload too, and a second
 * download of the same records asks first.
 *
 *   <SignOrExport
 *     canSign={walletIsArbiter}
 *     signerLabel="the arbiter (0x12…9aB)"
 *     signLabel="Sign and send the ruling"
 *     steps={[{ id: "send", label: "Cancel 2 penalties", cost: "gas", run: … }]}
 *     functionName="cancelSlashBatch"
 *     chainId="eip155:46630"
 *     transactions={[{ to, value: "0", data }]}
 *     afterExport="Import it in the arbiter's multi-signer wallet and sign there. The cases move once it lands."
 *   />
 *
 * When the transaction is only built on demand (a ruling is prepared by the
 * backend from the form), pass `prepare` instead of `transactions`: the steps
 * prepare and sign in one go, and Download prepares then downloads, so
 * neither path needs a separate "Prepare" click.
 */
export interface SignOrExportProps {
  /** True when the connected wallet is the signer. */
  canSign: boolean;
  /** Who must sign, in words. */
  signerLabel: React.ReactNode;
  /** The sign button's label, a verb. */
  signLabel: string;
  steps: WalletStep[];
  onSigned?: (results: (WalletStepResult | undefined)[]) => void;
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  describeError?: (error: unknown) => string;
  /** Used for the batch file's name and title. */
  functionName: string;
  chainId: string;
  /** The calls, when already built. */
  transactions?: readonly SafeBatchTransaction[];
  /** Or: build them when Download is pressed. */
  prepare?: () => Promise<readonly SafeBatchTransaction[]>;
  /** The Download button's tone: "danger" when signing it takes money (an uphold). Default primary. */
  exportVariant?: "primary" | "danger";
  /** Disable both paths (e.g. the form is not complete), with the reason. */
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  /** One sentence after the download: where to import it, and what happens then. */
  afterExport: React.ReactNode;
  /**
   * The call in plain words, shown above the buttons, never folded: built
   * from the decoded calldata (`callSummary`), not from labels.
   */
  summary?: readonly { label: string; value: string }[];
  /** A short line under the summary (e.g. "Read from the transaction itself"). */
  summaryNote?: React.ReactNode;
  /** Extra rows under Technical details (signer address, request ids…). */
  details?: readonly { label: string; value: string }[];
  /** The records this call acts on: remembers a download or a send per id across reloads. */
  trackIds?: readonly string[];
  /** Change it when the inputs change: a retry then starts over, and a prepared batch is rebuilt. */
  resetKey?: string | number;
  /** The signing phase, so a sheet can refuse to close mid-signature. */
  onPhaseChange?: (phase: WalletRunState["phase"]) => void;
  /**
   * When this browser cannot sign: a link the signer opens (path or URL) and
   * the message to send with it. Drawn as "Copy link for the signer"; held
   * back with Download while `disabled` (the message says the file is attached).
   */
  handoff?: { link: string; message: string };
  /**
   * Where the buttons go, when not here: a sheet's sticky footer, so they stay
   * on screen while the form above them grows. The explanation and the
   * technical details stay in place.
   */
  actionsContainer?: HTMLElement | null;
  /**
   * Where the downloaded file is signed, in plain words ("the arbiter's
   * multi-signer wallet"). Default "the wallet that holds that key".
   */
  signerWallet?: string;
  /** Leave out the "Who signs" sentence, when the sheet already says it ("What happens"). */
  hideSigner?: boolean;
  className?: string;
}

function absolute(link: string): string {
  if (/^https?:\/\//.test(link) || typeof window === "undefined") return link;
  return `${window.location.origin}${link.startsWith("/") ? "" : "/"}${link}`;
}

export function SignOrExport({
  canSign,
  signerLabel,
  signLabel,
  steps,
  onSigned,
  successTitle,
  successDescription,
  describeError,
  functionName,
  chainId,
  transactions: given,
  prepare,
  disabled,
  disabledReason,
  exportVariant = "primary",
  afterExport,
  details = [],
  summary,
  summaryNote,
  trackIds,
  resetKey,
  onPhaseChange,
  handoff,
  actionsContainer,
  hideSigner = false,
  signerWallet = "the wallet that holds that key",
  className,
}: SignOrExportProps) {
  const [linkCopied, setLinkCopied] = React.useState(false);
  const copyHandoff = async () => {
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(`${handoff.message} ${absolute(handoff.link)}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard refused: nothing else to do */
    }
  };
  const [downloaded, setDownloaded] = React.useState(false);
  const handed = useHandoff(trackIds);
  // A second download of the same records asks first: the Safe would then hold two copies to sign.
  const [confirmAgain, setConfirmAgain] = React.useState(false);
  // Kept per `resetKey`, so downloading twice does not build (and log) the same call twice.
  const [prepared, setPrepared] = React.useState<{ key: string | number | undefined; txs: readonly SafeBatchTransaction[] } | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [prepareError, setPrepareError] = React.useState<string | null>(null);
  const current = prepared && prepared.key === resetKey ? prepared.txs : null;
  const transactions = given ?? current ?? [];
  React.useEffect(() => {
    setDownloaded(false);
    setPrepareError(null);
    setConfirmAgain(false);
  }, [resetKey]);
  const fileAt = handed?.kind === "file" ? handed.at : null;

  const download = async () => {
    if (disabled) return;
    setPrepareError(null);
    if ((fileAt !== null || downloaded) && !confirmAgain) {
      setConfirmAgain(true);
      return;
    }
    setConfirmAgain(false);
    let txs = given ?? current ?? null;
    if (!txs && prepare) {
      setPreparing(true);
      try {
        txs = await prepare();
        setPrepared({ key: resetKey, txs });
      } catch (error) {
        setPrepareError(describeError?.(error) ?? "The transaction could not be prepared. Nothing was downloaded.");
        return;
      } finally {
        setPreparing(false);
      }
    }
    if (!txs || txs.length === 0) return;
    downloadJson(
      safeBatchFileName(functionName, chainId),
      safeBatchFile({ chainId, name: `Assay · ${functionName}`, description: String(signLabel), transactions: txs }),
    );
    setDownloaded(true);
    if (trackIds) recordHandoff(trackIds, { kind: "file", at: Date.now() });
  };

  // The sign path: note the hash once a step is submitted, so a reload still shows it.
  const trackedSteps = React.useMemo<WalletStep[]>(
    () =>
      trackIds
        ? steps.map((step) => ({
            ...step,
            run: (context) =>
              step.run({
                ...context,
                report: (report) => {
                  if (report.stage === "submitted" && typeof report.data === "string") {
                    recordHandoff(trackIds, { kind: "sent", at: Date.now(), hash: report.data, explorerUrl: report.explorerUrl });
                  }
                  context.report(report);
                },
              }),
          }))
        : steps,
    [steps, trackIds],
  );

  const downloadButton = (
    <Button
      type="button"
      icon={<Download aria-hidden="true" />}
      onClick={() => void download()}
      loading={preparing}
      disabled={disabled}
      variant={exportVariant}
      className={cn(!actionsContainer && "w-full tablet:w-auto", actionsContainer && !handoff && "col-span-2")}
    >
      {confirmAgain ? "Download it again" : "Download the file to sign"}
    </Button>
  );
  const handoffButton = handoff ? (
    <Button
      type="button"
      variant="secondary"
      icon={linkCopied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      onClick={() => void copyHandoff()}
      // The signer needs the file too: the link waits with the download, and the same reason shows under both.
      disabled={disabled}
      className={actionsContainer ? undefined : "w-full tablet:w-auto"}
    >
      {linkCopied ? "Link copied" : "Copy link for the signer"}
    </Button>
  ) : null;
  const againText =
    fileAt !== null
      ? `You already downloaded this file at ${formatClock(fileAt)}. If it is in the Safe already, a second copy asks the signers twice. Press again to download it anyway.`
      : "You already downloaded this file. If it is in the Safe already, a second copy asks the signers twice. Press again to download it anyway.";
  const exportStatus =
    prepareError ?? (confirmAgain ? againText : downloaded ? afterExport : disabled ? (disabledReason ?? "") : "");
  const actions = canSign ? (
    <SignAction
      steps={trackedSteps}
      label={signLabel}
      disabled={disabled}
      disabledReason={disabledReason}
      resetKey={resetKey}
      onPhaseChange={onPhaseChange}
      onSuccess={onSigned}
      successTitle={successTitle}
      successDescription={successDescription}
      describeError={describeError}
    />
  ) : (
    <div className="flex w-full flex-col gap-2">
      {actionsContainer ? (
        // A sheet footer: the action on the right, the hand-off on its left; side by side on a phone too.
        <div className="grid w-full grid-cols-2 gap-2 [&>*]:min-w-0 [&>*]:!whitespace-normal [&>*]:text-center tablet:flex tablet:justify-end">
          {handoffButton}
          {downloadButton}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-center">
          {downloadButton}
          {handoffButton}
        </div>
      )}
      {exportStatus ? (
        <p className={cn("text-body-xs", prepareError ? "text-danger-600" : confirmAgain ? "text-warning-700" : "text-02")} role="status">
          {exportStatus}
        </p>
      ) : null}
    </div>
  );

  const chainName = stakeDeploymentFor(chainId)?.displayName ?? null;

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {summary && summary.length > 0 ? (
        <section aria-label="What you sign" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 px-3 py-2.5">
          <h3 className="text-label-13 text-01">What you sign</h3>
          <dl className="grid w-full grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-13">
            {summary.map((line) => (
              <React.Fragment key={line.label}>
                <dt className="text-03">{line.label}</dt>
                <dd className="min-w-0 text-01 [overflow-wrap:anywhere]">{line.value}</dd>
              </React.Fragment>
            ))}
          </dl>
          {summaryNote ? <p className="text-body-xs text-03">{summaryNote}</p> : null}
        </section>
      ) : null}
      {handed ? (
        <p role="status" className="w-full rounded-md border border-01 bg-01 px-3 py-2 text-body-13 text-02">
          {handed.kind === "file" ? (
            <>
              <span className="text-label-13 text-01">File downloaded at {formatClock(handed.at)}, waiting for the signature.</span> Nothing
              changes until it is signed in {signerWallet} and lands on chain.
            </>
          ) : (
            <>
              <span className="text-label-13 text-01">Sent at {formatClock(handed.at)}, waiting for the chain.</span> It moves once the
              chain watcher sees it.{" "}
              {handed.explorerUrl ? (
                <a href={handed.explorerUrl} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">
                  View the transaction
                </a>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      {!canSign && !hideSigner ? (
        <p className="text-body-13 text-02">
          <span className="text-label-13 text-01">Who signs: </span>
          {signerLabel}. That is not the wallet connected here, so download the transaction file and have it signed in{" "}
          {signerWallet}. Nothing changes until it is signed.
        </p>
      ) : null}
      {actionsContainer ? createPortal(actions, actionsContainer) : actions}

      {transactions.length > 0 || details.length > 0 || canSign ? (
      <details className="group w-full rounded-md border border-01 bg-02 px-3 py-2">
        <summary className="cursor-pointer select-none text-label-13 text-02 hover:text-01">Technical details</summary>
        <dl className="mt-2 flex w-full flex-col gap-2">
          <Detail label="Function" value={functionName} />
          <Detail label="Chain" value={chainName ? `${chainName} (${chainId})` : chainId} />
          {details.map((row) => (
            <Detail key={row.label} label={row.label} value={row.value} />
          ))}
          {transactions.map((tx, index) => (
            <React.Fragment key={index}>
              <Detail label={transactions.length > 1 ? `Contract (${index + 1})` : "Contract"} value={tx.to} />
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-body-xs text-03">Calldata</dt>
                <dd className="flex min-w-0 flex-col items-start gap-1">
                  <span className="max-h-24 w-full overflow-y-auto break-all font-mono text-mono-xs text-02">{tx.data}</span>
                  <CopyChip value={tx.data} display="Copy calldata" label="calldata" />
                </dd>
              </div>
            </React.Fragment>
          ))}
          {canSign ? (
            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                loading={preparing}
                disabled={disabled}
                onClick={() => void download()}
              >
                Download the file to sign in a Safe instead
              </Button>
              {prepareError || downloaded || confirmAgain ? (
                <p className={cn("pt-1 text-body-xs", prepareError ? "text-danger-600" : confirmAgain ? "text-warning-700" : "text-02")} role="status">
                  {prepareError ?? (confirmAgain ? againText : afterExport)}
                </p>
              ) : null}
            </div>
          ) : null}
        </dl>
      </details>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="break-all font-mono text-mono-xs text-01">{value}</dd>
    </div>
  );
}
