/**
 * Render the invoice PDF to bytes (plan 06 step 8). Node runtime only (react-pdf's `renderToBuffer`). The element
 * is built by calling the component, which returns its `<Document>`, so it is typed `ReactElement<DocumentProps>`
 * with no cast (plan R9). Uploading and emailing are 06b's send path.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { logFailure } from "../db";
import { INVOICES_DISABLED, invoiceOk, refused, type InvoiceResult } from "../types";
import { registerInvoiceFont } from "./font";
import { InvoicePdf, type InvoicePdfData } from "./InvoicePdf";

export async function renderInvoicePdf(data: InvoicePdfData): Promise<InvoiceResult<Buffer>> {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  try {
    registerInvoiceFont();
    const element: ReactElement<DocumentProps> = InvoicePdf(data);
    return invoiceOk(await renderToBuffer(element));
  } catch (thrown) {
    logFailure("renderInvoicePdf", thrown);
    return refused("error");
  }
}
