"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { toolsetKeys, useOrgHandle } from "@/components/toolsets/use-toolsets";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { STARTER_INPUT, STARTER_OUTPUT } from "@/features/operator/contract-editor";
import { handleErrorView, handleProblem, normaliseHandle, type HandleErrorView } from "@/features/toolsets/sharing";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listPublicCategories } from "@/services/public-toolsets.service";
import { createProviderTool, updateProviderTool, type ProviderTool } from "@/services/provider-tools.service";
import { claimOrgHandle } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import {
  createBody,
  fullToolName,
  localNameProblem,
  MODEL_NAME_MAX,
  modelSeenName,
  nameLengthWarning,
  providerToolErrorView,
  type ProviderToolErrorView,
} from "./model";
import { providerToolKeys } from "./queries";

/**
 * Step 1, "Name": the public name (claimed inline the first time), the tool
 * name under it, previewed exactly as a model sees it, its topic and the one
 * line agents read. Creating it saves a private draft with a starter schema
 * that step 2 replaces. Stake and payout are shown up front as a checklist.
 */

const CATEGORY_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SUMMARY_MAX = 200;

function HandleClaim() {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<HandleErrorView | null>(null);
  const claim = useMutation({
    mutationFn: async (raw: string) => {
      const problem = handleProblem(raw);
      if (problem) throw new Error(problem);
      return claimOrgHandle(normaliseHandle(raw));
    },
    onSuccess: (claimed) => {
      setError(null);
      queryClient.setQueryData(toolsetKeys.handle, claimed);
      toast.success(`@${claimed.handle} is yours`);
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(handleErrorView(err.code, err.context, name));
      else setError({ text: err instanceof Error ? err.message : "That name could not be claimed.", suggestions: [], action: null });
    },
  });
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 p-3.5" data-testid="handle-claim">
      <p className="text-label-13 text-01">First, claim your public name</p>
      <p className="text-body-13 text-02">Your tools are named after it, like @acme → acme__search_posts. It never shows an email, a wallet or a real name.</p>
      <div className="flex flex-col gap-2 tablet:flex-row tablet:items-start">
        <Field
          label="Public name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          suffix={name ? `@${normaliseHandle(name)}` : undefined}
          hint="3–24 lowercase letters, digits or “-”, starting with a letter."
          error={error?.text}
          wrapperClassName="tablet:max-w-[360px]"
          autoComplete="off"
          spellCheck={false}
        />
        <Button className="tablet:mt-6" loading={claim.isPending} disabled={name.trim() === ""} onClick={() => claim.mutate(name)}>
          Claim
        </Button>
      </div>
      {error?.suggestions.length ? (
        <div className="flex flex-wrap gap-2">
          {error.suggestions.map((s) => (
            <Button key={s} variant="secondary" size="sm" onClick={() => {
              setName(s);
              claim.mutate(s);
            }}>
              @{s}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NamePreview({ handle, localName }: { handle: string; localName: string }) {
  const seen = modelSeenName(handle, localName || "your_tool");
  const warning = localName ? nameLengthWarning(handle, localName) : null;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-02 px-3 py-2.5" data-testid="name-preview">
      <p className="text-body-xs text-03">Agents call it</p>
      <p className="break-all font-mono text-mono-13 text-01">{fullToolName(handle, localName || "your_tool")}</p>
      <p className="pt-1 text-body-xs text-03">
        A model sees it behind the client prefix ({seen.length} of {MODEL_NAME_MAX} characters)
      </p>
      <p className="break-all font-mono text-mono-12 text-02">{seen}</p>
      {warning ? <p className="text-body-xs text-warning-700">{warning}</p> : null}
    </div>
  );
}

/** What others need before they can use it; shown before any work starts. */
function UpFrontChecklist() {
  const items = [
    { text: "A passing test of your endpoint (step 3)", href: null },
    { text: "Stake at the minimum on every chain you are paid on", href: routes.stake() },
    { text: "A payout wallet", href: "/provider/setup?step=wallet" },
  ];
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-01 px-3.5 py-3">
      <p className="text-label-13 text-01">Before anyone outside your team can use it</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.text} className="flex items-center gap-2 text-body-13 text-02">
            <CircleDashed aria-hidden="true" className="size-3.5 shrink-0 text-03" />
            {item.href ? (
              <Link href={item.href} className="text-primary-600 hover:underline">
                {item.text}
              </Link>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
      <p className="text-body-xs text-03">Keeping it to your own team needs none of these. Step 3 checks them all for you.</p>
    </section>
  );
}

function ErrorBox({ view, onSuggestion }: { view: ProviderToolErrorView; onSuggestion?: (name: string) => void }) {
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
      <p>{view.text}</p>
      {view.problems.length > 0 ? (
        <ul className="list-disc pl-4">
          {view.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {view.suggestion && onSuggestion ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => onSuggestion(view.suggestion!)}>
          Use {view.suggestion}
        </Button>
      ) : null}
    </div>
  );
}

export function NameStep({ tool, onContinue }: { tool: ProviderTool | null; onContinue: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const handle = useOrgHandle();
  const categories = useQuery({ queryKey: ["public-categories"], queryFn: listPublicCategories, retry: 0, staleTime: 5 * 60_000 });
  const [localName, setLocalName] = React.useState("");
  const [category, setCategory] = React.useState(tool?.category ?? "");
  const [tags, setTags] = React.useState((tool?.tags ?? []).join(", "));
  const [summary, setSummary] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const listId = React.useId();

  const owner = tool?.handle ?? handle.data?.handle ?? null;
  const nameProblem = localNameProblem(owner, localName);
  const categoryProblem = category.trim() === "" ? "Pick a topic." : CATEGORY_RE.test(category.trim()) ? null : "Lowercase letters, digits and “-”, starting with a letter.";
  const summaryProblem = summary.trim() === "" ? "Say in one line what it does." : summary.length > SUMMARY_MAX ? `At most ${SUMMARY_MAX} characters.` : /[\r\n]/.test(summary) ? "Keep it on one line." : null;

  const create = useMutation({
    mutationFn: () =>
      createProviderTool(
        createBody(localName, category, {
          summary: summary.trim(),
          description: summary.trim(),
          inputSchema: STARTER_INPUT as Record<string, unknown>,
          outputSchema: STARTER_OUTPUT as Record<string, unknown>,
          examples: [],
        }),
      ),
    onSuccess: (created) => {
      queryClient.setQueryData(providerToolKeys.one(created.id), created);
      void queryClient.invalidateQueries({ queryKey: providerToolKeys.list });
      toast.success(`${created.name} saved. Only your team can see it.`);
      router.replace(routes.providerApi(created.id, "contract"), { scroll: false });
    },
  });
  const save = useMutation({
    mutationFn: () =>
      updateProviderTool(tool!.id, {
        category: category.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
      toast.success("Saved");
    },
  });

  const datalist = (
    <datalist id={listId}>
      {(categories.data?.categories ?? []).map((c) => (
        <option key={c.category} value={c.category} />
      ))}
    </datalist>
  );

  if (tool) {
    const tagsChanged = tags !== tool.tags.join(", ") || category !== tool.category;
    return (
      <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4">
        <h2 className="text-label-md text-01">Name</h2>
        <NamePreview handle={tool.handle} localName={tool.localName} />
        <p className="text-body-13 text-03">A tool&apos;s name can&apos;t change. To use another name, publish a new tool.</p>
        <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
          <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} list={listId} error={categoryProblem ?? undefined} hint="Search and the catalogue group tools by it." />
          <Field label="Tags (optional)" value={tags} onChange={(e) => setTags(e.target.value)} hint="Up to 10, separated by commas." className="font-sans" />
        </div>
        {datalist}
        {tool.visibility === "LISTED" ? <p className="text-body-xs text-03">On a listed tool, a new topic or tags wait for the next review: change them with a new version in step 2.</p> : null}
        {save.isError ? <ErrorBox view={providerToolErrorView(save.error)} /> : null}
        <div className="flex flex-wrap gap-2">
          {tool.visibility !== "LISTED" ? (
            <Button variant="secondary" disabled={!tagsChanged || categoryProblem !== null} loading={save.isPending} onClick={() => save.mutate()}>
              Save topic and tags
            </Button>
          ) : null}
          <Button onClick={onContinue}>Continue to inputs & outputs</Button>
        </div>
      </section>
    );
  }

  const noHandle = handle.isSuccess && !handle.data?.handle;
  const ready = !noHandle && owner !== null && !nameProblem && !categoryProblem && !summaryProblem;
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4">
      <h2 className="text-label-md text-01">Name it</h2>
      <UpFrontChecklist />
      {noHandle ? <HandleClaim /> : null}
      {handle.data?.handle ? (
        <p className="flex items-center gap-1.5 text-body-13 text-02">
          <Check aria-hidden="true" className="size-3.5 text-success-700" />
          Published as <span className="font-mono text-mono-13 text-01">@{handle.data.handle}</span>
        </p>
      ) : null}
      <Field
        label="Tool name"
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => setTouched(true)}
        hint="Lowercase letters, digits and “_”, 2–40 characters, like search_posts. It can't change later."
        error={touched && localName ? (nameProblem ?? undefined) : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {owner ? <NamePreview handle={owner} localName={localName.trim()} /> : null}
      <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} list={listId} placeholder="social" error={touched && category ? (categoryProblem ?? undefined) : undefined} hint="Search and the catalogue group tools by it." />
      {datalist}
      <Field
        label="What it does, in one line"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        suffix={`${summary.length}/${SUMMARY_MAX}`}
        hint="The only text agents see in their tool list. Say what it does and when to use it."
        error={touched && summary ? (summaryProblem ?? undefined) : undefined}
        className="font-sans"
      />
      {create.isError ? <ErrorBox view={providerToolErrorView(create.error)} onSuggestion={(s) => setLocalName(s.includes("__") ? s.split("__").pop()! : s)} /> : null}
      <div className="flex flex-col gap-1">
        <Button
          className="self-start"
          loading={create.isPending}
          disabled={!ready}
          onClick={() => {
            setTouched(true);
            if (ready) create.mutate();
          }}
        >
          Save and continue
        </Button>
        {!ready ? (
          <p className="text-body-xs text-03">
            {noHandle ? "Claim a public name first." : (nameProblem ?? categoryProblem ?? summaryProblem ?? "")}
          </p>
        ) : (
          <p className="text-body-xs text-03">Saved as a private draft: only your team can see it.</p>
        )}
      </div>
    </section>
  );
}
