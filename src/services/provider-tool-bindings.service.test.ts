import { beforeEach, describe, expect, it, vi } from "vitest";

/* `@/services/api` is mocked at the module boundary: what is under test is the request this file composes. */
const get = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("@/services/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args) as unknown,
    put: (...args: unknown[]) => put(...args) as unknown,
    delete: (...args: unknown[]) => del(...args) as unknown,
  },
}));

const { deleteBindingCredentials, listBindingCredentials, putBindingCredentials } = await import(
  "@/services/provider-tool-bindings.service"
);

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("binding credentials", () => {
  it("lists the credential sets of a binding", async () => {
    get.mockResolvedValue([]);
    await expect(listBindingCredentials("b1")).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith("/providers/me/tool-bindings/b1/credentials");
  });

  it("puts { origin, headers } and nothing else", async () => {
    put.mockResolvedValue({ origin: "https://p.test", headers: [], updatedAt: "2026-10-18T00:00:00.000Z" });
    const headers = [{ name: "x-token", value: "v" }];
    await putBindingCredentials("b1", "https://p.test", headers);
    expect(put).toHaveBeenCalledWith("/providers/me/tool-bindings/b1/credentials", {
      origin: "https://p.test",
      headers,
    });
  });

  it("deletes by origin, URL-encoded", async () => {
    del.mockResolvedValue(undefined);
    await deleteBindingCredentials("b1", "https://p.test:8443");
    expect(del).toHaveBeenCalledWith(
      "/providers/me/tool-bindings/b1/credentials?origin=https%3A%2F%2Fp.test%3A8443"
    );
  });
});
