// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";
import { Radio } from "./radio";

afterEach(cleanup);

/*
  Onboarding wave 2 item 6: the input itself must take the click. It was
  `sr-only` (a clipped 1px box at the label's corner), so a click on the drawn
  control — or a test driver clicking the input — missed it.
*/
describe.each([
  ["Checkbox", Checkbox],
  ["Radio", Radio],
] as const)("%s", (_name, Control) => {
  it("lays the real input over the drawn control, not off screen", () => {
    render(<Control label="Accept" onChange={() => undefined} />);
    const input = screen.getByLabelText("Accept");
    expect(input.className).not.toContain("sr-only");
    expect(input.className).toContain("absolute");
    expect(input.className).toContain("inset-0");
    // Its box is the drawn control's: the input and the drawing share one 17px wrapper.
    expect(input.parentElement?.className).toContain("h-[17px]");
  });

  it("responds to a click on the input itself", () => {
    const onChange = vi.fn();
    render(<Control label="Accept" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Accept"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
