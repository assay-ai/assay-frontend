"use client";

import Link from "next/link";

import { PageHeader } from "@/components/g31/chrome";
import { Button } from "@/components/ui/button";

/**
 * Auto top-up does not exist (owner decision D11): only the buyer's own wallet
 * can add money to their balance, so nothing can do it on a schedule. This
 * page says so instead of silently sending the person to Funding, and points
 * at what does exist: the always-on low-balance and empty-balance alerts.
 */
export default function AutoTopUpPage() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Auto top-up" />
      <section
        aria-label="Auto top-up is not available"
        className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-5 shadow-hair"
      >
        <h2 className="text-label-md text-01">Auto top-up is not available</h2>
        <p className="text-body-13 text-02">
          Only your wallet can add money to your balance, so Assay cannot top it up for you. To hear before it runs
          out, the Money &amp; security alerts tell you in the app when your balance is low and when it is empty. They
          are always on.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" asChild>
            <Link href="/alerts">Open alert settings</Link>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/funding?action=deposit">Add funds</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
