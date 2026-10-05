import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../src/App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: "ok", version: "1.0.0", apiVersion: "v1" }),
        ),
      ),
  );
});
const open = (route = "/") =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>,
  );

describe("web routes", () => {
  it.each([
    ["/", "Remember what’s"],
    ["/login", "Connect Google Drive"],
    ["/library", "Box library"],
    ["/search", "Search your storage"],
    ["/box/test-box", "Box details"],
    ["/box/test-box/edit", "Edit box"],
    ["/box/test-box/item/test-item", "Item details"],
    ["/settings", "Settings"],
    ["/unknown", "Page not found"],
  ])("renders %s", async (route, heading) => {
    open(route);
    expect(
      screen.getByRole("heading", { level: 1, name: new RegExp(heading!) }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Service available")).toBeInTheDocument();
  });
  it("navigates to account setup with sign-in disabled until configuration is ready", async () => {
    open("/library");
    await userEvent.click(screen.getByRole("link", { name: "Account setup" }));
    expect(
      screen.getByRole("heading", { name: "Connect Google Drive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();
    expect(await screen.findByText("Service available")).toBeInTheDocument();
  });
  it("reports a failed health check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable")),
    );
    open();
    expect(await screen.findByText("Service unavailable")).toBeInTheDocument();
  });
});
