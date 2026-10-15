"use client";

import { Play } from "lucide-react";
import Link from "next/link";

import { usePublicFeatures } from "@/features/explorer/use-public-explorer";

const PRIMARY =
  "flex items-center gap-[7px] rounded-md bg-primary-400 px-[18px] py-3 text-label-sm text-on-primary shadow-hair hover:bg-primary-300";
const SECONDARY =
  "flex items-center rounded-md border border-02 bg-01 px-[18px] py-3 text-label-sm text-01 shadow-hair hover:bg-02";

/**
 * The hero's buttons. The live demo leads only where it is configured
 * (`GET /public/features`); elsewhere it is not shown at all — a CTA that can
 * only say "not available" is a dead end — and the tools lead instead.
 */
export function HeroCtas() {
  const { demo } = usePublicFeatures();
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
      {demo ? (
        <Link href="/demo" className={PRIMARY}>
          <Play aria-hidden="true" className="h-[15px] w-[15px]" />
          Watch it refuse to charge
        </Link>
      ) : null}
      <Link href="/catalogue" className={demo ? SECONDARY : PRIMARY}>
        See the tools and prices
      </Link>
      {demo ? null : (
        <Link href="/login" className={SECONDARY}>
          Start free
        </Link>
      )}
    </div>
  );
}
