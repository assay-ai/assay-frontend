"use client";

import { useSearchParams } from "next/navigation";

/**
 * One query-string value, or "" when absent. Record ids live in the query
 * string (see `libs/routes.ts`), so this is what a record screen reads where it
 * used to read `useParams()`.
 *
 * `useSearchParams` needs a Suspense boundary above it in a static export; the
 * route-group layouts provide it.
 */
export function useSearchParam(name: string): string {
  return useSearchParams().get(name) ?? "";
}
