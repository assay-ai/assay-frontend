"use client";

import { Play } from "lucide-react";
import Link from "next/link";

import { START_FREE_PROMISE, useSignedIn } from "@/components/explorer/start-free";
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
  const signedIn = useSignedIn();
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {demo ? (
        <Link href="/demo" className={PRIMARY}>
          <Play aria-hidden="true" className="h-[15px] w-[15px]" />
          Watch it refuse to charge
        </Link>
      ) : null}
      <Link href="/catalogue" className={demo ? SECONDARY : PRIMARY}>
        See the tools and prices
      </Link>
      {signedIn ? (
        <Link href="/" className={SECONDARY}>
          Open app
        </Link>
      ) : demo ? null : (
        <Link href="/login" className={SECONDARY}>
          Start free
        </Link>
      )}
    </div>
    {signedIn ? null : <p className="text-body-xs text-03">{START_FREE_PROMISE}</p>}
    </div>
  );
}
