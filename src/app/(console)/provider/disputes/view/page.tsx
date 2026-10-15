"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { useSearchParam } from "@/hooks/useSearchParam";
import { routes } from "@/libs/routes";
import { getDispute } from "@/services/provider-disputes.service";

/**
 * Retired: a dispute is shown on its penalty, in the Penalties page's
 * "Why?" drawer. The dispute names its penalty (`subjectId`), so this page
 * looks it up once and moves on; anything else lands on the Disputed tab.
 */
export default function DisputeRedirect() {
  const router = useRouter();
  const id = useSearchParam("id");
  const dispute = useQuery({ queryKey: ["dispute", id], queryFn: () => getDispute(id), enabled: Boolean(id), retry: 0 });
  React.useEffect(() => {
    if (dispute.data?.subjectType === "SLASH_PROPOSAL") router.replace(routes.penalty(dispute.data.subjectId));
    else if (!id || dispute.isError || dispute.data) router.replace(routes.penalties("disputed"));
  }, [dispute.data, dispute.isError, id, router]);
  return <PageState kind="loading" label="Opening the penalty" rows={2} />;
}
