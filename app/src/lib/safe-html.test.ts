import { describe, expect, it } from "vitest";
import { cleanHtml, cleanHtmlDeep, safeHtml } from "./safe-html";

describe("safeHtml — profile text keeps its formatting tags and nothing else", () => {
  it.each([
    ["<p>One</p><p>Two</p>", "<p>One</p><p>Two</p>"],
    ["Line one<br>Line two", "Line one<br>Line two"],
    ["<strong>Warm</strong> and <b>kind</b>, <em>calm</em> and <i>fun</i>", "<strong>Warm</strong> and <b>kind</b>, <em>calm</em> and <i>fun</i>"],
    ["<p>Ten years&nbsp;caring &amp; teaching</p>", "<p>Ten years&nbsp;caring &amp; teaching</p>"],
    ["<p>O'Brien &quot;Nanny&quot;</p>", "<p>O'Brien &quot;Nanny&quot;</p>"],
    ["<p>Line\n  two</p>", "<p>Line\n  two</p>"],
    ["", ""],
  ])("leaves %j as it is", (input, output) => {
    expect(safeHtml(input)).toBe(output);
  });

  it.each([
    ["<br/>", "<br>"],
    ["<br />", "<br>"],
    ["<P>Up</P>", "<p>Up</p>"],
    ["<p class=\"x\">a</p>", "<p>a</p>"],
    ["<strong style=\"color:red\">a</strong>", "<strong>a</strong>"],
  ])("writes the allowed tag %j bare: %j", (input, output) => {
    expect(safeHtml(input)).toBe(output);
  });

  it.each([
    "<img src=x onerror=\"document.title='x'\">",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<script>window.x=1</script>",
    "<svg onload=alert(1)>",
    "<p onclick=\"alert(1)\">y</p>",
    "<p style=\"position:fixed;inset:0\">y</p>",
    "<iframe src=\"https://example.com\"></iframe>",
    "<img alt=\">\" onerror=alert(1)>",
    "<<script>script>alert(1)<</script>/script>",
    "<style>body{display:none}</style>",
    "<!-- <img src=x onerror=alert(1)> -->",
    "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
  ])("leaves no markup a browser would run in %j", (input) => {
    const out = safeHtml(input);
    const tags = out.match(/<[^>]*>/g) ?? [];
    expect(tags.every((t) => /^<\/?(p|br|strong|b|em|i)>$/.test(t))).toBe(true);
    expect(out).not.toMatch(/<(img|a|script|svg|iframe|style|math)\b/i);
    expect(out).not.toMatch(/<[a-z][^>]*\s[a-z-]+=/i);
  });

  it("keeps the text of a dropped tag", () => {
    expect(safeHtml("<span>Kind</span> <u>and</u> <a href=\"https://x\">calm</a>")).toBe("Kind and calm");
  });

  it("drops a script or style block with its contents", () => {
    expect(safeHtml("<p>a</p><script>x()</script><style>p{}</style><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });

  it("escapes a stray angle bracket so it reads as text", () => {
    expect(safeHtml("<p>5 > 3 and 2 < 4</p>")).toBe("<p>5 &gt; 3 and 2 &lt; 4</p>");
  });

  it("returns an empty string for no text", () => {
    expect(safeHtml(null)).toBe("");
    expect(safeHtml(undefined)).toBe("");
  });
});

describe("cleanHtml — on write: the same tags, every other character as typed", () => {
  it.each(["Kids <5", "2 > 1", "<3", "<p>Kids <5</p><p>2 > 1</p><p><3</p>", "a & b &amp; c", "O'Brien \"Nanny\"", "Line one<br>Line two"])(
    "stores %j exactly as typed",
    (typed) => {
      expect(cleanHtml(typed)).toBe(typed);
    },
  );

  it("removes the same markup safeHtml removes, without escaping the rest", () => {
    expect(cleanHtml("<p onclick=\"x()\">Kids <5</p><img src=x onerror=alert(1)><script>x()</script><!-- c -->2 > 1"))
      .toBe("<p>Kids <5</p>2 > 1");
  });

  it("removes script and style blocks, comments and other tags", () => {
    const out = cleanHtml("<a href=\"javascript:alert(1)\">x</a><svg onload=1></svg><iframe src=y></iframe><style>p{}</style>");
    expect(out).toBe("x");
  });

  it("renders the same text through safeHtml as the browser shows for what was typed", () => {
    const typed = "<p>Kids <5</p><p>2 > 1</p><p><3</p>";
    expect(safeHtml(cleanHtml(typed))).toBe("<p>Kids &lt;5</p><p>2 &gt; 1</p><p>&lt;3</p>");
  });
});

describe("cleanHtmlDeep — every string in stored profile content", () => {
  it("cleans nested strings and keeps the shape, the typed characters and other values", () => {
    const stored = {
      headline: "<p>Hi</p><img src=x onerror=alert(1)>",
      bio_summary: { about: "<p>a</p><script>x()</script>", values: "<p>Kids <5, 2 > 1</p>" },
      list: ["<b>x</b>", "<svg onload=y>", "<3"],
      ai_model: "o4-mini",
      generated_at: "2026-11-11T00:00:00.000Z",
      count: 3,
      empty: null,
    };
    expect(cleanHtmlDeep(stored)).toEqual({
      headline: "<p>Hi</p>",
      bio_summary: { about: "<p>a</p>", values: "<p>Kids <5, 2 > 1</p>" },
      list: ["<b>x</b>", "", "<3"],
      ai_model: "o4-mini",
      generated_at: "2026-11-11T00:00:00.000Z",
      count: 3,
      empty: null,
    });
  });

  it("does not change the object it was given", () => {
    const stored = { headline: "<img src=x onerror=alert(1)>" };
    cleanHtmlDeep(stored);
    expect(stored.headline).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("safeHtml / cleanHtml — the browser's own tag names, long input, non-text values", () => {
  it.each([
    ["<x_y onclick=\"x()\">hi</x_y>", "hi"],
    ["<h1_x onfocus=\"x()\" autofocus>hi", "hi"],
    ["<a<b onclick=\"x()\">hi", "hi"],
    ["<p-x onclick=\"x()\">hi</p-x>", "hi"],
  ])("drops %j like any other tag a browser would read", (input, text) => {
    expect(cleanHtml(input)).toBe(text);
    expect(safeHtml(input)).toBe(text);
  });

  it("reads a long run of unclosed tag starts in linear time", () => {
    const input = "<a".repeat(200_000);
    const started = performance.now();
    const out = safeHtml(input);
    const clean = cleanHtml(input);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(out).toBe("&lt;a".repeat(200_000));
    expect(clean).toBe(input);
  });

  it("reads a long run of unclosed script starts in linear time", () => {
    const input = "<script".repeat(100_000);
    const started = performance.now();
    safeHtml(input);
    cleanHtml(input);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("returns an empty string for a value that isn't text", () => {
    expect(safeHtml({ x: 1 } as unknown as string)).toBe("");
    expect(safeHtml(12 as unknown as string)).toBe("");
  });
});

describe("safeHtml / cleanHtml — long input ending in a block or a comment", () => {
  it.each([["a comment", "<!---->"], ["a script block", "<script>"], ["a style block", "<style>x</style>"]])(
    "stays linear when the text ends with %s",
    (_name, end) => {
      const input = "<a ".repeat(100_000) + end;
      const started = performance.now();
      safeHtml(input);
      cleanHtml(input);
      expect(performance.now() - started).toBeLessThan(1_000);
    },
  );

  it("ends a tag name only where a browser does (a vertical tab is part of the name)", () => {
    expect(safeHtml("<b\u000bx>bold?</b\u000bx>")).toBe("bold?");
  });
});
