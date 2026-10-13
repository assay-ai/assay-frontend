"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { getDemoStatus } from "@/services";

const BASE = "flex items-center gap-[7px] rounded-md px-[18px] py-3 text-label-sm";

/**
 * The page's primary CTA. It leads to `/demo`, which has nothing to run on a
 * deployment with no demo credential — so there the button is disabled and
 * says why, instead of sending the visitor to a dead end.
 */
export function DemoCta() {
  const [configured, setConfigured] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    getDemoStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured);
      })
      // Unknown is not "unconfigured": the demo page reports its own failures.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!configured) {
    return (
      <span
        aria-disabled="true"
        title="The live demo is not available yet"
        className={`${BASE} cursor-not-allowed bg-03 text-03`}
      >
        <Play aria-hidden="true" className="h-[15px] w-[15px]" />
        Live demo not available yet
      </span>
    );
  }

  return (
    <Link href="/demo" className={`${BASE} bg-primary-500 text-on-color shadow-hair hover:bg-primary-600`}>
      <Play aria-hidden="true" className="h-[15px] w-[15px]" />
      Watch it refuse to charge
    </Link>
  );
}
