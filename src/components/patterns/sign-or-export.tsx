"use client";

import { Check, Download, Link2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

import { CopyChip } from "./copy-chip";
import { downloadJson, safeBatchFile, safeBatchFileName, type SafeBatchTransaction } from "./safe-batch";
import { SignAction, type WalletStep, type WalletStepResult } from "./sign-action";
import type { WalletRunState } from "./wallet-steps";

/**
 * A transaction this app built for someone else's key — sign it here when the
 * wallet connected in this browser IS that key, otherwise hand it over as a
 * Safe batch file. One button either way; the calldata sits under
 * "Technical details", never in the body.
 *
 *   <SignOrExport
 *     canSign={walletIsArbiter}
 *     signerLabel="the arbiter (0x12…9aB)"
 *     signLabel="Sign and send the ruling"
 *     steps={[{ id: "send", label: "Cancel 2 penalties", cost: "gas", run: … }]}
 *     functionName="cancelSlashBatch"
 *     chainId="eip155:46630"
 *     transactions={[{ to, value: "0", data }]}
 *     afterExport="Import it in the Safe that holds the arbiter key and sign there. The cases move once it lands."
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
  /** Extra rows under Technical details (signer address, request ids…). */
  details?: readonly { label: string; value: string }[];
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
  resetKey,
  onPhaseChange,
  handoff,
  actionsContainer,
  hideSigner = false,
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
  // Kept per `resetKey`, so downloading twice does not build (and log) the same call twice.
  const [prepared, setPrepared] = React.useState<{ key: string | number | undefined; txs: readonly SafeBatchTransaction[] } | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [prepareError, setPrepareError] = React.useState<string | null>(null);
  const current = prepared && prepared.key === resetKey ? prepared.txs : null;
  const transactions = given ?? current ?? [];
  React.useEffect(() => {
    setDownloaded(false);
    setPrepareError(null);
  }, [resetKey]);

  const download = async () => {
    if (disabled) return;
    setPrepareError(null);
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
  };

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
      Download the file to sign
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
  const exportStatus = prepareError ?? (downloaded ? afterExport : disabled ? (disabledReason ?? "") : "");
  const actions = canSign ? (
    <SignAction
      steps={steps}
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
        <p className={cn("text-body-xs", prepareError ? "text-danger-600" : "text-02")} role="status">
          {exportStatus}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {!canSign && !hideSigner ? (
        <p className="text-body-13 text-02">
          <span className="text-label-13 text-01">Who signs: </span>
          {signerLabel}. That is not the wallet connected here, so download the transaction file and have it signed in the
          multi-signer wallet that holds that key. Nothing changes until it is signed.
        </p>
      ) : null}
      {actionsContainer ? createPortal(actions, actionsContainer) : actions}

      {transactions.length > 0 || details.length > 0 || canSign ? (
      <details className="group w-full rounded-md border border-01 bg-02 px-3 py-2">
        <summary className="cursor-pointer select-none text-label-13 text-02 hover:text-01">Technical details</summary>
        <dl className="mt-2 flex w-full flex-col gap-2">
          <Detail label="Function" value={functionName} />
          <Detail label="Chain" value={chainId} />
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
              {prepareError || downloaded ? (
                <p className={cn("pt-1 text-body-xs", prepareError ? "text-danger-600" : "text-02")} role="status">
                  {prepareError ?? afterExport}
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
