/**
 * Unit 3b (BB-LDN-3b-061026) — the client file check for the one DBS upload slot (brief change 3; ruling #3, #19).
 */
import { describe, it, expect } from "vitest";
import { checkDbsCertificateFile, DBS_UPLOAD_ACCEPT, DBS_FILE_ERRORS } from "./certificate-file";

const file = (bytes: string, name: string, type: string) => new File([bytes], name, { type });

describe("checkDbsCertificateFile", () => {
  it("accepts image/* and application/pdf in the input's accept string", () => {
    expect(DBS_UPLOAD_ACCEPT).toBe("image/*,application/pdf");
  });

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.heic", "image/heic"],
  ])("accepts an image (%s)", async (name, type) => {
    expect(await checkDbsCertificateFile(file("xx", name, type))).toBeNull();
  });

  it("accepts a real PDF (starts %PDF-)", async () => {
    expect(await checkDbsCertificateFile(file("%PDF-1.7\n...", "cert.pdf", "application/pdf"))).toBeNull();
  });

  it("returns the type error for a .docx", async () => {
    const f = file("PK..", "cert.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(await checkDbsCertificateFile(f)).toBe(DBS_FILE_ERRORS.type);
    expect(DBS_FILE_ERRORS.type).toBe("This file type isn't supported. Upload a photo (JPG or PNG) or a PDF.");
  });

  it("returns the PDF error for a non-PDF named .pdf", async () => {
    expect(await checkDbsCertificateFile(file("hello", "cert.pdf", "application/pdf"))).toBe(DBS_FILE_ERRORS.pdf);
    expect(DBS_FILE_ERRORS.pdf).toBe("We couldn't open this PDF. Try a photo of page 1 instead.");
  });

  it("checks the bytes of a .pdf even when the browser gives no type", async () => {
    expect(await checkDbsCertificateFile(file("hello", "cert.pdf", ""))).toBe(DBS_FILE_ERRORS.pdf);
    expect(await checkDbsCertificateFile(file("%PDF-1.4", "cert.PDF", ""))).toBeNull();
  });

  it("returns the type error when there is no type and no .pdf name", async () => {
    expect(await checkDbsCertificateFile(file("x", "cert", ""))).toBe(DBS_FILE_ERRORS.type);
  });

  it("adds no size limit (#19)", async () => {
    const big = new File([new Uint8Array(60 * 1024 * 1024)], "big.png", { type: "image/png" });
    expect(await checkDbsCertificateFile(big)).toBeNull();
  });
});
