"use client";

import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { majorChoices } from "@/features/contracts/entry-contract";
import {
  OPTIONAL_INPUT_HINT,
  OPTIONAL_OUTPUT_HINT,
  deprecationSentence,
  fieldList,
  newerVersion,
  sunsetDay,
} from "@/features/contracts/text";
import type { ToolContractVersion, ToolVersionProvider } from "@/interfaces/contracts";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { cn } from "@/utils";

import { DeprecatedBadge, RetiredBadge, VersionChip } from "./version-badges";
import { useToolVersions } from "./use-tool-versions";

/**
 * "Versions and fields" on a tool page, signed-in (`/explore?tool=`) and
 * public (`/catalogue/view?tool=`): the version agents get, every older
 * version still running (with the day it stops, UTC, and what to use
 * instead), the extra fields only some providers return or accept, and the
 * changelog, newest first.
 *
 * Each extra field names the providers that return (or accept) it, from
 * the versions read's `providers`.
 */

const SHOWN_VERSIONS = 3;

export function ToolContractSection({
  toolId,
  publicPage = false,
  compact = false,
  className,
}: {
  toolId: string;
  publicPage?: boolean;
  /** Inside the signed-in row detail: smaller headings, no card. */
  compact?: boolean;
  className?: string;
}) {
  const query = useToolVersions(toolId, { public: publicPage });
  return <ToolContractView query={query} publicPage={publicPage} compact={compact} className={className} />;
}

/** The section for a given state of the versions read (exported for tests: every state renders). */
export function ToolContractView({
  query,
  publicPage = false,
  compact = false,
  className,
}: {
  query: Pick<ReturnType<typeof useToolVersions>, "isPending" | "isError" | "error" | "data" | "refetch">;
  publicPage?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [all, setAll] = React.useState(false);
  const Heading = compact ? "h3" : "h2";
  const frame = (children: React.ReactNode) => (
    <section
      aria-label="Versions and fields"
      className={cn("flex flex-col gap-3", compact ? "" : "rounded-xl border border-01 bg-01 p-4 tablet:p-5", className)}
      data-testid="tool-contract"
    >
      <Heading className={compact ? "text-label-13 text-01" : "text-label-md text-01"}>Versions and fields</Heading>
      {children}
    </section>
  );

  if (query.isPending) return frame(<PageState kind="loading" rows={2} label="Loading the versions" />);
  if (query.isError) {
    return frame(
      <PageState
        kind="error"
        bare
        title="Couldn't load the versions"
        description={query.error instanceof ApiError ? plainApiError(query.error) : plainError("ERR_NETWORK")}
        onRetry={() => void query.refetch()}
      />,
    );
  }
  const versions = query.data?.versions ?? [];
  if (versions.length === 0) return frame(<p className="text-body-13 text-02">No version is published yet.</p>);

  const current = versions.find((v) => v.isCurrent) ?? versions[0]!;
  const older = majorChoices(versions).filter((c) => c.major !== current.major && c.status !== "ACTIVE");
  const shown = all ? versions : versions.slice(0, SHOWN_VERSIONS);

  return frame(
    <>
      <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
        <VersionChip semver={current.semver} />
        <span>Agents get this version unless they lock another one.</span>
      </p>

      {older.length > 0 ? (
        <ul className="flex flex-col gap-1.5" data-testid="older-majors">
          {older.map((c) => {
            const replacement = newerVersion(versions, c.major);
            return (
              <li key={c.major} className={cn("rounded-lg px-3 py-2 text-body-13", c.status === "RETIRED" ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700")}>
                {c.status === "RETIRED"
                  ? `Version ${c.major} was retired${c.sunsetAt ? ` on ${sunsetDay(c.sunsetAt)} (UTC)` : ""}: calls to it are refused.${replacement ? ` Use ${replacement} instead.` : ""}`
                  : deprecationSentence(c.major, { sunsetAt: c.sunsetAt ?? "", replacement })}
              </li>
            );
          })}
        </ul>
      ) : null}

      <OptionalFields version={current} publicPage={publicPage} providers={query.data?.providers ?? []} />

      <div className="flex flex-col gap-2">
        <h4 className="text-label-xs text-02">What changed</h4>
        <ol className="flex flex-col divide-y divide-01 rounded-lg border border-01" data-testid="version-list">
          {shown.map((v) => (
            <VersionRow key={v.version} version={v} replacement={newerVersion(versions, v.major)} />
          ))}
        </ol>
        {versions.length > SHOWN_VERSIONS ? (
          <button type="button" className="min-h-10 self-start text-label-13 text-primary-600 hover:underline" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${versions.length} versions`}
          </button>
        ) : null}
      </div>
    </>,
  );
}

function VersionRow({ version, replacement }: { version: ToolContractVersion; replacement: string | null }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5" data-testid="version-row">
      <span className="flex flex-wrap items-center gap-1.5">
        <VersionChip semver={version.semver} title={`Version ${version.semver}`} />
        {version.isCurrent ? <span className="rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">Current</span> : null}
        {version.status === "DEPRECATED" ? <DeprecatedBadge sunsetAt={version.sunsetAt} replacement={replacement} /> : null}
        {version.status === "RETIRED" ? <RetiredBadge replacement={replacement} sunsetAt={version.sunsetAt} /> : null}
        {version.publishedAt ? <span className="text-body-xs text-03">Published {sunsetDay(version.publishedAt)}</span> : null}
      </span>
      <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{version.changelog || "No notes for this version."}</p>
    </li>
  );
}

function OptionalFields({
  version,
  publicPage,
  providers,
}: {
  version: ToolContractVersion;
  publicPage: boolean;
  providers: readonly ToolVersionProvider[];
}) {
  const who = (field: string, kind: "out" | "in") =>
    providers
      .filter((p) => p.servedMajors.includes(version.major) && (kind === "out" ? p.providesOutputFields : p.supportsInputFields).includes(field))
      .map((p) => p.legalName);
  const outputs = version.optionalOutputFields ?? [];
  const inputs = version.optionalInputFields ?? [];
  if (outputs.length === 0 && inputs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="optional-fields">
      <h4 className="text-label-xs text-02">Extra fields (not every provider)</h4>
      {outputs.length > 0 ? (
        <FieldGroup label="Extra fields it can return" hint={OPTIONAL_OUTPUT_HINT} fields={outputs} who={(f) => who(f, "out")} verb="Returned by" known={providers.length > 0} />
      ) : null}
      {inputs.length > 0 ? (
        <FieldGroup label="Extra inputs it can take" hint={OPTIONAL_INPUT_HINT} fields={inputs} who={(f) => who(f, "in")} verb="Accepted by" known={providers.length > 0} />
      ) : null}
      <p className="text-body-xs text-03">
        {publicPage ? (
          "To get an extra field every time, add the tool to a tool set and set “Must return”."
        ) : (
          <>
            To get an extra field every time, set “Must return” on this tool in a{" "}
            <Link href="/toolsets/mine" className="text-primary-600 hover:underline">
              tool set
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}

function FieldGroup({
  label,
  hint,
  fields,
  who,
  verb,
  known,
}: {
  label: string;
  hint: string;
  fields: readonly string[];
  who: (field: string) => string[];
  verb: string;
  /** Whether the API said which providers declare what. */
  known: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-13 text-01">{label}</span>
      <ul className="flex flex-col gap-1">
        {fields.map((f) => {
          const names = who(f);
          return (
            <li key={f} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="optional-field">
              <code className="rounded bg-03 px-1.5 py-0.5 font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">{f}</code>
              {known ? (
                <span className="text-body-xs text-02">{names.length > 0 ? `${verb} ${fieldList(names)}` : "No provider offers it yet"}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span className="text-body-xs text-03">{hint}</span>
    </div>
  );
}
