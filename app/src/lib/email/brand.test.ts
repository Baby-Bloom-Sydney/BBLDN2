import { describe, it, expect } from "vitest";
import { emailHeader, emailFooter } from "./brand";
import { SENDERS, SITE_NAME, SITE_URL } from "@/lib/constants";

describe("emailHeader", () => {
  it("renders the product name from the constant", () => {
    expect(emailHeader()).toContain(`>${SITE_NAME}</h1>`);
  });

  it("is a single <h1> element", () => {
    expect(emailHeader().match(/<h1/g)).toHaveLength(1);
    expect(emailHeader().match(/<\/h1>/g)).toHaveLength(1);
  });

  it("carries no address of its own", () => {
    expect(emailHeader()).not.toContain("@");
  });
});

describe("emailFooter", () => {
  it("attributes the email to the product name", () => {
    expect(emailFooter()).toContain(SITE_NAME);
  });

  it("links both legal pages on the configured origin", () => {
    const html = emailFooter();
    expect(html).toContain(`${SITE_URL}/legal/privacy-policy`);
    expect(html).toContain(`${SITE_URL}/legal/professional-terms`);
  });

  it("points at the client terms when the audience is a client", () => {
    const html = emailFooter({ terms: "client" });
    expect(html).toContain(`${SITE_URL}/legal/client-terms`);
    expect(html).not.toContain("professional-terms");
  });

  it("uses the supplied terms label", () => {
    expect(emailFooter({ termsLabel: "Terms of Service" })).toContain(
      ">Terms of Service</a>",
    );
    expect(emailFooter()).toContain(">Terms</a>");
  });

  it("centres the block only when asked", () => {
    expect(emailFooter({ align: "center" })).toContain("text-align:center;");
    expect(emailFooter()).not.toContain("text-align:center;");
  });

  it("renders the optional notice line above the links", () => {
    const html = emailFooter({ notice: "You got this because you signed up." });
    expect(html).toContain("You got this because you signed up.<br/>");
    expect(html.indexOf("You got this")).toBeLessThan(
      html.indexOf("privacy-policy"),
    );
  });

  it("renders the preferences link only when a path is given", () => {
    expect(emailFooter()).not.toContain("email preferences");
    const html = emailFooter({ preferencesPath: "/nanny/settings" });
    expect(html).toContain(`${SITE_URL}/nanny/settings`);
    expect(html).toContain("email preferences");
  });

  it("never emits an address the sender table does not know", () => {
    const addresses = emailFooter({ preferencesPath: "/parent/settings" }).match(
      /[\w.+-]+@[\w.-]+/g,
    );
    for (const address of addresses ?? []) {
      expect(Object.values(SENDERS)).toContain(address);
    }
  });
});

describe("emailFooter link colour", () => {
  it("uses the violet default", () => {
    expect(emailFooter()).toContain('style="color:#7c3aed;">Privacy Policy');
  });

  it("uses a supplied theme colour on every link", () => {
    const html = emailFooter({
      linkColor: "#FF6B9D",
      preferencesPath: "/parent/settings",
    });
    expect(html).not.toContain("#7c3aed");
    expect(html.match(/#FF6B9D/g)).toHaveLength(3);
  });
});
