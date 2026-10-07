import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageSession } from "../src/services/session";
import { prepare } from "./connected-fixture";
import { BOX } from "./library-fixtures";
const sessions: StorageSession[] = [];
afterEach(() => {
  act(() => sessions.forEach((session) => session.dispose()));
  sessions.length = 0;
});
async function fixture() {
  const f = await prepare();
  sessions.push(f.session);
  return f;
}
describe("labels and scanner views", () => {
  it("generates, downloads, prints and regenerates the same identity without Drive writes", async () => {
    const f = await fixture();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:label");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const qr = vi
      .spyOn(f.session.api, "qr")
      .mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    f.open(`/box/${BOX}/label`);
    const above = await screen.findByRole("region", {
      name: "Number above QR code",
    });
    const left = screen.getByRole("region", { name: "Number left QR code" });
    expect(
      within(above).getByRole("img", { name: "QR code for BOX-0001" }),
    ).toHaveAttribute("src", "blob:label");
    expect(document.body.textContent).not.toContain(BOX);
    expect(
      within(above).getByRole("heading", { name: "BOX-0001" }),
    ).toBeInTheDocument();
    expect(
      within(above).getByRole("heading", { name: "BOX-0001" }).parentElement,
    ).toHaveTextContent(/^BOX-0001$/);
    expect(screen.getByRole("link", { name: "Save QR PNG" })).toHaveAttribute(
      "download",
      "BOX-0001-qr.png",
    );
    await userEvent.click(
      within(above).getByRole("button", { name: "Print label: number above" }),
    );
    expect(print).toHaveBeenCalledOnce();
    expect(above.querySelector(".qr-label")).toHaveClass("print-target");
    expect(left.querySelector(".qr-label")).not.toHaveClass("print-target");
    await userEvent.click(
      within(left).getByRole("button", { name: "Print label: number left" }),
    );
    expect(print).toHaveBeenCalledTimes(2);
    expect(left.querySelector(".qr-label")).toHaveClass("print-target");
    expect(above.querySelector(".qr-label")).not.toHaveClass("print-target");
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate QR label" }),
    );
    expect(qr).toHaveBeenCalledTimes(2);
    expect(qr.mock.calls.every(([id]) => id === BOX)).toBe(true);
    expect(f.session.drive.writeJson).not.toHaveBeenCalled();
    act(() => f.session.signOut());
    expect(revoke).toHaveBeenCalledWith("blob:label");
    expect(
      screen.queryByRole("img", { name: "QR code for BOX-0001" }),
    ).not.toBeInTheDocument();
  });
  it("offers retry when automatic QR generation fails", async () => {
    const f = await fixture();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retried-label");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const qr = vi
      .spyOn(f.session.api, "qr")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Blob(["png"], { type: "image/png" }));
    f.open(`/box/${BOX}/label`);
    await screen.findByRole("alert");
    await userEvent.click(
      screen.getByRole("button", { name: "Retry QR label" }),
    );
    await screen.findByRole("region", { name: "Number above QR code" });
    expect(
      screen.getAllByRole("img", { name: "QR code for BOX-0001" }),
    ).toHaveLength(2);
    expect(qr).toHaveBeenCalledTimes(2);
    expect(f.session.drive.writeJson).not.toHaveBeenCalled();
  });
  it("opens only valid labels and reports invalid inputs without navigation", async () => {
    const f = await fixture(),
      router = f.open("/scan");
    const input = await screen.findByLabelText("QR label URL");
    await userEvent.type(input, "https://evil.example/box/" + BOX);
    await userEvent.click(
      screen.getByRole("button", { name: "Open QR label" }),
    );
    expect(router.state.location.pathname).toBe("/scan");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "not a valid box label",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "https://boxes.example/box/" + BOX);
    await userEvent.click(
      screen.getByRole("button", { name: "Open QR label" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/box/${BOX}`),
    );
    expect(
      await screen.findByRole("heading", { name: "BOX-0001 · Electrical Box" }),
    ).toBeInTheDocument();
  });
  it("preserves a scanned box through sign-in and reports an unknown UUID without selecting another box", async () => {
    const f = await fixture();
    act(() => f.session.signOut());
    const router = f.open("/scan");
    await userEvent.type(
      screen.getByLabelText("QR label URL"),
      "https://boxes.example/box/" + BOX,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open QR label" }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: "Account setup" }),
    );
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({ returnTo: `/box/${BOX}` });
  });
  it("retains fallback navigation when camera is denied and NFC unsupported", async () => {
    const f = await fixture();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      },
    });
    f.open("/scan");
    await userEvent.click(
      screen.getByRole("button", { name: "Start QR camera" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera access is unavailable",
    );
    expect(
      screen.getByRole("link", { name: "Browse or enter a box number" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read NFC tag" })).toBeDisabled();
  });
  it("shows current tag mappings and disabled production mutations", async () => {
    const f = await fixture();
    f.open(`/box/${BOX}/tags`);
    expect(await screen.findByText("04AABBCCDDEE11")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review removal of 04AABBCCDDEE11" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Tag changes await Drive concurrency/),
    ).toBeInTheDocument();
  });
  it("preserves label routes through setup and rejects unavailable boxes", async () => {
    const f = await fixture();
    f.open("/login", undefined, { returnTo: `/box/${BOX}/label` });
    expect(
      screen.getByRole("link", { name: "Open requested record" }),
    ).toHaveAttribute("href", `/box/${BOX}/label`);
  });
});
