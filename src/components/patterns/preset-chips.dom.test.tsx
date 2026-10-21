// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { parseAmountInput } from "@/utils/money";

import { PresetChips } from "./preset-chips";

/*
  BUG-BUY-MONEY-03: the Custom field dropped every character that was not a
  digit or a point, so "-5" became 5, "1e3" became 13 and "1,5" became 15,
  with the button offering that amount. The text is kept as typed now and
  the field says what is wrong.
*/
function Harness() {
  const [value, setValue] = React.useState("");
  const parsed = parseAmountInput(value, { decimals: 6 });
  return (
    <>
      <PresetChips label="Deposit amount" presets={["5", "20"]} value={value} onChange={setValue} error={value ? parsed.error : null} />
      <output data-testid="atomic">{parsed.atomic ?? ""}</output>
    </>
  );
}

function typeCustom(text: string) {
  fireEvent.change(screen.getByLabelText("Deposit amount, custom amount"), { target: { value: text } });
}

describe("PresetChips custom amount", () => {
  afterEach(cleanup);

  it.each(["abc", "1e3", "-5", "1,5"])("keeps %s as typed and shows the error", (text) => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    typeCustom(text);
    expect((screen.getByLabelText("Deposit amount, custom amount") as HTMLInputElement).value).toBe(text);
    expect(screen.getByText("Enter an amount like 20 or 20.50.")).toBeTruthy();
    expect(screen.getByTestId("atomic").textContent).toBe("");
  });

  it.each([
    ["12.50", "12500000"],
    ["1,000", "1000000000"],
    ["$7", "7000000"],
  ])("still takes %s", (text, atomic) => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    typeCustom(text);
    expect(screen.queryByText("Enter an amount like 20 or 20.50.")).toBeNull();
    expect(screen.getByTestId("atomic").textContent).toBe(atomic);
  });
});
