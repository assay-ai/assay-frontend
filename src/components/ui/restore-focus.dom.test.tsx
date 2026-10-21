// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

/* NF-05 / BUY-CONNECT-04: closing a dialog or sheet opened from state returns focus to its opener. */
function Harness({ kind }: { kind: "sheet" | "dialog" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      {kind === "sheet" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetTitle>Sheet</SheetTitle>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

vi.mock("../icons", () => ({ CloseLine: () => null }));

afterEach(cleanup);

describe.each(["sheet", "dialog"] as const)("%s opened from state", (kind) => {
  it("returns focus to the opener on Escape", async () => {
    render(<Harness kind={kind} />);
    const opener = screen.getByText("Opener");
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
