"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/**
 * `/calls` is a natural guess for the calls list, which lives at `/spend/calls`.
 * A client redirect (static export: no server to answer), so the query string —
 * e.g. a filter or the demo's `?debt=` — rides along.
 */
export default function CallsRedirect() {
  return <ClientRedirect to="/spend/calls" />;
}
