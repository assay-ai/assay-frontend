import { ApiError } from "@/libs/ApiClient";

/**
 * True when a record read failed because no such record exists for this
 * account: a 404, or the 400 `VALIDATION_FAILED` the API sends for an id that
 * is not even a UUID. Retrying either can never succeed, so a record page shows
 * its "could not be found" state for both, not "try again in a moment".
 */
export function isRecordMissing(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED");
}
