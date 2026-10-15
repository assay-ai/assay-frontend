"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { routes } from "@/libs/routes";
import { listToolBindings } from "@/services/provider-tool-bindings.service";

/**
 * Retired: who calls a tool now lives in that tool's Quality tab ("Who calls
 * this tool"). This URL opens the Quality tab of your first live tool, or
 * Tools when nothing is live yet.
 */
export default function AgentTrafficRedirect() {
  const router = useRouter();
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
    retry: 0,
  });
  React.useEffect(() => {
    if (bindings.isPending) return;
    const live = (bindings.data?.items ?? []).find((binding) => binding.status === "ACTIVE");
    router.replace(live ? routes.binding(live.id, "quality") : "/provider/bindings");
  }, [bindings.isPending, bindings.data, router]);
  return <PageState kind="loading" rows={2} label="Opening the page" />;
}
