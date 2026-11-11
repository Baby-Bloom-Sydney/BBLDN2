/**
 * The call offer inside the family's connection-expiry email: one paragraph in the approved words and its own
 * centred "Pick a time" button to the call page, in that email's inline styles. Never says free or sales.
 */
import { describe, expect, it } from "vitest";
import { CALL_PAGE_URL } from "./call-email-parts";
import { connectionExpiredCallOfferHtml } from "./connection-expired-call-offer";

const SENTENCE =
  "Would some help with your search be useful? Book your Complimentary matchmaker call with one of our expert matchmakers, who'll introduce you to your top nannies.";
const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const BUTTON =
  "display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;";

describe("connectionExpiredCallOfferHtml", () => {
  const html = connectionExpiredCallOfferHtml();

  it("says the approved sentence as one paragraph in the email's paragraph style", () => {
    expect(html).toContain(`<p style="${PARAGRAPH}">${SENTENCE}</p>`);
  });

  it("names the Complimentary matchmaker call and never says free or sales", () => {
    expect(html).toContain("Complimentary matchmaker call");
    expect(html).not.toMatch(/free/i);
    expect(html).not.toMatch(/sales/i);
  });

  it("its Pick a time button links the call page, in the email's violet button style", () => {
    expect(html).toContain(`<a href="${CALL_PAGE_URL}" style="${BUTTON}">Pick a time</a>`);
    expect(CALL_PAGE_URL).toMatch(/\/matchmaking\/call$/);
  });

  it("puts the button in its own centred div, after the paragraph", () => {
    expect(html).toMatch(/<\/p>\s*<div style="text-align:center;[^"]*">\s*<a href=/);
  });

  it("is a fragment: no document, no footer, no other button", () => {
    expect(html).not.toMatch(/<html|<body|Browse Nannies|unsubscribe/i);
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
