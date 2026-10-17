"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import type { BindingAuthMode, CredentialSetSummary } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { deleteBindingCredentials, listBindingCredentials } from "@/services/provider-tool-bindings.service";

import { CredentialHeadersForm } from "./credential-headers-form";
import { originOf } from "./rules";

export interface AuthenticationPanelProps {
  /** null before the first save: the mode is chosen, the credentials form waits. */
  bindingId: string | null;
  /** The endpoint as typed now (may not be saved yet). */
  endpoint: string;
  /** The endpoint stored on the draft; credentials are written for its origin. null before the first save. */
  savedEndpoint: string | null;
  /** The endpoint the live revision calls; null before the first publish. */
  publishedEndpoint: string | null;
  mode: BindingAuthMode;
  onModeChange: (mode: BindingAuthMode) => void;
  readOnly: boolean;
}

const MODES: { value: BindingAuthMode; label: string }[] = [
  { value: "API_KEY", label: "API key" },
  { value: "SIGNATURE", label: "Assay signature" },
  { value: "BOTH", label: "Both" },
  { value: "NONE", label: "Neither" },
];

/** The cache holds summaries only (names and hints), never values. */
export function credentialsQueryKey(bindingId: string): readonly unknown[] {
  return ["binding-credentials", bindingId];
}

export function usesApiKey(mode: BindingAuthMode): boolean {
  return mode === "API_KEY" || mode === "BOTH";
}

export function useBindingCredentials(bindingId: string | null, mode: BindingAuthMode) {
  return useQuery({
    queryKey: credentialsQueryKey(bindingId ?? ""),
    queryFn: () => listBindingCredentials(bindingId as string),
    enabled: bindingId !== null && usesApiKey(mode),
  });
}

/** True while the mode sends an API key and nothing is stored for the saved draft origin. */
export function missingCredentials(mode: BindingAuthMode, sets: CredentialSetSummary[] | undefined, savedEndpoint: string | null): boolean {
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
  mode: BindingAuthMode;
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

export function AuthenticationPanel({ bindingId, endpoint, savedEndpoint, publishedEndpoint, mode, onModeChange, readOnly }: AuthenticationPanelProps) {
  const queryClient = useQueryClient();
  const sets = useBindingCredentials(bindingId, mode);
  const typedOrigin = originOf(endpoint);
  // Credentials are stored for the saved draft origin (or the published one), never for an unsaved address.
  const origin = savedEndpoint === null ? null : originOf(savedEndpoint);
  const moved = bindingId !== null && typedOrigin !== null && typedOrigin !== origin;
  const [editing, setEditing] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

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
      setRemoveError(caught instanceof ApiError ? plainError(caught.code) : "Those headers could not be removed. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  const publishedOrigin = publishedEndpoint ? originOf(publishedEndpoint) : null;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p id="auth-mode-label" className="text-label-13 text-01">
          How does your API know a request is from Assay?
        </p>
        <Segmented
          aria-labelledby="auth-mode-label"
          value={mode}
          onValueChange={(next) => {
            if (!readOnly) onModeChange(next as BindingAuthMode);
          }}
          className="self-start"
        >
          {MODES.map((item) => (
            <SegmentedItem key={item.value} value={item.value} disabled={readOnly}>
              {item.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      {mode === "NONE" ? (
        <Banner tone="warning" title="Anyone who learns your endpoint URL can call it directly, without paying." />
      ) : null}

      {mode === "SIGNATURE" || mode === "BOTH" ? (
        <a
          href="https://github.com/assay-ai/assay-provider-verify#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-label-13 text-primary-600 hover:underline"
        >
          How to verify Assay&apos;s signature
        </a>
      ) : null}

      {usesApiKey(mode) ? (
        <div className="flex flex-col gap-3">
          {bindingId === null ? <p className="text-body-13 text-02">Save the connection first.</p> : null}

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
          {sets.isError ? <p role="alert" className="text-body-13 text-danger-600">Stored headers could not be loaded. Try again.</p> : null}
          {removeError ? <p role="alert" className="text-body-13 text-danger-600">{removeError}</p> : null}

          {publishedOrigin && origin && publishedOrigin !== origin ? (
            <p className="text-body-xs text-03">Live calls still go to {publishedOrigin} until you publish the new address.</p>
          ) : null}

          {editing && !moved && bindingId !== null && origin !== null ? (
            <CredentialHeadersForm
              bindingId={bindingId}
              origin={origin}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                refresh();
              }}
            />
          ) : (
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={readOnly || bindingId === null || origin === null || moved}
                onClick={() => setEditing(true)}
              >
                Replace headers
              </Button>
              {moved ? (
                <p className="text-body-xs text-03">Run once to save the new address, then add its headers.</p>
              ) : typedOrigin === null && bindingId !== null ? (
                <p className="text-body-xs text-03">Enter a full address first, like https://api.example.com/v1.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
