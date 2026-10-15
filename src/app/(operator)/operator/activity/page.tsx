"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** The nav says "Activity"; the register lives at /operator/override-log. Keeps the filters. */
export default function ActivityAlias() {
  return <ClientRedirect to="/operator/override-log" />;
}
