"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CursorPage } from "@/interfaces/api";
import type { ToolRequest } from "@/interfaces/provider-tool-requests";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { createToolRequest } from "@/services/provider-tool-requests.service";

import { parseMonthlyCalls } from "./state";
import { isHttpsUrl } from "./url";

export const TOOL_REQUESTS_LIST_KEY = ["provider", "tool-requests", "list"] as const;

/**
 * The reply promise, said the same way everywhere. Each request carries a
 * reply due date (`firstResponseDueAt`) and the Tool requests page shows the
 * reply; no Inbox notice exists for tool requests, so none is promised.
 */
export const REPLY_PROMISE = "We aim to reply within 2 working days; the reply shows on your Tool requests page.";

/**
 * "Can't find your tool? Request it" — two required fields (name, what it
 * returns), two optional ones, and a confirmation that says when the reply
 * comes and where. Opened from the wizard's tool step and the requests page.
 */
export function ToolRequestSheet({
  open,
  onOpenChange,
  initialName = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initialName);
  const [returns, setReturns] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [volume, setVolume] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<"name" | "returns" | "url" | "volume", string>>>({});
  const [filed, setFiled] = React.useState<ToolRequest | null>(null);

  React.useEffect(() => {
    if (open) {
      setName((current) => current || initialName);
    } else {
      // Closing after a filed request starts the next one clean.
      if (filed) {
        setName("");
        setReturns("");
        setUrl("");
        setVolume("");
        setFiled(null);
      }
      setError(null);
      setFieldErrors({});
    }
  }, [open, initialName, filed]);

  const create = useMutation({
    mutationFn: createToolRequest,
    onSuccess: (created) => {
      queryClient.setQueryData(["provider", "tool-requests", "detail", created.id], created);
      // Seeded, not invalidated: the list GET is HTTP-cached for a few seconds after a write.
      queryClient.setQueryData(TOOL_REQUESTS_LIST_KEY, (old: CursorPage<ToolRequest> | undefined) =>
        old ? { ...old, items: [created, ...old.items] } : old,
      );
      setFiled(created);
    },
    onError: (e) => setError(e instanceof ApiError ? plainError(e.code) : "The request could not be sent. Try again."),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    // Each problem sits on its own field; focus goes to the first one.
    const problems: Partial<Record<"name" | "returns" | "url" | "volume", string>> = {};
    if (!name.trim()) problems.name = "Give the tool a name.";
    if (!returns.trim()) problems.returns = "Say what it returns.";
    if (url.trim() && !isHttpsUrl(url.trim())) problems.url = "The API address must start with https://.";
    let calls: number | undefined;
    if (volume.trim()) {
      const parsed = parseMonthlyCalls(volume);
      if (parsed === null) problems.volume = "Calls a month must be a whole number.";
      else calls = parsed;
    }
    setFieldErrors(problems);
    const first = (["name", "returns", "url", "volume"] as const).find((key) => problems[key]);
    if (first) {
      document.getElementById(`tool-request-${first}`)?.focus();
      return;
    }
    create.mutate({
      title: name.trim(),
      description: `Returns: ${returns.trim()}`,
      upstreamUrl: url.trim() || undefined,
      expectedMonthlyCalls: calls,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <SheetContent showCloseButton>
        {filed ? (
          <>
            <SheetHeader className="tablet:pt-5">
              <SheetTitle className="flex items-center gap-2 pr-8">
                <CheckCircle2 aria-hidden="true" className="size-5 text-success-500" />
                Request sent
              </SheetTitle>
              <SheetDescription>
                {`“${filed.title}” is with the Assay team. ${REPLY_PROMISE}`}
              </SheetDescription>
            </SheetHeader>
            <SheetFooter className="flex flex-col gap-2 tablet:flex-row">
              <Button className="w-full tablet:w-auto" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button variant="secondary" className="w-full tablet:w-auto" asChild>
                <Link href="/provider/tool-requests">See your requests</Link>
              </Button>
            </SheetFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col">
            <SheetHeader className="tablet:pt-5">
              <SheetTitle className="pr-8">Request a tool</SheetTitle>
              <SheetDescription>
                Tell us what your API does and the Assay team adds it to the catalogue. {REPLY_PROMISE}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-[18px] pt-4">
              <Field id="tool-request-name" label="Tool name" placeholder="Weather now" value={name} error={fieldErrors.name} onChange={(e) => setName(e.target.value)} maxLength={160} />
              <Field
                id="tool-request-returns"
                label="What it returns"
                error={fieldErrors.returns}
                placeholder="Temperature and conditions for a city"
                value={returns}
                onChange={(e) => setReturns(e.target.value)}
                maxLength={1000}
              />
              <Field
                id="tool-request-url"
                label="Your API address (optional)"
                error={fieldErrors.url}
                placeholder="https://api.example.com/v1/weather"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Field
                id="tool-request-volume"
                label="Calls a month you expect (optional)"
                error={fieldErrors.volume}
                placeholder="40000"
                inputMode="numeric"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
              />
              <p aria-live="polite" className="min-h-5 text-body-xs text-danger-600">
                {error}
              </p>
            </div>
            <SheetFooter className="sticky bottom-0 bg-01">
              <Button type="submit" className="w-full" loading={create.isPending}>
                Send request
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
