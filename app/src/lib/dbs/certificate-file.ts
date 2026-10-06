/**
 * Client-side check for the one DBS upload slot (unit 3b, BB-LDN-3b-061026; brief change 3; rulings #3, #19).
 * A photo of page 1 (`image/*`, as the passport and selfie slots) or a PDF. No size limit is added: the bucket already caps uploads
 * (`LDN2/schema/11_storage.sql`). The server never trusts this — it re-checks the path; the AI reads the file.
 */

export const DBS_UPLOAD_ACCEPT = "image/*,application/pdf";

export const DBS_FILE_ERRORS = {
  type: "This file type isn't supported. Upload a photo (JPG or PNG) or a PDF.",
  pdf: "We couldn't open this PDF. Try a photo of page 1 instead.",
} as const;

const PDF_MAGIC = "%PDF-";

async function startsWithPdfMagic(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
    return String.fromCharCode(...head) === PDF_MAGIC;
  } catch {
    return false; // unreadable → treated as not a PDF (fail closed)
  }
}

/** `null` when the file may be uploaded, otherwise the deck error to show. */
export async function checkDbsCertificateFile(file: File): Promise<string | null> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return (await startsWithPdfMagic(file)) ? null : DBS_FILE_ERRORS.pdf;
  if (file.type.startsWith("image/")) return null;
  return DBS_FILE_ERRORS.type;
}
