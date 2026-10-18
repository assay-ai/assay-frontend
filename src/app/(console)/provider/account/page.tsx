"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageState } from "@/components/patterns/page-state";
import { Table, type TableColumn } from "@/components/ui/table";
import { dateOnly, relativeTime } from "@/components/g31/format";
import { PROVIDER_EXPLAINER } from "@/components/layout/provider-nav-config";
import { useOrgHandle } from "@/components/toolsets/use-toolsets";
import { useChainName } from "@/hooks/useChainName";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { credentialLabel, type CredentialLike } from "@/features/buyer-money/mcp-config";
import { termsVersionLabel } from "@/features/m41/terms";
import { createCredential, listAgents, listCredentials } from "@/services/account.service";
import { getProviderRegistration } from "@/services/provider-registration.service";

/**
 * Account, seats and credentials.
 *
 * Page Header / a two-panel row (Seats + Machine tokens, the second fixed at
 * 520px) / a full-width Terms panel. The shell, its 16px gap and its [22, 26]
 * padding come from the `(console)` layout.
 *
 * ## Seats do not exist, and the panel says what does
 *
 * There is **no seats endpoint** — no members resource, no roles, no
 * invitations, nothing on the API surface at all. The frame's own subtitle is
 * the reason the panel is still worth drawing: "an enforcement notice must
 * reach a person, so contacts are typed". Two people are typed, on
 * `GET /providers/me/registration`: `ownerContact` and `technicalContact`.
 * Those are the rows.
 *
 * They are contacts, not seats — nobody can sign in as them and neither has a
 * role in any permission system. So the two columns a seat system would
 * populate, **Contact for** and **Last active**, render the unknown treatment
 * rather than a plausible guess. `GET /audit-log` cannot fill "Last active"
 * either: its `actorId` is a credential id, not a person's email, so joining
 * the two would attribute activity to whichever human happened to sort first.
 * (It is also empty for this org.)
 *
 * ## Machine tokens
 *
 * `GET /agents` → `GET /agents/{agentId}/credentials`, flattened across every
 * agent. The provider org has one agent and, in the seed, no credentials — so
 * the empty state is the state this screen ships in.
 *
 * `POST` returns the secret **exactly once**; the reveal is therefore a sheet
 * opened by the response, not a route, because a route would imply the key
 * could be navigated back to. That mirrors the one-time key reveal screen, which is the only
 * place in the design a one-time secret is drawn.
 *
 * **No scope vocabulary is published anywhere** — `CreateAgentCredentialBodyDto`
 * types `scopes` as an unconstrained `string[]`, and a credential created with
 * none comes back with `scopes: []` (measured). The frame writes "binding
 * read/write" and "read only (CI)"; offering those as choices would invent a
 * permission model. The sheet asks for a name and nothing else, and the Scope
 * column dashes an empty list.
 *
 * **There is no revoke control**, because the frame draws none — its only
 * per-panel affordance is an ellipsis button the designer marked
 * `enabled: false`. Minting a token you cannot retire from the same screen is
 * a real gap; it is not patched here, because the
 * buyer's agent-key revocation screen already owns that interaction and inventing a second one would
 * put two different revoke flows in one product.
 *
 * ## Terms is the one panel that is fully sourced
 *
 * `registration.acceptedTerms` gives the version accepted, when, and by which
 * console credential; `terms` gives the version currently in force. The frame
 * names three documents — provider agreement, data-processing addendum, risk
 * disclosure. The API tracks three too, but they are the provider agreement,
 * the **payout terms** and the **slash policy**. The rows follow the API,
 * because a row for a document nobody versions could never disagree with
 * itself, which is the entire point of the "In force" column.
 *
 * The API carries no link to the documents themselves, so the rows are not
 * links; the panel links what a provider can read: the key terms on Setup and
 * the business explainer.
 *
 * ## Who you are and where you are paid
 *
 * The public name (`GET /org/handle`) and the payout wallet per chain
 * (`registration.payoutAccounts`), each with where to change it.
 *
 * ## Nothing here writes the registration
 *
 * Contacts and the payout wallet are edited on Setup (`/provider/setup`),
 * which already owns `PATCH /providers/me/registration` and the wallet proof;
 * this screen links there ("Edit") rather than growing a second form.
 */


interface Credential extends CredentialLike {
  id: string;
  agentId: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface CreatedCredential {
  id: string;
  name: string;
  prefix: string;
  /** Shown exactly once. Never re-fetchable. */
  token: string;
  scopes: string[];
  createdAt: string;
}

interface SeatRow {
  id: string;
  member: string;
  role: string;
}

interface TokenRow {
  id: string;
  name: string;
  token: string;
  lastUsed: string;
}

/**
 * "••••8f3a": enough to tell two keys apart, never the key's raw prefix. An
 * OAuth grant has no key: it is named as the app sign-in it is.
 */
function maskedKey(credential: CredentialLike): string {
  return credential.prefix ? `••••${credential.prefix.slice(-4)}` : credentialLabel(credential);
}

/** Terms versions are dated ("2026-06-15"); said exactly as Setup says them ("Apr 1, 2026 version"). */
function versionLabel(version: string): string {
  const label = termsVersionLabel(version);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

interface TermRow {
  id: string;
  document: string;
  /** The version accepted, "Apr 1, 2026 version" — what Setup calls it. */
  version: string;
  accepted: string;
  inForce: string;
}

/**
 * **The frame's own column widths do not fit the frame's own panel**, and this
 * is the one place these tables deviate from it.
 *
 * The design sets Role 150, Contact for 230, Last active 170 inside a panel that
 * is 604px wide at 1440 (1140 content − 520 for Machine tokens − 16 gap). After
 * the body's 10px padding, the row's 12px padding and three 12px gaps, 524px
 * remain for four columns whose fixed three already claim 550. Rendering the
 * design on its own shows the result: "founder@provider.example" printed
 * straight through "Owner" and "escalation, disputes, stake", and the
 * "Last active" column clipped off the panel edge.
 *
 * Reproducing that overlap verbatim would render the Member column at zero
 * width — measured, before this change: the email was invisible. So the three
 * fixed columns are narrowed to 90px each, which leaves the email the ~218px it
 * needs and keeps all four headers legible. `noTruncate` + `whitespace-nowrap`
 * keeps the design's own overflow behaviour for the day "Contact for" has a
 * value: it bleeds rather than ellipsising.
 */
const SEAT_COLUMNS: TableColumn<SeatRow>[] = [
  {
    key: "member",
    header: "Contact",
    noTruncate: true,
    cell: (row) => <span className="font-semibold [overflow-wrap:anywhere]">{row.member}</span>,
  },
  { key: "role", header: "For", width: 150, align: "end", cell: (r) => r.role },
];

const TOKEN_COLUMNS: TableColumn<TokenRow>[] = [
  {
    key: "token",
    header: "Key",
    noTruncate: true,
    cell: (row) => (
      <span className="flex flex-col">
        <span className="whitespace-nowrap font-semibold">{row.name}</span>
        <span className="font-mono text-mono-xs text-03">{row.token}</span>
      </span>
    ),
  },
  {
    key: "lastUsed",
    header: "Last used",
    width: 150,
    align: "end",
    noTruncate: true,
    cell: (r) => <span className="whitespace-nowrap">{r.lastUsed}</span>,
  },
];

const TERM_COLUMNS: TableColumn<TermRow>[] = [
  {
    key: "document",
    header: "Document",
    cell: (row) => <span className="font-semibold">{row.document}</span>,
  },
  {
    key: "accepted",
    header: "You accepted",
    width: 210,
    align: "end",
    noTruncate: true,
    cell: (r) => (
      <span className="flex flex-col items-end">
        <span>{r.version}</span>
        <span className="text-body-xs text-03">{r.accepted}</span>
      </span>
    ),
  },
  { key: "inForce", header: "Status", width: 190, align: "end", noTruncate: true, cell: (r) => r.inForce },
];

export default function ProviderAccountPage() {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [created, setCreated] = React.useState<CreatedCredential | null>(null);
  /**
   * Bumped after every write and threaded into the request URL, not only the
   * React Query key.
   *
   * Every GET on this API answers `Cache-Control: private, max-age=10,
   * stale-while-revalidate=3600`, so after a write the BROWSER can serve the
   * pre-write body for up to an hour and the request never reaches the server.
   * `invalidateQueries` does not help — it does not change the URL. `from` is
   * the buster because it is on the endpoint's parameter whitelist (an unknown
   * parameter is a 400) and a `from` near the epoch excludes nothing.
   *
   * `cacheEpoch` is why the offset is not simply `0`. A counter that restarts
   * at zero on every mount asks for the SAME url the last session already
   * cached — measured on this screen: two credentials had been revoked, the API
   * returned both to `fetch`, and a freshly loaded page still rendered one row
   * reading "never used". A per-mount offset (a random point inside 1970-01-01,
   * so still earlier than any row) makes each session's first read a real one.
   */
  const [cacheEpoch] = React.useState(() => Date.now() % 86_400_000);
  const [writeCount, setWriteCount] = React.useState(0);

  const registration = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    retry: false,
  });

  const agents = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }),
  });

  const agentIds = React.useMemo(
    () => (agents.data?.items ?? []).map((agent) => agent.agentId),
    [agents.data],
  );

  const credentials = useQuery({
    queryKey: ["provider", "credentials", agentIds, cacheEpoch, writeCount],
    enabled: agentIds.length > 0,
    /*
      `queryFn` closes over `cacheEpoch` and `writeCount`, which are both in
      the key above, so the closure and the key agree. This used to carry an
      `eslint-disable-next-line @tanstack/query/exhaustive-deps`, which was
      dead: `@tanstack/eslint-plugin-query` has never been a dependency of this
      repo, so the rule never ran and the directive suppressed nothing. It was
      removed when the frontend gained its first ESLint config, because ESLint
      reports a disable comment naming an unknown rule as an error of its own.
      If that plugin is ever added, this call is where its finding will land.
    */
    queryFn: async () => {
      const pages = await Promise.all(
        agentIds.map(
          (id) =>
            listCredentials(id, {
              limit: 50,
              from: new Date(cacheEpoch + writeCount).toISOString(),
            } as never) as Promise<{ items: Credential[] }>,
        ),
      );
      return pages.flatMap((page) => page.items);
    },
  });

  const record = registration.data?.registration;
  const published = registration.data?.terms;
  const handle = useOrgHandle();
  const chainName = useChainName();

  const seatRows: SeatRow[] = record
    ? [
        {
          id: "technical",
          member: `${record.technicalContact.name} · ${record.technicalContact.email}`,
          role: "Main contact",
        },
        {
          id: "owner",
          member: `${record.ownerContact.name} · ${record.ownerContact.email}`,
          role: "Escalations",
        },
      ]
    : [];

  const tokenRows: TokenRow[] = (credentials.data ?? []).map((credential) => ({
    id: credential.id,
    name: credential.name,
    token: maskedKey(credential),
    // A revoked credential is kept, not deleted, so its row stays readable —
    // and the cell says which it is rather than showing a stale "last used".
    lastUsed: credential.revokedAt
      ? `revoked ${dateOnly(credential.revokedAt)}`
      : credential.lastUsedAt
        ? relativeTime(credential.lastUsedAt)
        : "never used",
  }));

  const termRow = (id: string, document: string, accepted: string, inForce: string): TermRow => ({
    id,
    document,
    version: versionLabel(accepted),
    accepted: `on ${dateOnly(record!.acceptedTerms.acceptedAt)}`,
    inForce: accepted === inForce ? "Up to date" : `${versionLabel(inForce)} is now in force`,
  });
  const termRows: TermRow[] =
    record && published
      ? [
          termRow("provider-agreement", "Provider agreement", record.acceptedTerms.providerAgreementVersion, published.providerAgreementVersion),
          termRow("payout-terms", "Payout terms", record.acceptedTerms.payoutTermsVersion, published.payoutTermsVersion),
          termRow("slash-policy", "Penalty policy", record.acceptedTerms.slashPolicyVersion, published.slashPolicyVersion),
        ]
      : [];

  const createMutation = useMutation({
    mutationFn: (label: string) =>
      createCredential(agentIds[0], { name: label }) as Promise<CreatedCredential>,
    onSuccess: (credential) => {
      setCreated(credential);
      setCreating(false);
      setName("");
      setWriteCount((n) => n + 1);
    },
  });

  const registrationError =
    registration.error instanceof ApiError ? registration.error : null;

  return (
    <>
      {/* Page Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Account</h1>
          <p className="text-body-13 text-03">Your contacts, API keys for scripts and the terms you accepted.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            icon={<Plus />}
            type="button"
            // A token belongs to an agent. With no agent there is nothing to
            // attach one to, so the control says it cannot act instead of
            // failing on the click.
            disabled={agentIds.length === 0}
            onClick={() => setCreating(true)}
          >
            New API key
          </Button>
          {agentIds.length === 0 ? (
            <span className="text-body-xs text-03">A key belongs to an agent; there is none yet.</span>
          ) : null}
        </div>
      </header>

      {registrationError ? (
        <Banner
          tone={registrationError.code === "PROVIDER_NOT_FOUND" ? "warning" : "danger"}
          title={
            registrationError.code === "PROVIDER_NOT_FOUND"
              ? "This organization has not registered as a provider"
              : "The account could not be loaded"
          }
          description={
            registrationError.code === "PROVIDER_NOT_FOUND"
              ? "Finish setup to add your contacts and accept the terms."
              : plainError(registrationError.code)
          }
        />
      ) : null}

      {createMutation.error instanceof ApiError ? (
        <Banner
          tone="danger"
          title="The API key could not be created"
          description={plainError(createMutation.error.code)}
        />
      ) : null}

      {/* Row — gap 16, Seats flexes, Machine tokens fixed at 520. */}
      <div className="flex w-full flex-col items-stretch gap-4 tablet:flex-row tablet:items-start">
        {/* Seats. */}
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Contacts</PanelTitle>
              <PanelDescription>who we reach about incidents and penalties</PanelDescription>
            </PanelTitles>
            {record ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/provider/setup?step=you">
                  <Pencil aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            ) : null}
          </PanelHeader>
          {/* Body — padding [6, 10, 10, 10]. */}
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            {seatRows.length > 0 ? (
              <Table columns={SEAT_COLUMNS} rows={seatRows} caption="Seats" />
            ) : (
              /* OUR copy — the frame draws three rows and no empty state. */
              <EmptyState
                className="m-2.5"
                icon={null}
                title="No contact is on file"
                description="Registration types an owner and a technical contact. Until it completes, there is nobody for an enforcement notice to reach."
              />
            )}
          </PanelBody>
        </Panel>

        {/* Machine tokens — fixed 520 on the frame. */}
        <Panel className="w-full shrink-0 tablet:w-[520px]">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>API keys for scripts</PanelTitle>
              <PanelDescription className="whitespace-normal">let a deploy pipeline or script manage your tools without a person signing in</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [6, 10, 10, 10]. */}
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            {credentials.isPending && agentIds.length > 0 ? (
              <PageState kind="loading" rows={2} bare label="Loading API keys" />
            ) : tokenRows.length > 0 ? (
              <Table columns={TOKEN_COLUMNS} rows={tokenRows} caption="API keys for scripts" />
            ) : (
              /* OUR copy — the frame draws two rows and no empty state. This is
                 the state the seeded provider org is actually in. */
              <EmptyState
                className="m-2.5"
                icon={<KeyRound width={22} height={22} />}
                title="No API key yet"
                description="Nothing but a signed-in person can change this account. Create a key when a deploy pipeline or script needs to."
              />
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* Who buyers see, and where the money goes. */}
      {record ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Public name and payout wallet</PanelTitle>
              <PanelDescription>what buyers see you as, and where your earnings land</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-4 tablet:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-body-xs text-03">Public name</dt>
                <dd className="flex flex-col gap-0.5 text-body-13 text-01">
                  {handle.isPending ? (
                    <span className="text-03">…</span>
                  ) : handle.data?.handle ? (
                    <>
                      <span className="font-mono">@{handle.data.handle}</span>
                      <span className="text-body-xs text-03">
                        {handle.data.canChange
                          ? "Not locked yet: it locks once something you share is named after it."
                          : "Locked: your shared tools and tool sets are named after it."}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Not claimed yet</span>
                      <span className="text-body-xs text-03">
                        You claim it when you{" "}
                        <Link href="/provider/apis/new" className="text-primary-600 underline-offset-2 hover:underline">
                          publish your API
                        </Link>
                        . Listings of catalogue tools do not need one.
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-body-xs text-03">Payout wallet</dt>
                <dd className="flex flex-col gap-1 text-body-13 text-01">
                  {record.payoutAccounts.length === 0 ? (
                    <span>None yet</span>
                  ) : (
                    record.payoutAccounts.map((account) => (
                      <span key={account.chainId} className="flex flex-col">
                        <span className="font-mono text-mono-12 [overflow-wrap:anywhere]">{account.accountId.split(":").pop()}</span>
                        <span className="text-body-xs text-03">
                          {chainName(account.chainId)}
                          {account.status === "ACTIVE" ? "" : account.status === "UNBONDING" ? " · stopped: you are leaving this network" : " · stopped by Assay"}
                        </span>
                      </span>
                    ))
                  )}
                  <Link href="/provider/setup?step=wallet" className="self-start text-body-xs text-primary-600 underline-offset-2 hover:underline">
                    {record.payoutAccounts.length === 0 ? "Add a payout wallet" : "Change it (sign a message, free)"}
                  </Link>
                </dd>
              </div>
            </dl>
          </PanelBody>
        </Panel>
      ) : null}

      {/* Terms. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Terms</PanelTitle>
            <PanelDescription>the version you accepted, and the one in force</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        {/* Body — padding [6, 10, 10, 10]. */}
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {termRows.length > 0 ? (
            <>
              <Table columns={TERM_COLUMNS} rows={termRows} caption="Terms" />
              <p className="px-3 pt-3 text-body-xs text-03">
                Read{" "}
                <Link href="/provider/setup?step=you" className="text-primary-600 underline-offset-2 hover:underline">
                  the key terms you accepted
                </Link>{" "}
                (price, fee, stake and penalties, under Key terms), or{" "}
                <Link href={PROVIDER_EXPLAINER.href} className="text-primary-600 underline-offset-2 hover:underline">
                  {PROVIDER_EXPLAINER.label.toLowerCase()}
                </Link>
                .
              </p>
            </>
          ) : (
            /* OUR copy. */
            <EmptyState
              className="m-2.5"
              icon={null}
              title="No terms have been accepted"
              description="The versions you accept at registration appear here beside the versions currently in force."
            />
          )}
        </PanelBody>
      </Panel>

      {/* Policy changes live under Account in the nav. */}
      <Panel>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-label-13 text-01">Policy changes</p>
            <p className="text-body-xs text-02">Changes Assay makes to the checks on your tools, with the date each takes effect.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/provider/policy-changes">See policy changes</Link>
          </Button>
        </PanelBody>
      </Panel>

      {/* Create — not drawn on the design; the button on it has to lead somewhere. */}
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New API key</SheetTitle>
            <SheetDescription>
              The key is shown exactly once. Give it a name you will recognise later.
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
            <Field
              label="Name"
              id="api-key-name"
              placeholder="CI deploy"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="For a deploy pipeline or a script that manages your tools."
            />
            <Button
              type="button"
              loading={createMutation.isPending}
              disabled={!name.trim()}
              onClick={() => createMutation.mutate(name.trim())}
            >
              Create key
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* The one-time reveal, after the one-time key reveal screen. */}
      <Sheet open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <SheetContent className="tablet:max-w-[760px]">
          <SheetHeader>
            <SheetTitle>Your new API key</SheetTitle>
            <SheetDescription>
              {created ? `${created.name} · ${maskedKey(created)}` : null}
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-5 px-[18px] pb-8 pt-5">
            {created ? <CodeBlock title={created.name} code={created.token} /> : null}
            <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-[15px] shrink-0 text-warning-600"
              />
              <p className="text-body-13 text-warning-700">
                This key is shown once. We cannot show it again; create a new one if you lose it.
              </p>
            </div>
            <div className="flex w-full justify-end">
              <Button type="button" onClick={() => setCreated(null)}>
                I have stored it
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
