"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, FlaskConical, GitBranch, Rocket, Save, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { BindingNav } from "@/features/provider-binding/binding-nav";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import { shortId } from "@/features/buyer/period";
import type {
  BindingStatus,
  CatalogueTool,
  SavedToolBinding,
  ToolBindingDetail,
  ToolCatalogue,
  ToolMapping,
  UpdateToolBindingBody,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import {
  getToolBinding,
  listToolCatalogue,
  updateToolBinding,
} from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { Note, PageHeader, UNKNOWN, integerFromInput } from "@/features/provider-binding/chrome";
import {
  MappingEditor,
  documentsEqual,
  type MappingEditorStatus,
} from "@/features/provider-binding/mapping-editor";
import { useSearchParam } from "@/hooks/useSearchParam";
import { routes } from "@/libs/routes";

/**
 * Binding editor.
 *
 * ## What this screen is
 *
 * The product spec says the primary surface for a
 * binding's configuration is the provider's own `binding.yaml`, and the
 * design's own note repeats it: *"the file is the primary surface and this
 * form is the second one"*. So this is an editor over a **versioned document**,
 * not a settings form:
 *
 *   - the two mappings are **edited** here, a row per leaf, through
 *     `@/features/provider-binding/mapping-editor`. The rows come from the
 *     tool's own schema rather than from the mapping, so a required output
 *     field the mapping never writes is an empty row and not an absence;
 *   - "Edit as JSON" swaps both tables for the document itself. It replaces
 *     the read-only YAML view: nothing here parses YAML back, so a surface a
 *     provider can now type into has to be the one this app can read. A
 *     document `canExpressAsRows` refuses opens that way whatever the switch
 *     says, with a sentence naming what the table could not hold;
 *   - the **constraints** are the part this form does write. They are columns
 *     on the binding row, not nodes of the mapping document, and the design
 *     draws them as a separate panel for that reason.
 *
 * ## Two ceilings, never one control
 *
 * `maxRps` and `maxDailyCalls` look redundant and are not. The backend's
 * limiter splits *read* from *consume* precisely so a per-second ceiling and a
 * per-day ceiling can be checked without either one collapsing the other. They stay two rows and two
 * inputs. `null` clears a ceiling and omitting the key leaves it alone — the
 * PATCH body below keeps those two distinguishable, as `UpdateToolBindingBody`
 * requires.
 *
 * ## `freeDailyBudget` is never touched here
 *
 * It is the binding-wide free-call count (free calls per day, all agents), set
 * on the free-tier controls screen. This screen shows no free-tier control, so
 * the key is simply **absent** from every PATCH body.
 *
 * ## The mappings are sent only when they moved
 *
 * `fromRows` emits a request document as `method, path, query, headers, body`
 * whatever order the stored one used, so the editor's document can be
 * byte-different and mean exactly the same thing. `documentsEqual` is what
 * decides, and a save that changed nothing must send nothing: every save that
 * touches either mapping raises `mapping_version`, and raising it invalidates
 * a green mapping-tester run, which blocks publish with no visible
 * cause.
 *
 * ## What the design draws and this screen cannot
 *
 * The Status columns' observed facts — "3 of 20 mapped", "null on 3/3" — and
 * the warning note built from them are **tester-run** results. This screen has
 * no readable run: `POST /{id}/test` is a live call that needs the tool's
 * arguments, and no endpoint exposes a tool's `inputSchema`. The mapping tester is a
 * separate screen.
 */

const STATUS_WORD: Record<BindingStatus, string> = {
  DRAFT: "draft",
  ACTIVE: "live",
  PAUSED: "paused",
  SUSPENDED: "suspended",
};

/** `https://api.open-meteo.com` → `api.open-meteo.com`, as the sidebar does. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** The design writes ceilings grouped: `2,000,000`. */
function grouped(value: number | null): string {
  if (value == null) return UNKNOWN;
  return value.toLocaleString("en-US");
}

// ── The constraints form ───────────────────────────────────────────────────

/**
 * The three constraint columns a provider can write, as text.
 *
 * Text, not numbers: an empty box and a zero are different instructions
 * (`null` clears a ceiling, `0` is refused outright), and a `number` state
 * cannot hold the difference while someone is mid-keystroke.
 */
interface Draft {
  timeoutMs: string;
  maxRps: string;
  maxDailyCalls: string;
}

function draftOf(binding: ToolBindingDetail): Draft {
  return {
    timeoutMs: String(binding.timeoutMs),
    maxRps: binding.maxRps == null ? "" : String(binding.maxRps),
    maxDailyCalls: binding.maxDailyCalls == null ? "" : String(binding.maxDailyCalls),
  };
}

interface Parsed {
  timeoutMs: { value: number | null; error: string | null };
  maxRps: { value: number | null; error: string | null };
  maxDailyCalls: { value: number | null; error: string | null };
}

function parseDraft(draft: Draft): Parsed {
  const timeoutMs = integerFromInput(draft.timeoutMs);
  const maxRps = integerFromInput(draft.maxRps);
  const maxDailyCalls = integerFromInput(draft.maxDailyCalls);

  // `timeoutMs` has no "unset": the router needs a number and the DTO bounds
  // it at 1..120000.
  if (!timeoutMs.error) {
    if (timeoutMs.value == null) timeoutMs.error = "Required.";
    else if (timeoutMs.value < 1 || timeoutMs.value > 120000) timeoutMs.error = "1 to 120000.";
  }
  // A ceiling of `0` is refused by the API on purpose — "declared unroutable"
  // is what the pause button says out loud, and it says it reversibly.
  for (const ceiling of [maxRps, maxDailyCalls]) {
    if (!ceiling.error && ceiling.value != null && ceiling.value < 1) {
      ceiling.error = "1 or more, or empty for no ceiling.";
    }
  }
  return { timeoutMs, maxRps, maxDailyCalls };
}

/** The two mapping documents, as the editors last emitted them. */
interface Drafts {
  request: ToolMapping | null;
  response: ToolMapping | null;
}

/** Whether each editor's document may be saved — see {@link MappingEditorStatus}. */
interface Statuses {
  request: MappingEditorStatus;
  response: MappingEditorStatus;
}

/**
 * Only the keys that actually moved.
 *
 * `undefined` (absent) and `null` are not normalised into each other: the
 * first leaves a ceiling alone, the second removes it.
 *
 * The mappings are compared **structurally** rather than by identity or by
 * serialisation — see the header. A draft that deep-equals what is stored is
 * not sent at all.
 */
function patchBody(
  binding: ToolBindingDetail,
  parsed: Parsed,
  drafts: Drafts
): UpdateToolBindingBody {
  const body: UpdateToolBindingBody = {};
  if (parsed.timeoutMs.value != null && parsed.timeoutMs.value !== binding.timeoutMs) {
    body.timeoutMs = parsed.timeoutMs.value;
  }
  if (parsed.maxRps.value !== binding.maxRps) body.maxRps = parsed.maxRps.value;
  if (parsed.maxDailyCalls.value !== binding.maxDailyCalls) {
    body.maxDailyCalls = parsed.maxDailyCalls.value;
  }
  if (drafts.request && !documentsEqual(drafts.request, binding.requestMapping)) {
    body.requestMapping = drafts.request;
  }
  if (drafts.response && !documentsEqual(drafts.response, binding.responseMapping)) {
    body.responseMapping = drafts.response;
  }
  return body;
}

/**
 * The keys whose save raises `mapping_version`.
 *
 * The backend's mapping-format documentation (Versioning): *"every save that changes the
 * endpoint, either mapping, the price, the asset, the pricing mode or the
 * timeout raises it and writes a `binding_versions` snapshot"*. The list is the
 * document's, whole, rather than only the keys this screen happens to write —
 * a field moving onto this form later must not silently fall out of the
 * warning.
 *
 * Everything else on `UpdateToolBindingBody` leaves the revision alone:
 * `slaFailureRate` (measured on the wire by the SLA workbench screen — see its header), the two
 * free-tier fields, and the two ceilings. That is the whole point of warning at
 * all: a warning that fired on every save would say nothing.
 */
const REVISION_KEYS = [
  "endpoint",
  "requestMapping",
  "responseMapping",
  "pricingMode",
  "priceAmount",
  "assetId",
  "timeoutMs",
] as const satisfies readonly (keyof UpdateToolBindingBody)[];

/** Which of the pending edits will raise the revision, in the document's order. */
function revisionBumpingKeys(body: UpdateToolBindingBody): string[] {
  return REVISION_KEYS.filter((key) => body[key] !== undefined);
}

/**
 * The Value cell of an editable constraint row.
 *
 * The design draws these as plain right-aligned 12.5px mono text, so at rest
 * the box is invisible; the border only appears under the pointer and on
 * focus. A focus **ring** would be clipped by the cell's `truncate`, so the
 * affordance is a border, which sits inside the box.
 */
function CeilingInput({
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  placeholder?: string;
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={error ? true : undefined}
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-[120px] rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-right font-mono text-mono-13 text-02 outline-none",
        "hover:border-02 focus:border-primary-500 focus:text-01 placeholder:text-03",
        error && "border-danger-500 text-danger-500"
      )}
    />
  );
}

/**
 * The editor waits for the tool contract rather than opening without it.
 *
 * The rows of a response mapping ARE the tool's `outputSchema` fields, and the
 * editor reads that once, in a lazy state initialiser, because reopening it
 * mid-edit would throw away whatever the provider had typed. So an editor that
 * mounts before the catalogue lands keeps `fields: []` for the rest of its
 * life: required fields the mapping never writes are absent instead of empty
 * rows, no `required` badge appears, and the `$optional`-at-a-required-site
 * guidance is silently off — the whole point of the screen, missing, with the
 * request footer (which reads the live memo) disagreeing with the response one
 * on screen as the only tell.
 *
 * Two queries, and the binding one is declared first and usually wins, so this
 * was the normal case rather than a race. Gating the mount is preferred to
 * putting the tool in the editor's `key`: a key change remounts, and a
 * remount mid-edit is exactly the lost work this avoids.
 */
function ContractPending() {
  return (
    <p className="px-1 py-3 font-mono text-mono-12 text-03">reading the tool contract…</p>
  );
}

// ── Rows of the constraints table ──────────────────────────────────────────

interface ConstraintRow {
  id: string;
  name: string;
  value: React.ReactNode;
  ceiling: string;
}

// ── The screen ─────────────────────────────────────────────────────────────

export default function BindingConfigurationPage() {
  const bindingId = useSearchParam("binding");
  const queryClient = useQueryClient();

  const [asJson, setAsJson] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [drafts, setDrafts] = React.useState<Drafts>({ request: null, response: null });
  const [status, setStatus] = React.useState<Statuses>({
    request: { editing: null, document: null },
    response: { editing: null, document: null },
  });

  const bindingQuery = useQuery<ToolBindingDetail, ApiError>({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    enabled: Boolean(bindingId),
    // Matches the rest of the console: a paused retry renders as an eternal
    // spinner, and a screen that cannot read its binding has to say so.
    retry: 0,
    networkMode: "always" as const,
  });

  const binding = bindingQuery.data;

  /*
    The tool's two schemas, which is what the editor draws its rows from. There
    is no `GET /tools/{id}`: the catalogue is the only route that carries an
    `inputSchema` or an `outputSchema`, so the tool is found in it by id. A
    catalogue that does not answer is not fatal — the editor then has no schema
    to add empty rows from and shows what the mapping itself writes.
  */
  const catalogueQuery = useQuery<ToolCatalogue, ApiError>({
    queryKey: ["provider", "tool-catalogue"],
    queryFn: listToolCatalogue,
    retry: 0,
    staleTime: 5 * 60 * 1000,
    networkMode: "always" as const,
  });

  const tool: CatalogueTool | undefined = catalogueQuery.data?.tools.find(
    (candidate) => candidate.id === binding?.toolId
  );

  /*
    The draft follows the binding's revision, not merely its id: a successful
    save answers 201 with the new `version`, and that response is written
    straight into this query's cache (see `save.onSuccess`) because the API
    serves provider GETs with `Cache-Control: private, max-age=10`, so a
    refetch can hand back the PRE-write body from the browser's own HTTP cache.
    Invalidating the React Query key does not help — the response never leaves
    the browser. Layering the write's own answer over the read is the
    workaround; the caching is a recorded backend defect, not this screen's.
  */
  const revision = binding ? `${binding.id}:${binding.version}` : null;
  const [revisionSeen, setRevisionSeen] = React.useState<string | null>(null);
  if (binding && revision !== revisionSeen) {
    setRevisionSeen(revision);
    setDraft(draftOf(binding));
    setDrafts({ request: null, response: null });
    setStatus({
      request: { editing: null, document: null },
      response: { editing: null, document: null },
    });
  }

  const parsed = draft ? parseDraft(draft) : null;
  const body = binding && parsed ? patchBody(binding, parsed, drafts) : {};
  /*
    Save is gated on the editors too, and on two different rules. `editing` —
    JSON that does not parse — blocks whatever the body ends up containing:
    the provider is looking at broken text, and `doc` falls back to the last
    document that DID parse, so without this the button stays live and writes
    something they cannot see. `document` — the validator's refusal, or a row
    that would silently vanish — blocks only if that mapping is actually in the
    body, so a binding whose stored mapping is already bad does not lock a
    provider out of editing a ceiling.
  */
  const blocked =
    status.request.editing ??
    status.response.editing ??
    (body.requestMapping ? status.request.document : null) ??
    (body.responseMapping ? status.response.document : null);
  const invalid = parsed
    ? Boolean(
        parsed.timeoutMs.error || parsed.maxRps.error || parsed.maxDailyCalls.error || blocked
      )
    : Boolean(blocked);
  const dirty = Object.keys(body).length > 0;

  const save = useMutation<SavedToolBinding, ApiError>({
    // 201, not 200 — every provider write answers 201, including the ones that
    // write nothing. Nothing here branches on the status code.
    mutationFn: () => updateToolBinding(bindingId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(["provider", "tool-binding", bindingId], saved);
      queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings", "sidebar"] });
      setRevisionSeen(`${saved.id}:${saved.version}`);
      setDraft(draftOf(saved));
      setDrafts({ request: null, response: null });
      toast.success(`Saved as draft v${saved.version}.`);
    },
    onError: (error) => {
      toast.error(
        error.code === "PROVIDER_BINDING_NOT_EDITABLE"
          ? "This binding is suspended, so its configuration cannot be changed."
          : error.message
      );
    },
  });

  if (bindingQuery.isPending) {
    return <p className="text-body-13 text-03">Loading the binding…</p>;
  }

  if (bindingQuery.error || !binding) {
    const error = bindingQuery.error;
    return (
      <EmptyState
        icon={<FileCode width={22} height={22} />}
        title="This binding could not be read"
        description={`${error?.code ?? "UNKNOWN"} — ${error?.message ?? "No binding answered for this id."}`}
      />
    );
  }

  /* ------------------------------------------------------------- columns */

  const strong = (text: string) => <span className="font-semibold text-01">{text}</span>;

  const constraintColumns: TableColumn<ConstraintRow>[] = [
    { key: "name", header: "Constraint", mono: true, cell: (row) => strong(row.name) },
    { key: "value", header: "Value", width: 180, align: "end", mono: true, cell: (row) => row.value },
    { key: "ceiling", header: "At the ceiling", width: 430, align: "end", mono: true, cell: (row) => row.ceiling },
  ];

  const set = (key: keyof Draft) => (next: string) =>
    setDraft((current) => (current ? { ...current, [key]: next } : current));

  const constraintRows: ConstraintRow[] = [
    {
      id: "timeoutMs",
      name: "timeoutMs",
      value: (
        <CeilingInput
          label="timeoutMs"
          value={draft?.timeoutMs ?? ""}
          onChange={set("timeoutMs")}
          error={parsed?.timeoutMs.error ?? null}
        />
      ),
      ceiling: "a timeout counts as a system error · it affects availability only, never a penalty",
    },
    {
      id: "maxRps",
      name: "maxRps",
      value: (
        <CeilingInput
          label="maxRps"
          value={draft?.maxRps ?? ""}
          onChange={set("maxRps")}
          error={parsed?.maxRps.error ?? null}
          placeholder={UNKNOWN}
        />
      ),
      ceiling: "429 shed · not counted against your SLA",
    },
    {
      id: "dailyCeiling",
      name: "dailyCeiling",
      value: (
        <CeilingInput
          label="dailyCeiling"
          value={draft?.maxDailyCalls ?? ""}
          onChange={set("maxDailyCalls")}
          error={parsed?.maxDailyCalls.error ?? null}
          placeholder={UNKNOWN}
        />
      ),
      ceiling: "calls above it are refused · you are warned at 80%",
    },
    // the binding editor design also draws `monthlyCeiling` and `retentionPolicy` rows; the
    // API has neither field (`UpdateToolBindingBody` takes `timeoutMs`,
    // `maxRps`, `maxDailyCalls`), so they are not rendered — they were dropped,
    // not missed.
  ];

  /* -------------------------------------------------------------- header */

  const statusWord = STATUS_WORD[binding.status];
  /*
    `GET /{id}` returns `publishedVersion` and `hasUnpublishedChanges`, so both
    are read straight off the binding. No `??` fallback on either: inferring
    "unpublished" from `status === "DRAFT"` would keep rendering a plausible
    answer if the backend ever stopped sending the flag, and this whole header
    exists to say which revision is actually live.
  */
  const published =
    binding.publishedVersion == null
      ? "never published"
      : `published v${binding.publishedVersion}`;
  const sub = [
    `${statusWord} v${binding.version}`,
    published,
    binding.hasUnpublishedChanges ? "unpublished changes" : null,
    binding.id,
    "the dashboard editor reads and writes the same binding.yaml your repo holds",
  ]
    .filter(Boolean)
    .join(" · ");

  /*
    Naming the keys, not just warning: "this raises the revision" is only
    actionable if the provider can see which of their pending edits did it —
    the ceilings sit in the same form and never do.
  */
  const bumping = revisionBumpingKeys(body);

  return (
    <>
      <PageHeader
        title={`${shortId(binding.id)} · ${hostOf(binding.endpoint)}`}
        sub={sub}
        actions={
          <>
            <Button
              variant="secondary"
              aria-pressed={asJson}
              onClick={() => setAsJson((current) => !current)}
              icon={<FileCode aria-hidden="true" />}
              className={cn(asJson && "border-primary-500 text-primary-600")}
            >
              Edit as JSON
            </Button>
            {/*
              the mapping tester design is the mapping tester and it is a screen of its
              own; this action is the design's way in. The route is the one the
              binding sub-routes follow.
            */}
            <Button variant="secondary" asChild>
              <Link href={routes.binding(binding.id, "test")}>
                <FlaskConical width={15} height={15} aria-hidden="true" />
                Test the mapping
              </Link>
            </Button>
            {/*
              the publish checklist design is the publish checklist, and until this link it was
              reachable only by typing the id into the address bar. It is the
              last step of the chain this feature is: create → edit → test →
              publish. The icon goes INSIDE the `<Link>` — an `asChild` Button
              drops its own `icon` prop, because Radix `Slot` takes exactly one
              child.
            */}
            <Button variant="secondary" asChild>
              <Link href={routes.binding(binding.id, "publish")}>
                <Rocket width={15} height={15} aria-hidden="true" />
                Publish
              </Link>
            </Button>
            <Button
              icon={<Save aria-hidden="true" />}
              disabled={!dirty || invalid}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save draft
            </Button>
          </>
        }
      />

      <BindingNav bindingId={binding.id} />

      {/*
        the binding editor design ends this note with a sentence advertising an `x402
        binding plan` CLI that emits a change-impact block. No such CLI exists,
        so the sentence is not rendered — see the constraints table for the two
        rows dropped for the same reason.
      */}
      <Note tone="primary" icon={<GitBranch width={15} height={15} aria-hidden="true" />}>
        A binding is a versioned configuration document, so the file is the primary surface and
        this form is the second one.
      </Note>

      {/*
        What a save costs, said before it is paid.

        `mapping_version` moves on the seven keys in `REVISION_KEYS` and on
        nothing else, and moving it invalidates any green mapping-tester run,
        because the publish gate requires a passing run at the CURRENT
        revision. So a provider who tests until green, edits a mapping and then
        publishes is refused — with no visible cause unless this says so first.

        It stays silent for a ceiling-only edit on purpose: a warning that fired
        on every save would be dismissed on every save, and then it would not be
        read on the one that mattered.
      */}
      {bumping.length > 0 ? (
        <Note
          tone="warning"
          icon={<TriangleAlert width={15} height={15} aria-hidden="true" />}
        >
          Saving {bumping.join(", ")} raises this binding to revision {binding.version + 1}.
          That invalidates any passing mapping-tester run — the publish gate only accepts a run
          at the current revision — so you will need to test again before you can publish.
        </Note>
      ) : null}

      {/*
        Stacked rather than the design's two side-by-side columns: the binding editor screen draws
        two READ-ONLY tables, and half a console's width has no room for a
        selector, a transform chain and a checkbox on one line. The columns
        themselves are the frame's.
      */}
      <div className="flex w-full flex-col gap-4">
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Request mapping</PanelTitle>
              <PanelDescription>tool input → your endpoint</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-2.5 px-2.5 pb-2.5 pt-1.5">
            {catalogueQuery.isPending ? (
              <ContractPending />
            ) : (
              <MappingEditor
                key={`${binding.id}:${binding.version}:REQUEST`}
                direction="REQUEST"
                toolId={binding.toolId}
                mapping={binding.requestMapping}
                schema={tool?.inputSchema}
                json={asJson}
                onChange={(next) => setDrafts((current) => ({ ...current, request: next }))}
                onStatus={(next) => setStatus((current) => ({ ...current, request: next }))}
              />
            )}
            <p className="px-1 font-mono text-mono-12 text-03">
              the path is appended to {binding.endpoint}
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Response mapping</PanelTitle>
              <PanelDescription>your endpoint → outputSchema</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-2.5 px-2.5 pb-2.5 pt-1.5">
            {catalogueQuery.error ? (
              <p className="px-1 font-mono text-mono-12 text-03">
                the tool catalogue could not be read ({catalogueQuery.error.code}), so the rows
                below are the mapping&rsquo;s own — a required field it never writes is not
                drawn
              </p>
            ) : null}
            {catalogueQuery.isPending ? (
              <ContractPending />
            ) : (
              <MappingEditor
                key={`${binding.id}:${binding.version}:RESPONSE`}
                direction="RESPONSE"
                toolId={binding.toolId}
                mapping={binding.responseMapping}
                schema={tool?.outputSchema}
                json={asJson}
                onChange={(next) => setDrafts((current) => ({ ...current, response: next }))}
                onStatus={(next) => setStatus((current) => ({ ...current, response: next }))}
              />
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Constraints</PanelTitle>
            <PanelDescription>
              declared ceilings — traffic is shed at the ceiling rather than failing your SLA
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-2 px-2.5 pb-2.5 pt-1.5">
          <Table columns={constraintColumns} rows={constraintRows} caption="Constraints" />
          {parsed?.timeoutMs.error || parsed?.maxRps.error || parsed?.maxDailyCalls.error ? (
            <p role="alert" className="px-3 text-body-13 text-danger-500">
              {parsed.timeoutMs.error ?? parsed.maxRps.error ?? parsed.maxDailyCalls.error}
            </p>
          ) : (
            <p className="px-3 font-mono text-mono-12 text-03">
              An empty ceiling means no ceiling. maxRps {grouped(binding.maxRps)} and dailyCeiling{" "}
              {grouped(binding.maxDailyCalls)} are checked separately — one is read per request,
              the other is consumed per call.
            </p>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
