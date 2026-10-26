// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/* BUG-PROD-PRV-DISPUTES-01: a double click on "Send reply" sent two POSTs. */
describe("Button with loading (an action button)", () => {
  afterEach(() => cleanup());

  function Reply({ send }: { send: () => Promise<unknown> }) {
    const respond = useMutation({ mutationFn: send });
    return (
      <Button loading={respond.isPending} onClick={() => respond.mutate()}>
        Send reply
      </Button>
    );
  }
  function mount(send: () => Promise<unknown>) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Reply send={send} />
      </QueryClientProvider>,
    );
    return screen.getByRole("button", { name: "Send reply" });
  }

  it("sends once on a double click in one frame, before loading is rendered", async () => {
    const send = vi.fn(() => new Promise(() => undefined));
    const button = mount(send);
    fireEvent.click(button);
    fireEvent.click(button);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends once on a click a moment later, while the request is out", async () => {
    const send = vi.fn(() => new Promise(() => undefined));
    const button = mount(send);
    fireEvent.click(button);
    await tick();
    fireEvent.click(button);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends again once the request is over", async () => {
    const send = vi.fn(() => Promise.resolve("ok"));
    const button = mount(send);
    fireEvent.click(button);
    await tick();
    await tick();
    fireEvent.click(button);
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("is not left dead by a click that started nothing", async () => {
    const onClick = vi.fn();
    render(<Button loading={false} onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByRole("button"));
    await tick();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("leaves a plain button (no loading prop) alone", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Next</Button>);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
