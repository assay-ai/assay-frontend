"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Plug, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Radio } from "@/components/ui/radio";
import { Select } from "@/components/ui/select";
import { Note, PageHeader, integerFromInput, minorUnitsFromMajorInput } from "@/features/provider-binding/chrome";
import { MappingEditor, schemaFields } from "@/features/provider-binding/mapping-editor";
import type {
  CatalogueTool,
  CursorPage,
  PricingMode,
  SaveToolBindingBody,
  SavedToolBinding,
  ToolBindingSummary,
  ToolCatalogue,
  ToolMapping,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import {
  createToolBinding,
  listToolBindings,
  listToolCatalogue,
} from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { getProviderRegistration } from "@/services/provider-registration.service";
import { chainIdOfAsset, chainLabel } from "@/utils/chain";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { routes } from "@/libs/routes";

/**
 * `/provider/bindings/new` — the screen that creates a binding.
 *
 * `createToolBinding` shipped with no caller: `/provider/bindings` listed them
 * and every binding sub-route edited one, but nothing in the console could
 * bring one into existence. Both the list's empty state and the dashboard's
 * "New binding" button point here, and until this route existed both 404'd.
 *
 * ## Nine fields, even for FREE
 *
 * `POST /providers/me/tool-bindings` validates its DTO before it looks at
 * pricing, so `priceAmount` and `assetId` are **required whatever the mode
 * is** — a FREE body without them is a 400, not a defaulted zero. The server
 * then forces `priceAmount` to `"0"` for FREE anyway. So this form sends
 * `"0"` and the catalogue's asset for FREE rather than omitting either, and
 * the price input is simply not drawn in that mode.
 *
 * `assetId` is read from `listToolCatalogue().settlementAsset` and never
 * written down here. The live value is deployment-specific — an env var moves
 * it off the registry default — so a literal would be right on this deployment
 * and refused by `assertKnownAsset` on the next one. It is also where the
 * price input's `decimals` come from, so a hardcoded 6 would be the same bug
 * with a quieter failure: a price off by three orders of magnitude.
 *
 * ## The picker is a contract, not a dropdown
 *
 * A provider does not pick a tool by its name — they pick it by what it
 * obliges them to **return**. So each option carries the description (what the
 * tool is for, and what it is explicitly not for) and its `outputSchema`
 * required fields, which is the part a response mapping must satisfy before
 * the binding can ever publish. `GUARANTEED`/`VERIFIED`/`UNVERIFIED` is the
 * tier the traffic is priced and verified at, so it is on the option too.
 *
 * ## The mappings are seeded, not blank
 *
 * The editor is `@/features/provider-binding/mapping-editor` — the same one
 * `/configuration` uses, unchanged. It opens a **stored document**, and an
 * empty one is not a neutral starting point: `{}` for a RESPONSE is refused by
 * `canExpressAsRows` ("an empty object has no row to stand for it") and would
 * drop the provider straight into the JSON escape hatch, and `{}` for a
 * REQUEST is rejected by the backend validator outright (`method must be one
 * of GET | POST, got undefined`). So a chosen tool seeds an identity document
 * from its own schema — every input field read as a query parameter of the
 * same name, every output field written from a response field of the same name
 * — which is a real, validating mapping the provider edits down to their API
 * rather than an empty table they have to guess the shape of.
 *
 * The seed is only ever a starting point. Nothing here re-seeds after the
 * first render: the editors are keyed by tool, so changing the tool rebuilds
 * them and typing in them does not.
 *
 * ## Two errors that are not "something went wrong"
 *
 *   - `409 PROVIDER_BINDING_ALREADY_EXISTS` — there is one binding per
 *     (provider, tool) and the catalogue is small, so this is the error a
 *     provider meets first. It names the tool and links to the binding that
 *     already implements it, because the next action is to edit that one.
 *   - `404 PROVIDER_BINDING_TOOL_UNKNOWN` — the catalogue moved under the open
 *     form. The fix is to re-read it, so that is the action offered.
 *
 * Everything else is rendered as its own `code — message`; the wire's failure
 * body is unwrapped and `ApiError.code` is the part worth branching on.
 *
 * ## What this screen deliberately does not ask for
 *
 * `maxRps`, `maxDailyCalls`, `freeQuotaPerAgent` and `freeDailyBudget` are all
 * optional on the create DTO and all have their own console screen
 * (`/configuration`, `/configuration/free-tier`). A create form that asked for
 * eleven fields to make a draft would be a worse form; the binding is created
 * `DRAFT` — the server forces that, publishing is a separate step — so there
 * is a whole editor between here and anything going live.
 */

// ── Defaults ───────────────────────────────────────────────────────────────

/**
 * Read off the two bindings this deployment already has (`slaFailureRate:
 * 0.02`, `timeoutMs: 10000`), not invented. A 2% declared failure rate and a
 * 10s timeout are what a working HTTP tool binding looks like here.
 */
const DEFAULT_SLA_FAILURE_RATE = "0.02";
const DEFAULT_TIMEOUT_MS = "10000";

/**
 * FREE, not PAID.
 *
 * The binding cannot take traffic until it is published, and pricing has its
 * own screen with its own change-impact block. A create form that defaulted to
 * PAID would either force a price out of someone who has not decided one yet
 * or invite a zero that reads as free but is not. FREE is the mode that means
 * what it says on a draft.
 */
const DEFAULT_PRICING_MODE: PricingMode = "FREE";

const PRICING_MODES: readonly PricingMode[] = ["FREE", "FREEMIUM", "PAID"];

// ── Seeding a mapping from the tool's schema ───────────────────────────────

/**
 * `{ method, path, query }` reading every declared input field by its own
 * name.
 *
 * `GET` and `/` because they are the only pair that validates with no further
 * typing — the backend refuses a request mapping with no `method`. A tool with
 * an empty `inputSchema` (there is one in the catalogue) seeds no `query` at
 * all, which is correct: it has nothing to read.
 */
function seedRequestMapping(tool: CatalogueTool): ToolMapping {
  const fields = schemaFields(tool.inputSchema);
  const seed: ToolMapping = { method: "GET", path: "/" };
  if (fields.length > 0) {
    seed.query = Object.fromEntries(
      fields.map((field) => [field.name, { $path: `$.${field.name}` }])
    );
  }
  return seed;
}

/**
 * Every declared output field written from a response field of the same name.
 *
 * Required fields are not singled out: the editor already marks them and warns
 * when one is unwritten, and a seed that skipped the optional ones would quietly
 * teach a provider that the tool has fewer fields than it does.
 */
function seedResponseMapping(tool: CatalogueTool): ToolMapping {
  return Object.fromEntries(
    schemaFields(tool.outputSchema).map((field) => [field.name, { $path: `$.${field.name}` }])
  );
}

// ── The form's own parsing ─────────────────────────────────────────────────

interface Parsed<T> {
  value: T | null;
  error: string | null;
}

/**
 * The API validates `require_protocol` with `http`/`https`, so a bare host is
 * a 400 with a message about a URL address. It is worth catching here, where
 * the field is still on screen.
 */
function parseEndpoint(text: string): Parsed<string> {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: "Required." };
  if (trimmed.length > 2048) return { value: null, error: "At most 2048 characters." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { value: null, error: "A full URL, including http:// or https://." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { value: null, error: "http or https only." };
  }
  return { value: trimmed, error: null };
}

/** `slaFailureRate` is a fraction in 0..1 — 0.02 is 2%, not 2. */
function parseFailureRate(text: string): Parsed<number> {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: "Required." };
  if (!/^\d*(\.\d+)?$/.test(trimmed)) {
    return { value: null, error: "A fraction between 0 and 1, e.g. 0.02 for 2%." };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { value: null, error: "Between 0 and 1 — it is a fraction, not a percentage." };
  }
  return { value: parsed, error: null };
}

function parseTimeout(text: string): Parsed<number> {
  const parsed = integerFromInput(text);
  if (parsed.error) return parsed;
  if (parsed.value == null) return { value: null, error: "Required." };
  if (parsed.value < 1 || parsed.value > 120000) {
    return { value: null, error: "1 to 120000 milliseconds." };
  }
  return parsed;
}

/**
 * The price, in minor units, as the DTO wants it.
 *
 * FREE is the case that surprises: the field is not drawn, but `"0"` is still
 * sent, because the DTO refuses a body without `priceAmount` before the
 * service ever gets to force it to zero.
 */
function parsePrice(text: string, mode: PricingMode, decimals: number): Parsed<string> {
  if (mode === "FREE") return { value: "0", error: null };
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: "Required for this pricing mode." };
  const minor = minorUnitsFromMajorInput(trimmed, decimals);
  if (minor.error) return { value: null, error: minor.error };
  if (minor.amount == null || /^0*$/.test(minor.amount)) {
    return { value: null, error: "More than zero — use FREE for a binding that charges nothing." };
  }
  return { value: minor.amount, error: null };
}

interface Draft {
  endpoint: string;
  pricingMode: PricingMode;
  price: string;
  slaFailureRate: string;
  timeoutMs: string;
}

const EMPTY_DRAFT: Draft = {
  endpoint: "",
  pricingMode: DEFAULT_PRICING_MODE,
  price: "",
  slaFailureRate: DEFAULT_SLA_FAILURE_RATE,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

// ── The tool option ────────────────────────────────────────────────────────

const TIER_TEXT: Record<CatalogueTool["tier"], string> = {
  UNVERIFIED: "text-02",
  VERIFIED: "text-primary-600",
  GUARANTEED: "text-teal-600",
};

/**
 * `badge.tsx` has a closed variant vocabulary and no `label` prop on purpose,
 * and a tool tier is not in it. The dashboard and the binding list both drew
 * their missing pill inline from the `not-sampled` geometry rather than
 * widening the shared component; the same data reads the same way here.
 */
function TierPill({ tier }: { tier: CatalogueTool["tier"] }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px]",
        TIER_TEXT[tier]
      )}
    >
      {tier}
    </span>
  );
}

function ToolOption({
  tool,
  selected,
  existingBindingId,
  onSelect,
}: {
  tool: CatalogueTool;
  selected: boolean;
  /** The binding this provider already has for this tool, when there is one. */
  existingBindingId: string | undefined;
  onSelect: () => void;
}) {
  const required = schemaFields(tool.outputSchema).filter((field) => field.required);

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2.5 rounded-lg border p-4",
        selected ? "border-primary-500 bg-primary-5" : "border-01 bg-01"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Radio
          name="toolId"
          value={tool.id}
          checked={selected}
          onChange={onSelect}
          label={<span className="font-mono text-mono-13 font-semibold text-01">{tool.name}</span>}
        />
        <TierPill tier={tool.tier} />
      </div>

      <p className="text-body-13 leading-[1.6] text-02">{tool.description}</p>

      <p className="font-mono text-mono-12 text-03">
        must return{" "}
        {required.length > 0
          ? required
              .map((field) => `${field.name}${field.type ? `: ${field.type}` : ""}`)
              .join(" · ")
          : "nothing in particular — this tool's outputSchema requires no field"}
      </p>

      {existingBindingId ? (
        <p className="font-mono text-mono-12 text-warning-700">
          you already implement this tool ·{" "}
          <Link
            href={routes.binding(existingBindingId, "configuration")}
            className="underline"
          >
            edit that binding
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────

export default function NewToolBindingPage() {
  // Blocked by Assay: the main write action is disabled (the API refuses it anyway).
  const readOnly = useAccountReadOnly();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [toolId, setToolId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [mappings, setMappings] = React.useState<{
    request: ToolMapping | null;
    response: ToolMapping | null;
  }>({ request: null, response: null });
  const [asJson, setAsJson] = React.useState(false);
  /*
    JSON that does not parse, per editor. The editor keeps handing up the last
    document that DID parse, so without this Create stayed live and saved a
    mapping the provider could no longer see (BUG-R2-V2-02).
  */
  const [unparsed, setUnparsed] = React.useState<{ request: string | null; response: string | null }>(
    { request: null, response: null }
  );
  const mappingBlocked = unparsed.request ?? unparsed.response;

  const catalogueQuery = useQuery<ToolCatalogue, ApiError>({
    // The same key the configuration screen and the binding list use, so
    // arriving here from either costs no extra round trip.
    queryKey: ["provider", "tool-catalogue"],
    queryFn: listToolCatalogue,
    retry: 0,
    staleTime: 5 * 60 * 1000,
    networkMode: "always" as const,
  });

  /*
    Which tools this provider already implements. The console shell runs this
    exact query for the sidebar rail, so inside `(console)` it is already warm
    and this is a cache read.

    It is an advisory, never a gate: it reads one bounded page, so a provider
    with more than 50 bindings can have one it does not name. The 409 below is
    the authority, and the option stays selectable so that the server is the
    thing that says no.
  */
  const existingQuery = useQuery<CursorPage<ToolBindingSummary>, ApiError>({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
    retry: 0,
    networkMode: "always" as const,
  });

  // Which chains this provider can be paid on. Advisory like the query above:
  // a failed read (unregistered, offline) shows no warning and the server's
  // PROVIDER_BINDING_CHAIN_NOT_ENROLLED stays the authority.
  const registrationQuery = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    retry: 0,
    networkMode: "always" as const,
  });
  const enrolledChains = React.useMemo(
    () =>
      registrationQuery.data
        ? registrationQuery.data.registration.payoutAccounts
            .filter((account) => account.status === "ACTIVE")
            .map((account) => account.chainId)
        : null,
    [registrationQuery.data]
  );

  const bindingIdByTool = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const binding of existingQuery.data?.items ?? []) {
      if (!map.has(binding.toolId)) map.set(binding.toolId, binding.id);
    }
    return map;
  }, [existingQuery.data]);

  const tools = catalogueQuery.data?.tools ?? [];
  const asset = catalogueQuery.data?.settlementAsset;
  const tool = tools.find((candidate) => candidate.id === toolId) ?? null;

  const seeds = React.useMemo(
    () =>
      tool
        ? { request: seedRequestMapping(tool), response: seedResponseMapping(tool) }
        : null,
    [tool]
  );

  const parsed = {
    endpoint: parseEndpoint(draft.endpoint),
    price: parsePrice(draft.price, draft.pricingMode, asset?.decimals ?? 0),
    slaFailureRate: parseFailureRate(draft.slaFailureRate),
    timeoutMs: parseTimeout(draft.timeoutMs),
  };

  const settlementChain = chainIdOfAsset(asset?.assetId);
  const body: SaveToolBindingBody | null =
    tool &&
    asset &&
    settlementChain &&
    mappings.request &&
    mappings.response &&
    parsed.endpoint.value !== null &&
    parsed.price.value !== null &&
    parsed.slaFailureRate.value !== null &&
    parsed.timeoutMs.value !== null
      ? {
          toolId: tool.id,
          endpoint: parsed.endpoint.value,
          requestMapping: mappings.request,
          responseMapping: mappings.response,
          pricingMode: draft.pricingMode,
          priceAmount: parsed.price.value,
          assetId: asset.assetId,
          // The settlement asset's own chain: the one chain this deployment
          // prices in, so the one a new binding is offered on. Guarded below.
          settlementChains: [settlementChain as string],
          slaFailureRate: parsed.slaFailureRate.value,
          timeoutMs: parsed.timeoutMs.value,
        }
      : null;

  const create = useMutation<SavedToolBinding, ApiError, SaveToolBindingBody>({
    mutationFn: (payload) => createToolBinding(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(["provider", "tool-binding", saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
      // The next thing anybody does with a new binding is test the mapping,
      // and that is reached from the configuration screen.
      router.push(routes.binding(saved.id, "configuration"));
    },
  });

  const selectTool = (next: CatalogueTool) => {
    if (next.id === toolId) return;
    setToolId(next.id);
    // The editors are keyed by tool, so they remount and re-emit their seeds
    // immediately; clearing here means a stale document can never be submitted
    // in the window before they do.
    setMappings({ request: null, response: null });
    create.reset();
  };

  /* ------------------------------------------------------------- errors */

  const error = create.error;
  const chainNotEnrolled =
    enrolledChains !== null && settlementChain !== null && !enrolledChains.includes(settlementChain);
  const conflictBindingId = tool ? bindingIdByTool.get(tool.id) : undefined;

  const errorNote = !error ? null : error.code === "PROVIDER_BINDING_ALREADY_EXISTS" ? (
    <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
      You already have a binding for{" "}
      <span className="font-mono text-mono-12 text-01">{tool?.name ?? "this tool"}</span> — there is
      one binding per tool, so this one cannot be created twice.{" "}
      {conflictBindingId ? (
        <Link
          href={routes.binding(conflictBindingId, "configuration")}
          className="underline"
        >
          Edit the existing binding
        </Link>
      ) : (
        <Link href="/provider/bindings" className="underline">
          Find it in your bindings
        </Link>
      )}
      , or suspend it first. Pick another tool to create a new one.
    </Note>
  ) : error.code === "PROVIDER_BINDING_CHAIN_NOT_ENROLLED" ? (
    <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
      This tool settles on{" "}
      <span className="font-mono text-mono-12 text-01 break-all">{settlementChain ?? "its chain"}</span>
      , and you have no active payout account there, so the binding cannot be offered.{" "}
      <Link href="/provider/setup" className="underline">
        Add a payout address for that chain in setup
      </Link>{" "}
      and try again.
    </Note>
  ) : error.code === "PROVIDER_BINDING_TOOL_UNKNOWN" ? (
    <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
      The catalogue no longer holds{" "}
      <span className="font-mono text-mono-12 text-01">{tool?.name ?? "that tool"}</span> — it was
      withdrawn while this form was open, so nothing was created.{" "}
      <button
        type="button"
        className="underline"
        onClick={() => {
          setToolId(null);
          setMappings({ request: null, response: null });
          create.reset();
          void catalogueQuery.refetch();
        }}
      >
        Re-read the catalogue
      </button>{" "}
      and pick again.
    </Note>
  ) : (
    <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
      This binding was not created. {error.code} — {error.message}
    </Note>
  );

  /* -------------------------------------------------------------- render */

  return (
    <>
      <PageHeader
        title="New binding"
        sub="one binding per tool · created as a draft, published separately"
        actions={
          <>
            <Button variant="secondary" asChild>
              {/* `asChild` hands the whole child to Radix Slot, so Button's own
                  `icon` prop would be dropped — the icon rides inside the Link. */}
              <Link href="/provider/bindings">
                <ArrowLeft width={15} height={15} aria-hidden="true" />
                Cancel
              </Link>
            </Button>
            <Button
              icon={<Plug aria-hidden="true" />}
              disabled={readOnly || !body || mappingBlocked !== null}
              title={mappingBlocked ? `Fix this first: ${mappingBlocked}` : undefined}
              loading={create.isPending}
              onClick={() => body && !mappingBlocked && create.mutate(body)}
            >
              Create draft
            </Button>
          </>
        }
      />

      <Note tone="primary" icon={<GitBranch width={15} height={15} aria-hidden="true" />}>
        A binding is your implementation of one catalogue tool: an endpoint, a price and the two
        mappings between the tool&rsquo;s schema and your own API. It is created as a{" "}
        <span className="font-mono text-mono-12 text-01">DRAFT</span> and takes no traffic until you
        have tested the mapping and published it. Ceilings and the free tier have their own screens,
        linked at the top of the binding once the draft exists.
      </Note>

      {/* Why the button above is disabled, as text: a tooltip alone is
          invisible to touch and keyboard users. */}
      {mappingBlocked ? (
        <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
          Create draft is disabled. Fix this first: {mappingBlocked}.
        </Note>
      ) : null}

      {errorNote}

      {tool && chainNotEnrolled && !error ? (
        <Note tone="warning" icon={<Wrench width={15} height={15} aria-hidden="true" />}>
          This tool settles on{" "}
          <span className="break-all font-mono text-mono-12 text-01">
            {chainLabel(settlementChain as string)}
          </span>
          , and your payout accounts are on{" "}
          {enrolledChains && enrolledChains.length > 0
            ? enrolledChains.map(chainLabel).join(", ")
            : "no chain yet"}
          . Creating the binding will be refused until you{" "}
          <Link href="/provider/setup" className="underline">
            add a payout address for that chain
          </Link>
          .
        </Note>
      ) : null}

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Tool</PanelTitle>
            <PanelDescription>
              what the tool obliges you to return is the contract you are signing up to
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 p-4 tablet:p-5">
          {catalogueQuery.isPending ? (
            <p className="text-body-13 text-03">Loading the catalogue…</p>
          ) : catalogueQuery.error ? (
            <EmptyState
              icon={<Wrench width={22} height={22} />}
              title="The tool catalogue could not be read"
              description={`${catalogueQuery.error.code} — ${catalogueQuery.error.message}. A binding names a catalogue tool and settles in the catalogue's asset, so nothing can be created without it.`}
            />
          ) : tools.length === 0 ? (
            <EmptyState
              icon={<Wrench width={22} height={22} />}
              title="No tools to implement"
              description="The catalogue is empty, so there is no tool to bind yet."
            />
          ) : (
            <>
              {tools.map((candidate) => (
                <ToolOption
                  key={candidate.id}
                  tool={candidate}
                  selected={candidate.id === toolId}
                  existingBindingId={bindingIdByTool.get(candidate.id)}
                  onSelect={() => selectTool(candidate)}
                />
              ))}
              {asset ? (
                <p className="font-mono text-mono-12 text-03">
                  every binding settles in {asset.symbol} · {asset.assetId}
                </p>
              ) : null}
            </>
          )}
        </PanelBody>
      </Panel>

      {tool && asset && seeds ? (
        <>
          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Endpoint and pricing</PanelTitle>
                <PanelDescription>
                  the request mapping&rsquo;s path is appended to this endpoint
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="grid grid-cols-1 gap-4 p-4 tablet:grid-cols-2 tablet:p-5">
              <Field
                label="endpoint"
                value={draft.endpoint}
                spellCheck={false}
                placeholder="https://api.example.com"
                error={draft.endpoint.trim() === "" ? undefined : parsed.endpoint.error ?? undefined}
                hint="your own URL, http or https"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, endpoint: event.target.value }))
                }
              />

              <Select
                label="pricingMode"
                value={draft.pricingMode}
                hint="FREEMIUM's per-agent quota and daily budget are set on the binding's Free tier screen, after the draft is created"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pricingMode: event.target.value as PricingMode,
                  }))
                }
              >
                {PRICING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </Select>

              {draft.pricingMode === "FREE" ? (
                <p className="self-center font-mono text-mono-12 text-03">
                  a FREE binding has no price — {asset.symbol} 0 is sent and the server holds it
                  there. It only ever serves free calls; paid calls go to staked paid bindings
                </p>
              ) : (
                <Field
                  label="price per call"
                  value={draft.price}
                  inputMode="decimal"
                  spellCheck={false}
                  suffix={asset.symbol}
                  placeholder="0.25"
                  error={draft.price.trim() === "" ? undefined : parsed.price.error ?? undefined}
                  hint={`at most ${asset.decimals} decimal places`}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, price: event.target.value }))
                  }
                />
              )}

              <Field
                label="slaFailureRate"
                value={draft.slaFailureRate}
                inputMode="decimal"
                spellCheck={false}
                error={parsed.slaFailureRate.error ?? undefined}
                hint="the failure rate you declare, as a fraction — 0.02 is 2%"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, slaFailureRate: event.target.value }))
                }
              />

              <Field
                label="timeoutMs"
                value={draft.timeoutMs}
                inputMode="numeric"
                spellCheck={false}
                suffix="ms"
                error={parsed.timeoutMs.error ?? undefined}
                hint="1 to 120000 — the router may shorten it, never lengthen it"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, timeoutMs: event.target.value }))
                }
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Request mapping</PanelTitle>
                <PanelDescription>tool input → your endpoint</PanelDescription>
              </PanelTitles>
              <Button
                variant="secondary"
                size="sm"
                aria-pressed={asJson}
                onClick={() => setAsJson((current) => !current)}
                className={cn(asJson && "border-primary-500 text-primary-600")}
              >
                Edit as JSON
              </Button>
            </PanelHeader>
            <PanelBody className="gap-2.5 px-2.5 pb-2.5 pt-1.5">
              <MappingEditor
                key={`${tool.id}:REQUEST`}
                direction="REQUEST"
                toolId={tool.id}
                mapping={seeds.request}
                schema={tool.inputSchema}
                json={asJson}
                onChange={(next) => setMappings((current) => ({ ...current, request: next }))}
                onStatus={(status) =>
                  setUnparsed((current) => ({ ...current, request: status.editing }))
                }
              />
              <p className="px-1 font-mono text-mono-12 text-03">
                seeded from {tool.name}&rsquo;s inputSchema — every field read as a query parameter
                of the same name. Edit it down to what your API actually takes.
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
              <MappingEditor
                key={`${tool.id}:RESPONSE`}
                direction="RESPONSE"
                toolId={tool.id}
                mapping={seeds.response}
                schema={tool.outputSchema}
                json={asJson}
                onChange={(next) => setMappings((current) => ({ ...current, response: next }))}
                onStatus={(status) =>
                  setUnparsed((current) => ({ ...current, response: status.editing }))
                }
              />
              <p className="px-1 font-mono text-mono-12 text-03">
                seeded from {tool.name}&rsquo;s outputSchema — each field written from a response
                field of the same name.
              </p>
            </PanelBody>
          </Panel>
        </>
      ) : (
        <p className="px-1 text-body-13 text-03">
          Pick a tool above and the endpoint, the pricing and the two mapping editors appear,
          seeded from that tool&rsquo;s schemas.
        </p>
      )}
    </>
  );
}
