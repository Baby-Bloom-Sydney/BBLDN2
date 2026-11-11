/**
 * The funnel's photo slots send the applicant's lead id with the file, so the upload can check it.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoUpload } from "./PhotoUpload";

vi.mock("next/image", () => ({ default: () => null }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ url: "https://storage.test/x.jpg" }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function choose(container: HTMLElement) {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(3)], "me.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  return fetchMock.mock.calls[0][1].body as FormData;
}

describe("PhotoUpload", () => {
  it("sends the lead id with the file", async () => {
    const onChange = vi.fn();
    const { container } = render(<PhotoUpload value={null} onChange={onChange} leadId="lead-1" />);
    const body = await choose(container);
    expect(body.get("leadId")).toBe("lead-1");
    expect(body.get("file")).toBeInstanceOf(File);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("https://storage.test/x.jpg"));
  });

  it("sends the file alone when there is no lead id", async () => {
    const { container } = render(<PhotoUpload value={null} onChange={vi.fn()} />);
    const body = await choose(container);
    expect(body.has("leadId")).toBe(false);
  });
});
