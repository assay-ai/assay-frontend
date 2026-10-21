"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CircleCheck,
  Clock,
  KeyRound,
  Lock,
  Pause,
  PenLine,
  Play,
  RefreshCw,
  Scale,
  ShieldCheck,
  Undo2,
  Wallet,
} from "lucide-react";
import * as React from "react";

import { ChangeRows, type ConfirmChange } from "@/components/patterns/change-rows";
import { CopyChip, shortId } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { PresetChips } from "@/components/patterns/preset-chips";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { durationText } from "@/features/operator/arbiter";
import { chainDisplayName } from "@/features/operator/call-summary";
import { ContractCallAction } from "@/features/operator/contract-call-action";
import {
  PARAM_GROUPS,
  VERIFIER_LIFETIME_PRESETS,
  checkNewArbiter,
  checkNewVerifier,
  checkSlashDelay,
  confirmWordMatches,
  delayToForm,
  formToParams,
  paramChanges,
  paramText,
  paramsToForm,
  splitText,
  verifierStatusText,
  type DelayUnit,
  type FormErrors,
  type NewVerifierForm,
  type ParamsForm,
} from "@/features/operator/contract-settings";
import { ResultCard } from "@/features/operator/result-card";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import { WhatHappens, type WhatHappensLine } from "@/features/operator/what-happens";
import { useConnectedAddresses } from "@/hooks/useSigner";
import { sameEvmAddress } from "@/libs/chains/evm/contract-call";
import {
  buildConfigCall,
  createConfigChainReader,
  labelBytes32,
  loadVerifierKeys,
  type ConfigAdminCall,
  type ContractSettings,
  type VerifierKeyRow,
} from "@/libs/chains/evm/contract-config";
import {
  STAKE_DEPLOYMENTS,
  explorerAddressLink,
  explorerTxLink,
  stakeDeploymentFor,
  type StakeDeployment,
} from "@/libs/chains/evm/stake-slashes/deployments";
import { cn } from "@/utils";

/**
 * Contracts, route `/operator/contracts` — the contracts' admin settings,
 * so the admin never fills a form in a block explorer again.
 *
 * Everything on the page is read straight from the pinned config contract
 * over the pinned RPC (`contract-config.ts`), never from Assay's backend.
 * Each card is one setting: what it is now, in plain units, and one button.
 * The button opens a sheet: the form (prefilled with the current value), then
 * a review of exactly what changes, before → after, with the contract's own
 * rules checked first, then "Sign and send" when this browser holds the admin
 * key, or a file to sign in the wallet that does. The calldata is built here
 * and decoded again before it is offered (`ContractCallAction`).
 *
 * The owner's doors (replacing the admin, upgrading the contracts) are shown
 * read-only: the owner is a cold key and those stay in the runbook.
 */

const DAY = 86_400;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isoAt(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function ContractsScreen() {
  const me = useOperatorSession();
  const isAdmin = capabilitiesFor(me.roles).manageOperators;
  const queryClient = useQueryClient();
  const [chainId, setChainId] = React.useState(STAKE_DEPLOYMENTS[0]!.chainId);
  const deployment = stakeDeploymentFor(chainId)!;
  const reader = React.useMemo(() => createConfigChainReader(deployment), [deployment]);

  const settings = useQuery({
    queryKey: ["operator", "contracts", chainId, "settings"],
    queryFn: () => reader.readSettings(),
    retry: 1,
    // Read when the page opens and on "Read again", not behind an open form's back.
    refetchOnWindowFocus: false,
    enabled: isAdmin,
  });
  const verifiers = useQuery({
    queryKey: ["operator", "contracts", chainId, "verifiers"],
    queryFn: () => loadVerifierKeys(reader, deployment, nowSeconds()),
    retry: 1,
    enabled: isAdmin,
  });

  const connected = useConnectedAddresses();
  const adminConnected = settings.data ? connected.some((address) => sameEvmAddress(address, settings.data.admin)) : false;

  const [sheet, setSheet] = React.useState<SheetId | null>(null);
  const [revoking, setRevoking] = React.useState<VerifierKeyRow | null>(null);
  const [result, setResult] = React.useState<{ title: string; hash: string | null } | null>(null);

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "contracts", chainId] });
    // A new arbiter, a pause or a new slash split changes what the arbiter page reads too.
    void queryClient.invalidateQueries({ queryKey: ["operator", "arbiter"] });
  }, [queryClient, chainId]);

  if (!isAdmin) {
    return (
      <PageState
        kind="blocked"
        title="Contracts is the admin's page"
        description="It changes the contracts' settings with the admin key. Ask an operator with the Admin role."
      />
    );
  }

  const onDone = (title: string, hash: string | null) => {
    setSheet(null);
    setRevoking(null);
    setResult({ title, hash });
    refresh();
  };

  const data = settings.data;

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Contracts</h1>
          <p className="text-body-13 text-03">
            The settings on {chainDisplayName(chainId)}, read from the chain. Only the admin key can change them.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {STAKE_DEPLOYMENTS.length > 1 ? (
            <Select label="Chain" value={chainId} onChange={(e) => setChainId(e.target.value)}>
              {STAKE_DEPLOYMENTS.map((d) => (
                <option key={d.chainId} value={d.chainId}>
                  {d.displayName}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw aria-hidden="true" />}
            loading={settings.isFetching || verifiers.isFetching}
            onClick={refresh}
          >
            Read again
          </Button>
        </div>
      </header>

      {result ? (
        <ResultCard
          title={result.title}
          next={result.hash ? "The values below are read again from the chain." : undefined}
          txUrl={result.hash ? explorerTxLink(deployment, result.hash) : null}
          onDismiss={() => setResult(null)}
        />
      ) : null}

      {settings.isLoading ? (
        <PageState kind="loading" rows={4} label="Reading the contracts" />
      ) : settings.isError || !data ? (
        <PageState
          kind="error"
          title="The contracts could not be read"
          description={`${chainDisplayName(chainId)}'s RPC did not answer. Nothing is shown rather than old values.`}
          details={settings.error instanceof Error ? settings.error.message : null}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <>
          <SignerLine settings={data} adminConnected={adminConnected} />

          <PauseCard settings={data} onChange={() => setSheet("pause")} />

          <SettingCard
            icon={PenLine}
            title="Fees and stake"
            description="What Assay takes, what a penalty costs and how stake works. Changed together, in one transaction."
            action={<Button size="sm" variant="secondary" onClick={() => setSheet("params")}>Change</Button>}
          >
            <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-4 min-[560px]:grid-cols-2">
              {PARAM_GROUPS.map((group) => (
                <div key={group.title} className="flex min-w-0 flex-col gap-2">
                  <p className="text-label-xs uppercase tracking-wide text-03">{group.title}</p>
                  {group.fields.map((field) => (
                    <div key={field.key} className="flex min-w-0 items-baseline justify-between gap-3 text-body-13">
                      <dt className="text-02">{field.label}</dt>
                      <dd className="min-w-0 text-right tabular-nums text-01">
                        {field.kind === "address" ? (
                          <AddressChip deployment={deployment} value={String(data.params[field.key])} label={`${field.label} address`} />
                        ) : (
                          paramText(field.key, data.params, data.asset)
                        )}
                      </dd>
                    </div>
                  ))}
                  {group.title === "Penalties" ? <p className="text-body-xs text-03">Split: {splitText(data.params)}.</p> : null}
                </div>
              ))}
            </dl>
          </SettingCard>

          <SettingCard
            icon={Clock}
            title="Penalty dispute window"
            description="How long a provider has to dispute a penalty before it can be taken."
            action={<Button size="sm" variant="secondary" onClick={() => setSheet("delay")}>Change</Button>}
          >
            <p className="text-heading-sm tabular-nums text-01">{durationText(data.slashDelaySeconds)}</p>
          </SettingCard>

          <SettingCard
            icon={Scale}
            title="Arbiter"
            description="The person who rules on disputed penalties and can block a wallet on chain."
            action={
              <Button size="sm" variant="secondary" onClick={() => setSheet("arbiter")}>
                {data.arbiter ? "Replace" : "Appoint"}
              </Button>
            }
          >
            {data.arbiter ? (
              <AddressChip deployment={deployment} value={data.arbiter} label="arbiter address" />
            ) : (
              <p className="text-body-13 text-warning-700">No arbiter is appointed, so disputes cannot be ruled on.</p>
            )}
          </SettingCard>

          <VerifierCard
            deployment={deployment}
            query={verifiers}
            onAdd={() => setSheet("verifier")}
            onRevoke={(row) => setRevoking(row)}
          />

          <SettingCard
            icon={Lock}
            title="Owner"
            description="The owner key appoints the admin and upgrades the contracts. It is a cold key: those steps follow the deploy runbook, not this page."
          >
            <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-2 text-body-13 min-[560px]:grid-cols-3">
              <Fact label="Owner">
                <AddressChip deployment={deployment} value={data.owner} label="owner address" />
              </Fact>
              <Fact label="Admin">
                <AddressChip deployment={deployment} value={data.admin} label="admin address" />
              </Fact>
              <Fact label="Config contract">
                <AddressChip deployment={deployment} value={data.config} label="config contract address" />
              </Fact>
            </dl>
          </SettingCard>

          <PauseSheet open={sheet === "pause"} settings={data} deployment={deployment} onClose={() => setSheet(null)} onDone={onDone} />
          <ParamsSheet open={sheet === "params"} settings={data} deployment={deployment} onClose={() => setSheet(null)} onDone={onDone} />
          <DelaySheet open={sheet === "delay"} settings={data} deployment={deployment} onClose={() => setSheet(null)} onDone={onDone} />
          <ArbiterSheet
            open={sheet === "arbiter"}
            settings={data}
            verifiers={verifiers.data ?? null}
            deployment={deployment}
            onClose={() => setSheet(null)}
            onDone={onDone}
          />
          <VerifierSheet
            open={sheet === "verifier"}
            settings={data}
            verifiers={verifiers.data ?? null}
            deployment={deployment}
            onClose={() => setSheet(null)}
            onDone={onDone}
          />
          <RevokeSheet row={revoking} settings={data} deployment={deployment} onClose={() => setRevoking(null)} onDone={onDone} />
        </>
      )}
    </>
  );
}

type SheetId = "pause" | "params" | "delay" | "arbiter" | "verifier";

// ── Pieces of the page ─────────────────────────────────────────────────────

function SignerLine({ settings, adminConnected }: { settings: ContractSettings; adminConnected: boolean }) {
  return (
    <p
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-3.5 py-2.5 text-body-13",
        adminConnected ? "border-success-20 bg-success-10 text-02" : "border-01 bg-02 text-02",
      )}
    >
      <Wallet aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", adminConnected ? "text-success-600" : "text-03")} />
      {adminConnected ? (
        <span>The admin&rsquo;s wallet is connected here, so each change is signed in this browser.</span>
      ) : (
        <span>
          Changes are signed by the admin key <span className="font-mono text-mono-12">{shortId(settings.admin)}</span>, which isn&rsquo;t
          connected here. Connect it (a Ledger through your browser wallet) to sign each change in this browser; for a Safe, each change
          downloads as a file to sign there.
        </span>
      )}
    </p>
  );
}

function SettingCard({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "danger";
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex w-full flex-col gap-3 rounded-xl border bg-01 p-4", tone === "danger" ? "border-danger-20" : "border-01")}
    >
      <div className="flex w-full items-start gap-3">
        <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-danger-600" : "text-03")} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-label-sm text-01">{title}</h2>
          <p className="text-body-13 text-03">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="flex w-full flex-col gap-2 pl-7">{children}</div> : null}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="min-w-0 text-01">{children}</dd>
    </div>
  );
}

function AddressChip({ deployment, value, label }: { deployment: StakeDeployment; value: string; label: string }) {
  const href = explorerAddressLink(deployment, value);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <CopyChip value={value} label={label} />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-label-xs text-primary-600 hover:underline">
          Explorer
        </a>
      ) : null}
    </span>
  );
}

function PauseCard({ settings, onChange }: { settings: ContractSettings; onChange: () => void }) {
  return (
    <SettingCard
      icon={settings.paused ? AlertTriangle : CircleCheck}
      tone={settings.paused ? "danger" : "neutral"}
      title={settings.paused ? "The contracts are paused" : "The contracts are running"}
      description={
        settings.paused
          ? "No payment, deposit, withdrawal, stake or penalty goes through until they are resumed."
          : "Pause stops every payment, deposit, withdrawal, stake and penalty at once. For an incident."
      }
      action={
        settings.paused ? (
          <Button size="sm" variant="primary" icon={<Play aria-hidden="true" />} onClick={onChange}>
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="danger" icon={<Pause aria-hidden="true" />} onClick={onChange}>
            Pause
          </Button>
        )
      }
    />
  );
}

function VerifierCard({
  deployment,
  query,
  onAdd,
  onRevoke,
}: {
  deployment: StakeDeployment;
  query: { data?: VerifierKeyRow[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  onAdd: () => void;
  onRevoke: (row: VerifierKeyRow) => void;
}) {
  const now = nowSeconds();
  const rows = query.data ?? [];
  const live = rows.filter((row) => row.status === "active");
  const soonest = live.reduce<VerifierKeyRow | null>((min, row) => (min === null || row.expiresAt < min.expiresAt ? row : min), null);
  return (
    <SettingCard
      icon={KeyRound}
      title="Verifier keys"
      description="The backend's keys that sign penalties. A key is registered once and expires; rotate to a new address before it does."
      action={
        <Button size="sm" variant="secondary" onClick={onAdd} disabled={!query.data}>
          Add a key
        </Button>
      }
    >
      {query.isLoading ? (
        <PageState kind="loading" rows={2} label="Reading the verifier keys" bare />
      ) : query.isError ? (
        <PageState
          kind="error"
          title="The keys could not be read"
          details={query.error instanceof Error ? query.error.message : null}
          onRetry={() => void query.refetch()}
          bare
        />
      ) : rows.length === 0 ? (
        <p className="text-body-13 text-warning-700">No verifier key is registered, so no penalty can be signed.</p>
      ) : (
        <>
          {live.length === 0 ? (
            <p className="text-body-13 text-warning-700">No key can sign right now: every key has expired or been revoked. Add a new one.</p>
          ) : soonest && soonest.expiresAt - now < 14 * DAY ? (
            <p className="text-body-13 text-warning-700">
              {soonest.label || shortId(soonest.address)} {verifierStatusText(soonest, now).toLowerCase()}. Register its replacement before then.
            </p>
          ) : null}
          <ul className="flex w-full flex-col divide-y divide-01 overflow-hidden rounded-lg border border-01">
            {rows.map((row) => (
              <li key={row.address} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-label-13 text-01">
                    {row.label || "Unnamed key"}
                    <StatusPill row={row} now={now} />
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03">
                    <AddressChip deployment={deployment} value={row.address} label="verifier key address" />
                    <span>
                      added <UtcTime value={isoAt(row.registeredAt)} dateOnly midSentence />
                      {row.revokedAt ? (
                        <>
                          {" "}
                          · revoked <UtcTime value={isoAt(row.revokedAt)} dateOnly midSentence />
                        </>
                      ) : (
                        <>
                          {" "}
                          · {row.status === "expired" ? "expired" : "expires"} <UtcTime value={isoAt(row.expiresAt)} dateOnly midSentence />
                        </>
                      )}
                    </span>
                  </p>
                </div>
                {row.status !== "revoked" ? (
                  <Button size="sm" variant="ghost" icon={<Ban aria-hidden="true" />} onClick={() => onRevoke(row)}>
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingCard>
  );
}

function StatusPill({ row, now }: { row: VerifierKeyRow; now: number }) {
  const text = verifierStatusText(row, now);
  const tone =
    row.status === "active" ? (row.expiresAt - now < 14 * DAY ? "warning" : "ok") : row.status === "expired" ? "warning" : "muted";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-label-xs",
        tone === "ok" && "bg-success-10 text-success-700",
        tone === "warning" && "bg-warning-10 text-warning-700",
        tone === "muted" && "bg-03 text-03",
      )}
    >
      {text}
    </span>
  );
}

// ── The sheet every change goes through ─────────────────────────────────────

interface Prepared {
  call: ConfigAdminCall;
  /** Before → after, exactly what the transaction changes. */
  changes: ConfirmChange[];
}

interface Confirmation {
  /** A word to type, for a change that stops or removes something. */
  word?: string;
  /** A box to tick, for a change of who holds a role or where money goes. */
  acknowledge?: string;
}

/**
 * Edit → review → sign. `prepare` validates the form and returns the call and
 * its before → after rows (or null, having set the form's errors). A sheet
 * without a form (`children` absent) opens on the review.
 */
function ChangeSheet({
  open,
  title,
  outcome,
  settings,
  deployment,
  prepare,
  confirmation,
  danger = false,
  signLabel,
  successTitle,
  onClose,
  onDone,
  children,
}: {
  open: boolean;
  title: string;
  outcome: readonly WhatHappensLine[];
  settings: ContractSettings;
  deployment: StakeDeployment;
  prepare: () => Prepared | null;
  confirmation?: Confirmation | ((prepared: Prepared) => Confirmation | undefined);
  danger?: boolean;
  signLabel: string;
  successTitle: string;
  onClose: () => void;
  onDone: (title: string, hash: string | null) => void;
  children?: React.ReactNode;
}) {
  const hasForm = children !== undefined;
  const [prepared, setPrepared] = React.useState<Prepared | null>(null);
  const [typed, setTyped] = React.useState("");
  const [ticked, setTicked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [footer, setFooter] = React.useState<HTMLDivElement | null>(null);
  const topRef = React.useRef<HTMLDivElement | null>(null);
  // The review's sign/download button lands where "Review the change" was: hold it back for a
  // moment so a double click cannot press both.
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    setArmed(false);
    if (!prepared) return;
    topRef.current?.closest('[role="dialog"]')?.scrollTo({ top: 0 });
    const timer = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(timer);
  }, [prepared]);

  // A form-less sheet is prepared as it opens; every sheet starts over on opening.
  const prepareRef = React.useRef(prepare);
  React.useLayoutEffect(() => {
    prepareRef.current = prepare;
  });
  React.useEffect(() => {
    if (!open) return;
    setTyped("");
    setTicked(false);
    setPrepared(hasForm ? null : prepareRef.current());
  }, [open, hasForm]);

  const built = React.useMemo(
    () => (prepared ? buildConfigCall(deployment, settings.admin, prepared.call) : null),
    [prepared, deployment, settings.admin],
  );
  const confirm = prepared ? (typeof confirmation === "function" ? confirmation(prepared) : confirmation) : undefined;
  const wordOk = !confirm?.word || confirmWordMatches(typed, confirm.word);
  const tickOk = !confirm?.acknowledge || ticked;
  const ready = wordOk && tickOk && armed;

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : next ? undefined : onClose())}>
      <SheetContent showCloseButton={!busy} aria-describedby={undefined}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
        </SheetHeader>
        <div ref={topRef} className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens lines={outcome} />
          {prepared === null ? (
            children
          ) : (
            <>
              {hasForm && !busy ? (
                <button
                  type="button"
                  onClick={() => setPrepared(null)}
                  className="hit-area inline-flex items-center gap-1 self-start text-label-13 text-primary-600 hover:underline"
                >
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  Edit
                </button>
              ) : null}
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-label-13 text-01">What changes</p>
                <ChangeRows changes={prepared.changes} />
              </div>
              {confirm?.acknowledge ? (
                <Checkbox checked={ticked} onChange={(e) => setTicked(e.target.checked)} label={confirm.acknowledge} disabled={busy} />
              ) : null}
              {confirm?.word ? (
                <Field
                  label={
                    <>
                      Type <span className="font-mono">{confirm.word}</span> to confirm
                    </>
                  }
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              ) : null}
              {built ? (
                <ContractCallAction
                  call={built.call}
                  expected={built.expected}
                  signLabel={signLabel}
                  successTitle={successTitle}
                  successDescription="The page reads the contract again."
                  afterExport="The file is a Safe Transaction Builder batch, for an admin that is a Safe: drop it in and sign there. For a Ledger, connect it in this browser and sign here instead. Press Read again once it lands."
                  onSigned={(hash) => onDone(successTitle, hash)}
                  onBusyChange={setBusy}
                  actionsContainer={footer}
                  exportVariant={danger ? "danger" : "primary"}
                  disabled={!ready}
                  disabledReason={!wordOk ? `Type ${confirm?.word} above first.` : !tickOk ? "Tick the box above first." : !armed ? "Check what changes above." : undefined}
                />
              ) : null}
            </>
          )}
        </div>
        <div ref={setFooter} className={cn(OPERATOR_SHEET_FOOTER, "mt-auto flex w-full flex-col gap-2 px-[18px] pt-3")}>
          {prepared === null && hasForm ? (
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const next = prepare();
                  if (next) setPrepared(next);
                }}
              >
                Review the change
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Run `reset` as a sheet opens, and only then: a form must not be reset under
 * the admin's fingers when the settings are read again while it is open.
 * (State adjusted during render, React's pattern for "when a prop changes".)
 */
function useOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}

interface SheetProps {
  open: boolean;
  settings: ContractSettings;
  deployment: StakeDeployment;
  onClose: () => void;
  onDone: (title: string, hash: string | null) => void;
}

// ── Pause / resume ─────────────────────────────────────────────────────────

function PauseSheet({ open, settings, deployment, onClose, onDone }: SheetProps) {
  const pausing = !settings.paused;
  return (
    <ChangeSheet
      open={open}
      title={pausing ? "Pause the contracts?" : "Resume the contracts?"}
      settings={settings}
      deployment={deployment}
      danger={pausing}
      outcome={
        pausing
          ? [
              { icon: Ban, text: "Every payment, deposit, withdrawal, stake and penalty stops as soon as it lands", tone: "warning" },
              { icon: ShieldCheck, text: "No money moves: balances and stakes stay where they are" },
              { icon: Undo2, text: "Resume undoes it, also with the admin key" },
            ]
          : [
              { icon: Play, text: "Payments, deposits, withdrawals, stakes and penalties work again as soon as it lands" },
              { icon: ShieldCheck, text: "Wallets blocked on chain stay blocked" },
            ]
      }
      prepare={() => ({
        call: { functionName: "setPaused", args: [pausing] },
        changes: [{ label: "Contracts", before: pausing ? "Running" : "Paused", after: pausing ? "Paused" : "Running" }],
      })}
      confirmation={pausing ? { word: "PAUSE" } : undefined}
      signLabel={pausing ? "Sign and pause" : "Sign and resume"}
      successTitle={pausing ? "The contracts are paused" : "The contracts are running again"}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

// ── Fees and stake (`updateConfig`) ─────────────────────────────────────────

function ParamsSheet({ open, settings, deployment, onClose, onDone }: SheetProps) {
  const initial = React.useMemo(() => paramsToForm(settings.params, settings.asset.decimals), [settings.params, settings.asset.decimals]);
  const [form, setForm] = React.useState<ParamsForm>(initial);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [unchanged, setUnchanged] = React.useState(false);
  useOnOpen(open, () => {
    setForm(initial);
    setErrors({});
    setUnchanged(false);
  });

  const set = (key: keyof ParamsForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setUnchanged(false);
  };

  return (
    <ChangeSheet
      open={open}
      title="Change fees and stake"
      settings={settings}
      deployment={deployment}
      outcome={[
        { icon: PenLine, text: "Every field is written in one transaction; only the ones you change differ" },
        { icon: Clock, text: "Applies from the block it lands in" },
        { icon: Wallet, text: "Signed by the admin key" },
      ]}
      prepare={() => {
        const checked = formToParams(form, { ...settings.asset, arbiter: settings.arbiter });
        if (!checked.ok) {
          setErrors(checked.errors);
          return null;
        }
        const changes = paramChanges(settings.params, checked.params, settings.asset);
        if (changes.length === 0) {
          setUnchanged(true);
          return null;
        }
        return {
          call: { functionName: "updateConfig", args: [checked.params] },
          changes: changes.map((change) => ({
            label: change.critical ? <span className="text-danger-700">{change.label}</span> : change.label,
            before: change.before,
            after: change.after,
          })),
        };
      }}
      confirmation={(prepared) => {
        const [params] = prepared.call.args as [ContractSettings["params"]];
        const moved = (["treasury", "redeemer"] as const).filter((key) => params[key].toLowerCase() !== settings.params[key].toLowerCase());
        return moved.length > 0
          ? { acknowledge: `I checked the new ${moved.join(" and ")} address on a second screen, character by character` }
          : undefined;
      }}
      signLabel="Sign and save the settings"
      successTitle="Fees and stake updated"
      onClose={onClose}
      onDone={onDone}
    >
      {unchanged ? (
        <p role="alert" className="text-body-13 text-danger-600">
          Nothing is changed yet: edit at least one value, then review.
        </p>
      ) : null}
      {PARAM_GROUPS.map((group) => (
        <fieldset key={group.title} className="flex w-full flex-col gap-3">
          <legend className="pb-1 text-label-xs uppercase tracking-wide text-03">{group.title}</legend>
          {group.fields.map((field) => {
            const changed = form[field.key].trim().toLowerCase() !== initial[field.key].toLowerCase();
            return (
              <Field
                key={field.key}
                label={
                  <span className="inline-flex items-center gap-2">
                    {field.label}
                    {changed ? <span className="rounded-full bg-primary-10 px-1.5 text-label-xs text-primary-700">changed</span> : null}
                  </span>
                }
                value={form[field.key]}
                onChange={(e) => set(field.key, e.target.value)}
                inputMode={field.kind === "address" ? "text" : "decimal"}
                autoComplete="off"
                spellCheck={false}
                suffix={field.kind === "percent" ? "%" : field.kind === "money" ? "$" : field.kind === "days" ? "days" : undefined}
                hint={
                  changed && field.kind !== "address"
                    ? `${field.help} Now ${paramText(field.key, settings.params, settings.asset)}.`
                    : field.help
                }
                error={errors[field.key]}
              />
            );
          })}
        </fieldset>
      ))}
    </ChangeSheet>
  );
}

// ── Penalty dispute window (`setSlashDelay`) ────────────────────────────────

function DelaySheet({ open, settings, deployment, onClose, onDone }: SheetProps) {
  const initial = React.useMemo(() => delayToForm(settings.slashDelaySeconds), [settings.slashDelaySeconds]);
  const [value, setValue] = React.useState(initial.value);
  const [unit, setUnit] = React.useState<DelayUnit>(initial.unit);
  const [error, setError] = React.useState<string | undefined>();
  useOnOpen(open, () => {
    setValue(initial.value);
    setUnit(initial.unit);
    setError(undefined);
  });

  return (
    <ChangeSheet
      open={open}
      title="Change the dispute window"
      settings={settings}
      deployment={deployment}
      outcome={[
        { icon: Clock, text: "Penalties proposed after it lands get the new window" },
        { icon: ShieldCheck, text: "Penalties already proposed keep the window they were given" },
      ]}
      prepare={() => {
        const checked = checkSlashDelay(value, unit, settings.slashDelaySeconds);
        if (!checked.ok) {
          setError(checked.error);
          return null;
        }
        return {
          call: { functionName: "setSlashDelay", args: [BigInt(checked.seconds)] },
          changes: [{ label: "Dispute window", before: durationText(settings.slashDelaySeconds), after: durationText(checked.seconds) }],
        };
      }}
      signLabel="Sign and save the window"
      successTitle="Dispute window updated"
      onClose={onClose}
      onDone={onDone}
    >
      <div className="flex w-full flex-col gap-2">
        <Field
          label="Dispute window"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
          inputMode="numeric"
          hint={`10 min to 528 h. Now ${settings.slashDelaySeconds % 3600 === 0 ? `${settings.slashDelaySeconds / 3600} h` : durationText(settings.slashDelaySeconds)}.`}
          error={error}
        />
        <Segmented value={unit} onValueChange={(next) => setUnit(next as DelayUnit)} aria-label="Unit">
          <SegmentedItem value="minutes">Minutes</SegmentedItem>
          <SegmentedItem value="hours">Hours</SegmentedItem>
          <SegmentedItem value="days">Days</SegmentedItem>
        </Segmented>
      </div>
    </ChangeSheet>
  );
}

// ── Arbiter (`setArbiter`) ──────────────────────────────────────────────────

function ArbiterSheet({ open, settings, verifiers, deployment, onClose, onDone }: SheetProps & { verifiers: VerifierKeyRow[] | null }) {
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  useOnOpen(open, () => {
    setAddress("");
    setError(undefined);
  });

  return (
    <ChangeSheet
      open={open}
      title={settings.arbiter ? "Replace the arbiter" : "Appoint the arbiter"}
      settings={settings}
      deployment={deployment}
      outcome={[
        ...(settings.arbiter
          ? [{ icon: Ban, text: "The current arbiter can no longer rule or block once it lands", tone: "warning" as const }]
          : []),
        { icon: Scale, text: "Open disputes are ruled by the new arbiter" },
        { icon: Undo2, text: "An arbiter can be replaced, never removed" },
      ]}
      prepare={() => {
        const checked = checkNewArbiter(address, settings, verifiers ?? []);
        if (!checked.ok) {
          setError(checked.error);
          return null;
        }
        return {
          call: { functionName: "setArbiter", args: [checked.address] },
          changes: [{ label: "Arbiter", before: settings.arbiter ?? "None", after: checked.address }],
        };
      }}
      confirmation={{ acknowledge: "I checked this address with the new arbiter, character by character" }}
      signLabel="Sign and appoint"
      successTitle="Arbiter appointed"
      onClose={onClose}
      onDone={onDone}
    >
      <Field
        label="The new arbiter's wallet"
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          setError(undefined);
        }}
        placeholder="0x…"
        autoComplete="off"
        spellCheck={false}
        hint="A person's own wallet: never the admin's, the redeemer's or a verifier key."
        error={error}
      />
    </ChangeSheet>
  );
}

// ── Verifier keys (`registerVerifier`, `revokeVerifier`) ─────────────────────

function VerifierSheet({ open, settings, verifiers, deployment, onClose, onDone }: SheetProps & { verifiers: VerifierKeyRow[] | null }) {
  const empty: NewVerifierForm = { address: "", label: "", days: "90" };
  const [form, setForm] = React.useState<NewVerifierForm>(empty);
  const [errors, setErrors] = React.useState<Partial<Record<keyof NewVerifierForm, string>>>({});
  useOnOpen(open, () => {
    setForm(empty);
    setErrors({});
  });
  const set = (key: keyof NewVerifierForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <ChangeSheet
      open={open}
      title="Add a verifier key"
      settings={settings}
      deployment={deployment}
      outcome={[
        { icon: KeyRound, text: "The backend can sign penalties with this key until it expires" },
        { icon: AlertTriangle, text: "An address is registered once, for ever: an expired or revoked key is replaced by a new address", tone: "warning" },
        { icon: ShieldCheck, text: "Register only a key the backend already holds" },
      ]}
      prepare={() => {
        const checked = checkNewVerifier(form, settings, verifiers ?? [], nowSeconds());
        if (!checked.ok) {
          setErrors(checked.errors);
          return null;
        }
        return {
          call: { functionName: "registerVerifier", args: [checked.address, labelBytes32(checked.label), checked.expiresAt] },
          changes: [
            { label: "Key", before: "Not registered", after: checked.address },
            { label: "Name", before: "—", after: checked.label },
            {
              label: "Expires",
              before: "—",
              after: (
                <>
                  <UtcTime value={isoAt(Number(checked.expiresAt))} /> (fixed in the transaction: sign it soon)
                </>
              ),
            },
          ],
        };
      }}
      signLabel="Sign and add the key"
      successTitle="Verifier key added"
      onClose={onClose}
      onDone={onDone}
    >
      <Field
        label="Key address"
        value={form.address}
        onChange={(e) => set("address", e.target.value)}
        placeholder="0x…"
        autoComplete="off"
        spellCheck={false}
        error={errors.address}
      />
      <Field
        label="Name"
        value={form.label}
        onChange={(e) => set("label", e.target.value)}
        placeholder="e2e-verifier"
        maxLength={32}
        autoComplete="off"
        hint="Where the key runs. Stored on chain, at most 32 characters."
        error={errors.label}
      />
      <PresetChips
        label="Valid for"
        presets={VERIFIER_LIFETIME_PRESETS.map((days) => ({ value: String(days), label: days === 365 ? "1 year" : `${days} days` }))}
        value={form.days}
        onChange={(value) => set("days", value)}
        customLabel="Other"
        prefix=""
        placeholder="Days"
        hint="Up to 1 year. Rotate before it expires."
        error={errors.days}
      />
    </ChangeSheet>
  );
}

function RevokeSheet({ row, settings, deployment, onClose, onDone }: Omit<SheetProps, "open"> & { row: VerifierKeyRow | null }) {
  // Keep the last row while the sheet animates closed.
  const [shown, setShown] = React.useState<VerifierKeyRow | null>(row);
  React.useEffect(() => {
    if (row) setShown(row);
  }, [row]);
  if (!shown) return null;
  const name = shown.label || shortId(shown.address);
  return (
    <ChangeSheet
      open={row !== null}
      title={`Revoke the key “${name}”?`}
      settings={settings}
      deployment={deployment}
      danger
      outcome={[
        { icon: Ban, text: "Penalties this key signed that have not been taken yet can no longer be taken", tone: "warning" },
        { icon: AlertTriangle, text: "It cannot be undone, and this address can never be registered again", tone: "warning" },
        { icon: KeyRound, text: "Add the replacement key first if the backend still needs to sign" },
      ]}
      prepare={() => ({
        call: { functionName: "revokeVerifier", args: [shown.address] },
        changes: [{ label: name, before: verifierStatusText(shown, nowSeconds()), after: "Revoked" }],
      })}
      confirmation={{ word: "REVOKE" }}
      signLabel="Sign and revoke"
      successTitle={`Key “${name}” revoked`}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

export default function ContractsPage() {
  return <ContractsScreen />;
}
