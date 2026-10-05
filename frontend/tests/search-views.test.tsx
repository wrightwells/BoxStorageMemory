import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect } from "vitest";
import { StorageSession } from "../src/services/session";
import { prepare } from "./connected-fixture";
import { BOX, ITEM } from "./library-fixtures";
const sessions: StorageSession[] = [];
async function open(query = "") {
  const f = await prepare();
  sessions.push(f.session);
  const router = f.open("/search" + query);
  return { ...f, router };
}
afterEach(() => {
  act(() => sessions.forEach((s) => s.dispose()));
  sessions.length = 0;
});
describe("search screen", () => {
  it("matches item descriptions with containing box/location and opens the correct item", async () => {
    const f = await open();
    await screen.findByText("Search ready: 2 indexed boxes loaded.");
    await userEvent.type(
      screen.getByLabelText("Search boxes and items"),
      "10 metre",
    );
    expect(
      screen.getByText(/BOX-0001 · Electrical Box · Garage/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("link", { name: "13A Extension Lead" }),
    );
    await waitFor(() =>
      expect(f.router.state.location.pathname).toBe(`/box/${BOX}/item/${ITEM}`),
    );
  });
  it("preserves queries in the route and offers focused item editing", async () => {
    const f = await open("?q=coiled");
    await screen.findByRole("link", { name: "13A Extension Lead" });
    expect(screen.getByLabelText("Search boxes and items")).toHaveValue(
      "coiled",
    );
    await userEvent.click(screen.getByRole("link", { name: "Edit item" }));
    const input = await screen.findByLabelText("Item name");
    await waitFor(() => expect(input).toHaveFocus());
    expect(f.router.state.location.pathname).toBe(`/box/${BOX}/edit`);
  });
  it("shows incomplete results and named inaccessible boxes instead of a definitive no-results claim", async () => {
    const f = await prepare();
    sessions.push(f.session);
    f.unavailable.add("box-folder");
    f.open("/search?q=extension");
    expect(
      await screen.findByText("Search is incomplete: 1 of 2 boxes available."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Unavailable boxes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No matching boxes or items."),
    ).not.toBeInTheDocument();
    f.unavailable.clear();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh search" }),
    );
    expect(
      await screen.findByRole("link", { name: "13A Extension Lead" }),
    ).toBeInTheDocument();
  });
  it("clears private results on sign-out and requires account setup", async () => {
    const f = await open("?q=extension");
    await screen.findByRole("link", { name: "13A Extension Lead" });
    act(() => f.session.signOut());
    expect(
      screen.queryByRole("link", { name: "13A Extension Lead" }),
    ).not.toBeInTheDocument();
    expect(f.session.search.getSnapshot().records).toEqual([]);
    expect(
      screen.getByRole("link", { name: "Account setup" }),
    ).toBeInTheDocument();
  });
  it("reports no matches only after a complete load and reloads invalidated inventories", async () => {
    const f = await open("?q=unique");
    await screen.findByText("No matching boxes or items.");
    f.inventory.items[0]!.notes = "Unique needle";
    f.files.get("inventory-file")!.version = "2";
    act(() => f.session.library.reset());
    expect(
      await screen.findByRole("link", { name: "13A Extension Lead" }),
    ).toBeInTheDocument();
  });
});
