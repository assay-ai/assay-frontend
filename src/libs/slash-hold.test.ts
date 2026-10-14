import { describe, expect, it } from "vitest";

import { ApiError, withSlashHoldWording } from "./ApiClient";
import {
  joinReasons,
  operatorHoldReasonText,
  providerHoldReasonText,
  slashHoldAudienceOf,
  slashHoldErrorText,
} from "./slash-hold";

describe("the hold reasons", () => {
  it("says each of the three to the provider in plain words", () => {
    expect(providerHoldReasonText("SLASH_WINDOW_FULL")).toBe("today's penalty limit is full and a penalty is waiting");
    expect(providerHoldReasonText("STAKE_FULLY_RESERVED")).toBe("your stake is fully reserved by pending penalties");
    expect(providerHoldReasonText("BONDED_BELOW_MINIMUM")).toBe("your stake is below the minimum");
  });

  it("names an unknown reason as it came", () => {
    expect(providerHoldReasonText("SOMETHING_NEW")).toBe("the chain reports SOMETHING_NEW");
    expect(providerHoldReasonText("toString")).toBe("the chain reports toString");
    expect(operatorHoldReasonText("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("keeps the code next to the operator's words", () => {
    expect(operatorHoldReasonText("STAKE_FULLY_RESERVED")).toBe(
      "Stake fully reserved by pending penalties (STAKE_FULLY_RESERVED)",
    );
  });

  it("joins one, two and three reasons", () => {
    expect(joinReasons([])).toBe("");
    expect(joinReasons(["a"])).toBe("a");
    expect(joinReasons(["a", "b"])).toBe("a and b");
    expect(joinReasons(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("slashHoldErrorText", () => {
  it("tells the buyer nothing was paid and to retry", () => {
    expect(slashHoldErrorText("TOOL_PROVIDER_SLASH_HOLD", "buyer")).toMatch(/No payment was made\. Try again later\.$/);
    expect(slashHoldErrorText("PAYMENT_PROVIDER_SLASH_HOLD", "buyer", "Robinhood Chain testnet")).toMatch(
      /^This provider is paused on Robinhood Chain testnet .*No payment was made\. Try again later, or choose another provider or chain\.$/,
    );
  });

  it("tells the provider it is the one held, and that it lifts by itself", () => {
    expect(slashHoldErrorText("TOOL_PROVIDER_SLASH_HOLD", "provider")).toMatch(
      /^Paid calls are not being routed to you: you are on a slash hold.*routing resumes automatically\.$/,
    );
    expect(slashHoldErrorText("PAYMENT_PROVIDER_SLASH_HOLD", "provider", "eip155:8453")).toMatch(
      /^Payments to you on eip155:8453 are paused.*lifts automatically\.$/,
    );
  });

  it("is null for any other code", () => {
    expect(slashHoldErrorText("PAYMENT_NO_SETTLEABLE_CHAIN", "buyer")).toBeNull();
  });
});

describe("slashHoldAudienceOf", () => {
  it("is the provider on the provider console's own routes, else the buyer", () => {
    expect(slashHoldAudienceOf("/providers/me/tool-bindings/x/test")).toBe("provider");
    expect(slashHoldAudienceOf("http://api.test/api/v1/providers/me")).toBe("provider");
    expect(slashHoldAudienceOf("/payment-intents")).toBe("buyer");
    expect(slashHoldAudienceOf("/providers/abc")).toBe("buyer");
    expect(slashHoldAudienceOf(undefined)).toBe("buyer");
  });
});

describe("withSlashHoldWording", () => {
  it("rewords both codes for the reader, keeping code, status, path and context", () => {
    const error = new ApiError("PAYMENT_PROVIDER_SLASH_HOLD", "backend words", 409, "/api/v1/payment-intents", {
      chainId: "eip155:46630",
    });
    const buyer = withSlashHoldWording(error, "/payment-intents");
    expect(buyer).toMatchObject({ code: "PAYMENT_PROVIDER_SLASH_HOLD", status: 409, path: "/api/v1/payment-intents" });
    expect(buyer.context).toEqual({ chainId: "eip155:46630" });
    expect(buyer.message).toMatch(/^This provider is paused on eip155:46630 /);

    const provider = withSlashHoldWording(new ApiError("TOOL_PROVIDER_SLASH_HOLD", "m", 503), "/providers/me/x");
    expect(provider.message).toMatch(/^Paid calls are not being routed to you/);
    expect(provider.status).toBe(503);
  });

  it("leaves every other error untouched", () => {
    const other = new ApiError("PAYMENT_NO_SETTLEABLE_CHAIN", "m", 409);
    expect(withSlashHoldWording(other, "/payment-intents")).toBe(other);
  });
});
