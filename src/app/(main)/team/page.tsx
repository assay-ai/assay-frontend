"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/g31/chrome";
import { Button } from "@/components/ui/button";
import { SUPPORT_URL } from "@/libs/support";

/**
 * Team: there is no multi-user account yet (owner decision D3), so this page
 * says so instead of sending the person to an unrelated screen. It offers the
 * contact link when this deployment has one, and otherwise the screens that
 * do the nearest thing (keys per integration, limits).
 */
export default function TeamPage() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Team" />
      <section
        aria-label="One person per account for now"
        className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-5 shadow-hair"
      >
        <h2 className="text-label-md text-01">One person per account for now</h2>
        <p className="text-body-13 text-02">
          An Assay account belongs to the person who signs in. Inviting a colleague, or giving finance a read-only view,
          is not available yet.
        </p>
        <p className="text-body-13 text-02">
          Each of your integrations can still have its own agent key, and spending limits apply to every call.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {SUPPORT_URL ? (
            <Button size="sm" asChild>
              <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
                Tell us you need a team <ArrowRight aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant={SUPPORT_URL ? "secondary" : "primary"} asChild>
            <Link href="/agents">Agents &amp; keys</Link>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/limits">Spending limits</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
