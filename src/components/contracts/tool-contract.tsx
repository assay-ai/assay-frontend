"use client";

import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { majorChoices } from "@/features/contracts/entry-contract";
import {
  OPTIONAL_INPUT_HINT,
  OPTIONAL_OUTPUT_HINT,
  deprecationSentence,
  newerVersion,
  sunsetDay,
} from "@/features/contracts/text";
import type { ToolContractVersion } from "@/interfaces/contracts";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
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
 * Which providers return an extra field is not shown: the catalogue does
 * not say per provider (contract gap, see the T3 report).
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
        description={plainError(query.error instanceof ApiError ? query.error.code : "ERR_NETWORK")}
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
                  ? `Version ${c.major} was retired: calls to it are refused.${replacement ? ` Use ${replacement} instead.` : ""}`
                  : deprecationSentence(c.major, { sunsetAt: c.sunsetAt ?? "", replacement })}
              </li>
            );
          })}
        </ul>
      ) : null}

      <OptionalFields version={current} publicPage={publicPage} />

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
        {version.status === "RETIRED" ? <RetiredBadge replacement={replacement} /> : null}
        {version.publishedAt ? <span className="text-body-xs text-03">Published {sunsetDay(version.publishedAt)}</span> : null}
      </span>
      <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{version.changelog || "No notes for this version."}</p>
    </li>
  );
}

function OptionalFields({ version, publicPage }: { version: ToolContractVersion; publicPage: boolean }) {
  const outputs = version.optionalOutputFields ?? [];
  const inputs = version.optionalInputFields ?? [];
  if (outputs.length === 0 && inputs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="optional-fields">
      <h4 className="text-label-xs text-02">Extra fields (not every provider)</h4>
      {outputs.length > 0 ? <FieldGroup label="Extra fields it can return" hint={OPTIONAL_OUTPUT_HINT} fields={outputs} /> : null}
      {inputs.length > 0 ? <FieldGroup label="Extra inputs it can take" hint={OPTIONAL_INPUT_HINT} fields={inputs} /> : null}
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

function FieldGroup({ label, hint, fields }: { label: string; hint: string; fields: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-13 text-01">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <code key={f} className="rounded bg-03 px-1.5 py-0.5 font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">
            {f}
          </code>
        ))}
      </span>
      <span className="text-body-xs text-03">{hint}</span>
    </div>
  );
}
