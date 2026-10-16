"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { Hold } from "@/features/g30/balance";
import { getHolds } from "@/services/balances.service";

/**
 * The open holds' intents (`GET /holds`, the `["holds"]` query Funding and
 * Close account share), to tell buyer debt (held until it is collected) apart
 * from calls being checked. Empty until read.
 */
export function useOpenHoldIntentIds(): string[] {
  const holds = useQuery({
    queryKey: ["holds"],
    retry: 0,
    queryFn: () => getHolds() as Promise<{ items?: Hold[] } | Hold[]>,
  });
  return React.useMemo(() => {
    const data = holds.data;
    const items = Array.isArray(data) ? data : (data?.items ?? []);
    return items.filter((hold) => !hold.status || hold.status === "OPEN").map((hold) => hold.intentId);
  }, [holds.data]);
}
