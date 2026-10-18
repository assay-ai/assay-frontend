"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Radio } from "@/components/ui/radio";
import type { BindingAuthMode, CredentialHeaderInput, CredentialSetSummary } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { deleteBindingCredentials, listBindingCredentials } from "@/services/provider-tool-bindings.service";

import { CredentialHeadersForm } from "./credential-headers-form";
import { originOf } from "./rules";
import { requestKeysUrl, SIGNATURE_GUIDE_URL, signatureSnippet } from "./signature-guide";

export interface AuthenticationPanelProps {
  /** null before the first save: the mode is chosen, the credentials form waits. */
  bindingId: string | null;
  /** The endpoint as typed now (may not be saved yet). */
  endpoint: string;
  /** The endpoint stored on the draft; credentials are written for its origin. null before the first save. */
  savedEndpoint: string | null;
  /** The endpoint the live revision calls; null before the first publish. */
  publishedEndpoint: string | null;
  /** null until the provider picks one: there is no default (D10). */
  mode: BindingAuthMode | null;
  onModeChange: (mode: BindingAuthMode) => void;
  readOnly: boolean;
  /** Before the first save: saves the draft (no test call) so headers can be stored for its address. */
  onSaveConnection?: () => void;
  savingConnection?: boolean;
  /** Headers to prefill the form with (from "Move it to an API key header"); write-only, like the form. */
  pendingHeaders?: CredentialHeaderInput[] | null;
  /** The pending headers were saved or dropped. */
  onPendingDone?: () => void;
}

/** In the order a provider should consider them; each says what it means before the choice. */
const MODES: { value: BindingAuthMode; label: string; explain: string }[] = [
  {
    value: "SIGNATURE",
    label: "Assay signature (recommended)",
    explain: "Assay signs every call. Your API checks the signature and refuses anything else. No key to store.",
  },
  {
    value: "API_KEY",
    label: "API key",
    explain: "Assay sends headers you store here, like X-Api-Key, with every call. Values are encrypted.",
  },
  {
    value: "BOTH",
    label: "Both",
    explain: "A signature and your API key headers on every call.",
  },
  {
    value: "NONE",
    label: "Neither",
    explain: "Your API accepts any call. Anyone who learns its address can use it without paying.",
  },
];

/** The cache holds summaries only (names and hints), never values. */
export function credentialsQueryKey(bindingId: string): readonly unknown[] {
  return ["binding-credentials", bindingId];
}

export function usesApiKey(mode: BindingAuthMode | null): boolean {
  return mode === "API_KEY" || mode === "BOTH";
}

export function useBindingCredentials(bindingId: string | null, mode: BindingAuthMode | null) {
  return useQuery({
    queryKey: credentialsQueryKey(bindingId ?? ""),
    queryFn: () => listBindingCredentials(bindingId as string),
    enabled: bindingId !== null && usesApiKey(mode),
  });
}

/** True while the mode sends an API key and nothing is stored for the saved draft origin. */
export function missingCredentials(mode: BindingAuthMode | null, sets: CredentialSetSummary[] | undefined, savedEndpoint: string | null): boolean {
  if (!usesApiKey(mode)) return false;
  const origin = savedEndpoint === null ? null : originOf(savedEndpoint);
  return !(sets ?? []).some((set) => set.origin === origin);
}

/** The typed address points at a different origin than the saved draft: Run will save it first. */
export function addressMoved(endpoint: string, savedEndpoint: string | null): boolean {
  return savedEndpoint !== null && originOf(endpoint) !== originOf(savedEndpoint);
}

interface GateArgs {
  hasBinding: boolean;
  mode: BindingAuthMode | null;
  loading: boolean;
  /** The stored-headers request failed: the backend still enforces, so Run is not held back. */
  isError?: boolean;
  sets: CredentialSetSummary[] | undefined;
  endpoint: string;
  savedEndpoint: string | null;
}

/**
 * Run stays off while the mode sends an API key and nothing is stored (or known yet)
 * for the saved origin. A moved address is not gated: Run saves it first.
 */
export function runBlockedByCredentials(args: GateArgs): boolean {
  if (!args.hasBinding || !usesApiKey(args.mode)) return false;
  if (addressMoved(args.endpoint, args.savedEndpoint) || args.isError) return false;
  return args.loading || missingCredentials(args.mode, args.sets, args.savedEndpoint);
}

/** The line under Run explaining a held-back (or unverifiable) credentials check. */
export function runCredentialsHint(args: GateArgs): string | null {
  if (!args.hasBinding || !usesApiKey(args.mode)) return null;
  if (args.isError) return "Couldn't load your stored headers — try again.";
  return runBlockedByCredentials(args) && !args.loading ? "Add the API key headers for this address under Authentication first." : null;
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function AuthenticationPanel({
  bindingId,
  endpoint,
  savedEndpoint,
  publishedEndpoint,
  mode,
  onModeChange,
  readOnly,
  onSaveConnection,
  savingConnection = false,
  pendingHeaders = null,
  onPendingDone,
}: AuthenticationPanelProps) {
  const queryClient = useQueryClient();
  const sets = useBindingCredentials(bindingId, mode);
  const typedOrigin = originOf(endpoint);
  // Credentials are stored for the saved draft origin (or the published one), never for an unsaved address.
  const origin = savedEndpoint === null ? null : originOf(savedEndpoint);
  const moved = bindingId !== null && typedOrigin !== null && typedOrigin !== origin;
  const [editing, setEditing] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const keysUrl = React.useMemo(() => requestKeysUrl(process.env.NEXT_PUBLIC_API_BASE_URL), []);

  // Headers moved out of the address open the form, prefilled, once there is an address to store them for.
  const canEdit = !readOnly && bindingId !== null && origin !== null && !moved;
  const pendingOpen = Boolean(pendingHeaders && pendingHeaders.length > 0 && canEdit && usesApiKey(mode));
  const formOpen = (editing || pendingOpen) && canEdit;

  const refresh = () => {
    if (bindingId) void queryClient.invalidateQueries({ queryKey: credentialsQueryKey(bindingId) });
  };

  const remove = async (setOrigin: string) => {
    if (!bindingId) return;
    setRemoving(setOrigin);
    setRemoveError(null);
    try {
      await deleteBindingCredentials(bindingId, setOrigin);
      refresh();
    } catch (caught) {
      setRemoveError(caught instanceof ApiError ? plainError(caught.code, caught.status) : "Those headers could not be removed. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  const publishedOrigin = publishedEndpoint ? originOf(publishedEndpoint) : null;
  const storedHere = (sets.data ?? []).some((set) => set.origin === origin);
  const anyOld = (sets.data ?? []).some((set) => set.origin !== origin && set.origin !== publishedOrigin);
  const anyLive = publishedOrigin !== null && (sets.data ?? []).some((set) => set.origin === publishedOrigin);

  return (
    <div className="flex w-full flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={readOnly}>
        <legend className="mb-2 text-label-13 text-01">How does your API know a request is from Assay?</legend>
        {mode === null ? <p className="text-body-xs text-03">Choose one. There is no default.</p> : null}
        <div className="flex flex-col gap-2">
          {MODES.map((item) => (
            <Radio
              key={item.value}
              name="auth-mode"
              value={item.value}
              checked={mode === item.value}
              disabled={readOnly}
              onChange={() => {
                if (!readOnly) onModeChange(item.value);
              }}
              className="items-start [&>span:first-of-type]:mt-0.5"
              label={
                <span className="flex flex-col gap-0.5">
                  <span className="text-label-13 text-01">{item.label}</span>
                  <span className="text-body-xs text-03">{item.explain}</span>
                </span>
              }
            />
          ))}
        </div>
      </fieldset>

      {mode === "NONE" ? (
        <Banner tone="warning" title="Anyone who learns your endpoint URL can call it directly, without paying." />
      ) : null}

      {mode === "SIGNATURE" || mode === "BOTH" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-01 bg-02 p-3">
          <p className="text-label-13 text-01">How to check the signature</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-xs text-02">
            <li>
              Every call carries <code className="font-mono">Signature</code> and{" "}
              <code className="font-mono">Signature-Input</code> headers (plus{" "}
              <code className="font-mono">Content-Digest</code> when it has a body), signed with Ed25519 over the method, the
              URL, <code className="font-mono">X-Assay-Call-Id</code> and the body.
            </li>
            <li>
              Check it against Assay&apos;s public keys
              {keysUrl ? (
                <>
                  {" "}
                  at <span className="break-all font-mono">{keysUrl}</span>
                </>
              ) : null}
              .
            </li>
            <li>Refuse a call whose signature is missing, wrong or older than 5 minutes (answer 401).</li>
          </ul>
          <CodeBlock title="Express (Node)" code={signatureSnippet(keysUrl)} />
          <a
            href={SIGNATURE_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-label-13 text-primary-600 hover:underline"
          >
            Full guide: Python, Go, a no-code Cloudflare Worker, and writing your own check
          </a>
        </div>
      ) : null}

      {usesApiKey(mode) ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-xs text-03">
            Stored encrypted, per address (scheme, host and port), and sent with every call to that address: every tool you
            list on it uses them.
          </p>
          {bindingId === null || moved ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={readOnly || !onSaveConnection || savingConnection}
                loading={savingConnection}
                onClick={() => onSaveConnection?.()}
              >
                Save connection
              </Button>
              <span className="text-body-xs text-03">
                {moved
                  ? "Saves the new address so you can add its headers. Your API is not called."
                  : "Saves your draft so you can add headers for its address. Your API is not called."}
              </span>
            </div>
          ) : null}

          {sets.data && sets.data.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {sets.data.map((set) => {
                const live = publishedOrigin !== null && set.origin === publishedOrigin;
                const old = !live && set.origin !== origin;
                return (
                  <li key={set.origin} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-01 bg-01 px-3 py-2.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-mono text-mono-13 text-01">{set.origin}</span>
                        {live ? (
                          <span className="rounded-md bg-02 px-2 py-0.5 text-body-xs text-02">Live address</span>
                        ) : null}
                        {old ? (
                          <span className="rounded-md bg-warning-10 px-2 py-0.5 text-body-xs text-warning-700">Old address</span>
                        ) : null}
                      </div>
                      <ul className="flex flex-col gap-0.5">
                        {set.headers.map((header) => (
                          <li key={header.name} className="font-mono text-mono-13 text-02">
                            {header.name} <span className="text-03">{`••••${header.hint ?? ""}`}</span>
                          </li>
                        ))}
                      </ul>
                      {dayOf(set.updatedAt) ? <span className="text-body-xs text-03">Updated {dayOf(set.updatedAt)}</span> : null}
                    </div>
                    {old ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={readOnly || removing !== null}
                        loading={removing === set.origin}
                        onClick={() => void remove(set.origin)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : bindingId !== null && sets.isSuccess ? (
            <p className="text-body-13 text-02">No headers stored for this address yet.</p>
          ) : null}
          {anyLive || anyOld ? (
            <p className="text-body-xs text-03">
              {anyLive ? "Live address: what live calls use now. " : null}
              {anyOld ? "Old address: no longer used by this listing; remove it when you are done." : null}
            </p>
          ) : null}
          {sets.isError ? <p role="alert" className="text-body-13 text-danger-600">Stored headers could not be loaded. Try again.</p> : null}
          {removeError ? <p role="alert" className="text-body-13 text-danger-600">{removeError}</p> : null}

          {publishedOrigin && origin && publishedOrigin !== origin ? (
            <p className="text-body-xs text-03">Live calls still go to {publishedOrigin} until you publish the new address.</p>
          ) : null}

          {formOpen && bindingId !== null && origin !== null ? (
            <CredentialHeadersForm
              // A new prefill is a new form.
              key={pendingOpen ? "pending" : "manual"}
              bindingId={bindingId}
              origin={origin}
              initialHeaders={pendingOpen ? pendingHeaders : null}
              onCancel={() => {
                setEditing(false);
                onPendingDone?.();
              }}
              onSaved={() => {
                setEditing(false);
                onPendingDone?.();
                refresh();
              }}
            />
          ) : bindingId !== null ? (
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={!canEdit}
                onClick={() => setEditing(true)}
              >
                {storedHere ? "Replace headers" : "Add headers"}
              </Button>
              {typedOrigin === null ? (
                <p className="text-body-xs text-03">Enter a full address first, like https://api.example.com/v1.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
