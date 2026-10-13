import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/libs/ApiClient";

/**
 * What the shell shows when `GET /operator/me` is refused with something other
 * than a 401 (a 401 drops the token and returns to the form).
 *
 * A suspended operator lands here, not on a `status: "SUSPENDED"` identity:
 * the backend refuses every operator route for them, `/operator/me` included,
 * with `403 OPERATOR_SUSPENDED`. The token is still in storage either way, so
 * Sign out is always offered — it is the only way to drop the credential.
 */
export function OperatorRefusal({
  error,
  onSignOut,
}: {
  error: unknown;
  onSignOut: () => void;
}) {
  if (error instanceof ApiError && error.code === "OPERATOR_SUSPENDED") {
    return <SuspendedBanner detail={error.message} onSignOut={onSignOut} />;
  }

  const detail = error instanceof ApiError ? `${error.code} · ${error.message}` : String(error);
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-body-13 text-danger-500" role="alert">
        The operator console could not confirm this token. {detail}
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
