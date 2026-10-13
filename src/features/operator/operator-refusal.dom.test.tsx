import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { OperatorRefusal } from "./operator-refusal";

const markup = (error: unknown): string =>
  renderToStaticMarkup(<OperatorRefusal error={error} onSignOut={() => undefined} />);

/**
 * A suspended operator is refused on every operator route, `/operator/me`
 * included, with `403 OPERATOR_SUSPENDED`. The shell used to print that as
 * "could not confirm this token" and offered no way to drop the credential.
 */
describe("OperatorRefusal", () => {
  const suspended = new ApiError("OPERATOR_SUSPENDED", "Operator is suspended: ops-sre", 403);

  it("tells a suspended operator the account is suspended, in plain words", () => {
    const html = markup(suspended);

    expect(html).toContain("This operator account is suspended");
    expect(html).toContain("ops-sre");
    expect(html).toContain("actions are disabled");
    expect(html).not.toContain("could not confirm this token");
  });

  it("offers Sign out to a suspended operator", () => {
    expect(markup(suspended)).toContain("Sign out");
  });

  it("reports any other refusal as itself, and still offers Sign out", () => {
    const html = markup(new ApiError("INTERNAL_ERROR", "boom", 500));

    expect(html).toContain("could not confirm this token");
    expect(html).toContain("INTERNAL_ERROR · boom");
    expect(html).not.toContain("suspended");
    expect(html).toContain("Sign out");
  });
});
