import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { OperatorRefusal, SuspendedBanner } from "./operator-refusal";

const markup = (error: unknown): string =>
  renderToStaticMarkup(<OperatorRefusal error={error} onSignOut={() => undefined} />);

describe("OperatorRefusal", () => {
  it("says a removed wallet is no longer an operator, and offers Sign out", () => {
    const html = markup(new ApiError("OPERATOR_NOT_AUTHORIZED", "Operator is not authorized", 403));
    expect(html).toContain("not an Assay operator any more");
    expect(html).toContain("Sign out");
  });

  it("reports any other refusal as itself, and still offers Sign out", () => {
    const html = markup(new ApiError("INTERNAL_ERROR", "boom", 500));

    expect(html).toContain("could not confirm your session");
    expect(html).toContain("INTERNAL_ERROR · boom");
    expect(html).not.toContain("suspended");
    expect(html).toContain("Sign out");
  });
});

/** The shell shows this for a signed-in operator whose status is not ACTIVE. */
describe("SuspendedBanner", () => {
  const html = renderToStaticMarkup(<SuspendedBanner detail="Operator is suspended: ops-sre" onSignOut={() => undefined} />);

  it("tells a suspended operator the account is suspended, in plain words", () => {
    expect(html).toContain("This operator account is suspended");
    expect(html).toContain("ops-sre");
    expect(html).toContain("actions are disabled");
  });

  it("offers Sign out", () => {
    expect(html).toContain("Sign out");
  });
});
