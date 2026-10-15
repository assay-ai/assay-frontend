"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/**
 * `/overview` is an old name for the buyer home at `/`. A client redirect
 * (static export: no server to answer), so the query string — e.g. the demo's
 * `?fresh=new` — rides along.
 */
export default function OverviewRedirect() {
  return <ClientRedirect to="/" />;
}
