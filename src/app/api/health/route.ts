import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe for the Kubernetes deployment (`.deploy/*.yaml`).
 *
 * Deliberately shallow: it answers "is this Next.js server accepting
 * requests", nothing more. It must NOT reach the backend API — a probe that
 * fails when a dependency is down turns one backend outage into a restart loop
 * on every frontend pod, and takes down the pages that do not need the API at
 * all.
 *
 * `force-dynamic` because a statically rendered probe is a cached 200 that
 * keeps answering after the process is no longer healthy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    success: true,
    message: "Healthcheck successful",
    buildId: process.env.buildId ?? null,
  });
}
