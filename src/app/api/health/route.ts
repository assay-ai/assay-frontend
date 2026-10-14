import { NextResponse } from "next/server";

/**
 * Build marker, written to `out/api/health` by the static export.
 *
 * There is no Next.js server any more, so this is not a liveness probe: it is
 * a file that says which build is deployed. `next dev` still serves it, which
 * is what the local e2e stack (`up.sh`) waits on.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    success: true,
    message: "Healthcheck successful",
    buildId: process.env.buildId ?? null,
  });
}
