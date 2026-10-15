"use client";

import { useSearchParam } from "@/hooks/useSearchParam";

import { BacktestView } from "./_components/backtest-view";

/** Corpus backtest. The binding id rides in `?binding=` (see `libs/routes.ts`). */
export default function BacktestPage() {
  const bindingId = useSearchParam("binding");
  return <BacktestView bindingId={bindingId} />;
}
