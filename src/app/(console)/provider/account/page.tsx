"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, TriangleAlert } from "lucide-react";
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
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
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
 * ## Nothing here writes the registration
 *
 * The frame draws no editable field: no legal name, no timezone, no contact
 * form, and its three panel actions are all disabled. So
 * `PATCH /providers/me/registration` has **no caller on this screen**, and the
 * stale-read trap that follows a provider write does not arise. A form is
 * deliberately not invented here.
 */


interface Credential {
  id: string;
  agentId: string;
  name: string;
  prefix: string;
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
  token: string;
  lastUsed: string;
}

interface TermRow {
  id: string;
  document: string;
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
    header: "Token",
    mono: true,
    noTruncate: true,
    cell: (row) => <span className="whitespace-nowrap font-semibold">{row.token}</span>,
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
  { key: "accepted", header: "Accepted", width: 130, align: "end", noTruncate: true, cell: (r) => r.accepted },
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
    token: `${credential.prefix}…`,
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
    accepted: dateOnly(record!.acceptedTerms.acceptedAt),
    inForce: accepted === inForce ? "Up to date" : `Version ${inForce} is now in force`,
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
          <p className="text-body-13 text-03">Your contacts, machine tokens and the terms you accepted.</p>
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
            New machine token
          </Button>
          {agentIds.length === 0 ? (
            <span className="text-body-xs text-03">A token belongs to an agent; there is none yet.</span>
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
          title="The machine token could not be created"
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
            {seatRows.length > 0 ? (
              <p className="px-3 pt-3 text-body-xs text-03">
                To change a contact,{" "}
                <Link href="/provider/setup?step=you" className="text-primary-600 underline-offset-2 hover:underline">
                  edit your account details
                </Link>
                .
              </p>
            ) : null}
          </PanelBody>
        </Panel>

        {/* Machine tokens — fixed 520 on the frame. */}
        <Panel className="w-full shrink-0 tablet:w-[520px]">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Machine tokens</PanelTitle>
              <PanelDescription>config-as-code needs a token that is not a person</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [6, 10, 10, 10]. */}
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            {credentials.isPending && agentIds.length > 0 ? (
              <PageState kind="loading" rows={2} bare label="Loading tokens" />
            ) : tokenRows.length > 0 ? (
              <Table columns={TOKEN_COLUMNS} rows={tokenRows} caption="Machine tokens" />
            ) : (
              /* OUR copy — the frame draws two rows and no empty state. This is
                 the state the seeded provider org is actually in. */
              <EmptyState
                className="m-2.5"
                icon={<KeyRound width={22} height={22} />}
                title="No machine token yet"
                description="Nothing but a signed-in person can change this account. Create a token when a deploy pipeline needs to."
              />
            )}
          </PanelBody>
        </Panel>
      </div>

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
            <Table columns={TERM_COLUMNS} rows={termRows} caption="Terms" />
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
            <SheetTitle>New machine token</SheetTitle>
            <SheetDescription>
              The secret is returned exactly once. Give it a name you will recognise later.
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
            <Field
              label="Name"
              id="machine-token-name"
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
              Create token
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* The one-time reveal, after the one-time key reveal screen. */}
      <Sheet open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <SheetContent className="tablet:max-w-[760px]">
          <SheetHeader>
            <SheetTitle>Your new machine token</SheetTitle>
            <SheetDescription>
              {created ? `${created.name} · ${created.prefix}…` : null}
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-5 px-[18px] pb-8 pt-5">
            {created ? <CodeBlock title={`${created.prefix}…`} code={created.token} /> : null}
            <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-[15px] shrink-0 text-warning-600"
              />
              <p className="text-body-13 text-warning-700">
                This token is shown once. We cannot show it again — create a new one if you lose it.
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
