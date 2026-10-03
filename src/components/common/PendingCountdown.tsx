"use client";

import * as React from "react";

import { formatRemaining, useCountdown } from "@/hooks/useCountdown";

export function PendingCountdown({
  at,
  passedLabel,
}: {
  at: string | null | undefined;
  passedLabel: string;
}) {
  const { msLeft, hasPassed } = useCountdown(at);
  if (msLeft === null) return null;
  return (
    <span className="text-body-xs text-02">
      {hasPassed ? passedLabel : `${formatRemaining(msLeft)} left`}
    </span>
  );
}
