/** Unit 3g (BB-LDN-3g-141026) — copy deck §6.8: the welcome email's next-steps bullet uses London words. */
import { describe, it, expect } from "vitest";
import { buildWelcomeNannyEmail } from "./welcome-nanny";

describe("buildWelcomeNannyEmail", () => {
  it("contains \"passport and DBS certificate\" when built", () => {
    const { html } = buildWelcomeNannyEmail({ firstName: "Sophie", appUrl: "https://app.example.test" });
    expect(html).toContain("<li>Upload your passport and DBS certificate for verification</li>");
    expect(html).not.toContain("WW" + "CC");
  });
});
