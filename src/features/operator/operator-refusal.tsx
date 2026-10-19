import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/libs/ApiClient";

/**
 * What the shell shows when `GET /operator/me` is refused with something other
 * than a 401 (a 401 ends the session and returns to sign-in).
 *
 * An operator removed or suspended since signing in lands here: the backend
 * re-reads the row on every request and answers `403 OPERATOR_NOT_AUTHORIZED`.
 * The session is still in storage, so
 * Sign out is always offered.
 */
export function OperatorRefusal({
  error,
  onSignOut,
}: {
  error: unknown;
  onSignOut: () => void;
}) {
  if (error instanceof ApiError && error.code === "OPERATOR_NOT_AUTHORIZED") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-13 text-danger-500" role="alert">
          This wallet is not an Assay operator any more: its access was removed or suspended.
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    );
  }

  const detail = error instanceof ApiError ? `${error.code} · ${error.message}` : String(error);
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-body-13 text-danger-500" role="alert">
        The operator console could not confirm your session. {detail}
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );
}

/** `detail` is the backend's own sentence, which names the operator. */
export function SuspendedBanner({
  detail,
  onSignOut,
}: {
  detail: string;
  onSignOut: () => void;
}) {
  return (
    <Banner
      tone="danger"
      title="This operator account is suspended"
      description={`${detail}. The queue and all operator actions are disabled while the account is suspended.`}
      action={<BannerAction onClick={onSignOut}>Sign out</BannerAction>}
    />
  );
}
