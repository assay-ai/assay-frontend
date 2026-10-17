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
  /** The current draft endpoint. */
  endpoint: string;
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

/** True while the mode sends an API key and nothing is stored for this endpoint's origin. */
export function missingCredentials(mode: BindingAuthMode, sets: CredentialSetSummary[] | undefined, endpoint: string): boolean {
  if (!usesApiKey(mode)) return false;
  const origin = originOf(endpoint);
  return !(sets ?? []).some((set) => set.origin === origin);
}

/** Run stays off while the mode sends an API key and nothing is stored (or known yet) for this origin. */
export function runBlockedByCredentials(args: {
  hasBinding: boolean;
  mode: BindingAuthMode;
  loading: boolean;
  sets: CredentialSetSummary[] | undefined;
  endpoint: string;
}): boolean {
  if (!args.hasBinding || !usesApiKey(args.mode)) return false;
  return args.loading || missingCredentials(args.mode, args.sets, args.endpoint);
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function AuthenticationPanel({ bindingId, endpoint, publishedEndpoint, mode, onModeChange, readOnly }: AuthenticationPanelProps) {
  const queryClient = useQueryClient();
  const sets = useBindingCredentials(bindingId, mode);
  const origin = originOf(endpoint);
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
                const old = origin !== null && set.origin !== origin;
                return (
                  <li key={set.origin} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-01 bg-01 px-3 py-2.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-mono text-mono-13 text-01">{set.origin}</span>
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

          {editing && bindingId !== null && origin !== null ? (
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
                disabled={readOnly || bindingId === null || origin === null}
                onClick={() => setEditing(true)}
              >
                Replace headers
              </Button>
              {origin === null && bindingId !== null ? (
                <p className="text-body-xs text-03">Enter a full address first, like https://api.example.com/v1.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
