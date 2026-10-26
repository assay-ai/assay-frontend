"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
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
import { dateOnly } from "@/components/g31/format";
import { PROVIDER_EXPLAINER } from "@/components/layout/provider-nav-config";
import { useOrgHandle } from "@/components/toolsets/use-toolsets";
import { useChainName } from "@/hooks/useChainName";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError } from "@/libs/plain-language";
import { termsVersionLabel } from "@/features/m41/terms";
import { providerQueries } from "@/features/provider-home/queries";

/**
 * Account: contacts, public name and payout wallet, terms.
 *
 * Page Header / Contacts / Public name and payout wallet / Terms, each full width. The shell, its 16px gap and its [22, 26]
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
 * ## No API keys here
 *
 * A provider needs no agent key: every provider route (`/providers/*`, the
 * tool sets, the catalogue) is a signed-in person's only, and the API refuses
 * an agent key on them whatever its scopes. Keys live on Agents & keys.
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


interface SeatRow {
  id: string;
  member: string;
  role: string;
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
  const registration = useQuery(providerQueries.registration());

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
          // Optional at sign-up; asked before a paid listing goes live.
          member: record.ownerContact
            ? `${record.ownerContact.name} · ${record.ownerContact.email}`
            : "Not added yet (needed before you charge for a tool)",
          role: "Escalations",
        },
      ]
    : [];

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

  const registrationError =
    registration.error instanceof ApiError ? registration.error : null;

  return (
    <>
      {/* Page Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Account</h1>
          <p className="text-body-13 text-03">Your contacts, your payout wallet and the terms you accepted.</p>
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
              : plainApiError(registrationError)
          }
        />
      ) : null}

      {/* Seats. */}
      <Panel>
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

    </>
  );
}
