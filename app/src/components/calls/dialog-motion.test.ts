// @vitest-environment node
/**
 * Reduced motion on the call popup and the taken notice (04b rework W17, final review item 6), checked on the
 * COMPILED CSS, not the class string: the shared dialog animates with `data-[state=open]:animate-in` (a class plus an
 * attribute), which outranks a bare `motion-reduce:animate-none` (a class alone). So each component's own classes are
 * read from its source, compiled with Tailwind (and tailwindcss-animate) next to the dialog's own animation classes,
 * and the cascade is resolved for an element in each state under `prefers-reduced-motion: reduce`: the winning
 * `animation` must be `none`, and the winning `transition-property` too. `dialog.tsx` itself is left alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import tailwindcss from "tailwindcss";
import animate from "tailwindcss-animate";
import { describe, expect, it } from "vitest";

/** The shared dialog's own animation classes (`src/components/ui/dialog.tsx`, unchanged). */
const DIALOG_BASE =
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

/** The DialogContent className in a component's source (the one string holding `rounded-2xl`). */
function contentClasses(file: string): string {
  const source = readFileSync(join(__dirname, file), "utf8");
  const found = [...source.matchAll(/className="([^"]*rounded-2xl[^"]*)"/g)].map((m) => m[1]);
  if (found.length !== 1) throw new Error(`expected one DialogContent className in ${file}, found ${found.length}`);
  return found[0];
}

async function compile(classes: string): Promise<postcss.Root> {
  const plugin = tailwindcss({ content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }], plugins: [animate], corePlugins: { preflight: false } });
  const result = await postcss([plugin]).process("@tailwind utilities;", { from: undefined });
  return result.root;
}

const unescape = (selector: string) => selector.replace(/\\(.)/g, "$1");

/** The rule's class and its [data-state=…] condition, or null for a selector this check doesn't model. */
function parse(selector: string): { readonly cls: string; readonly state: string | null } | null {
  const m = /^\.((?:\\.|[^.[\s>+~])+)(?:\[data-state="?(open|closed)"?\])?$/.exec(selector.trim());
  return m ? { cls: unescape(m[1]), state: m[2] ?? null } : null;
}

/**
 * The winning value among `props` (a shorthand and its longhand count as one: `animation: none` against
 * `animation-name: enter`) for an element with `classes`, in `state`, with reduced motion on — or null.
 */
function winner(root: postcss.Root, classes: readonly string[], state: "open" | "closed", props: readonly string[]): string | null {
  let best: { specificity: number; order: number; value: string } | null = null;
  let order = 0;
  root.walkRules((rule: Rule) => {
    order += 1;
    const media = rule.parent?.type === "atrule" ? (rule.parent as AtRule).params : null;
    if (media !== null && !media.includes("prefers-reduced-motion: reduce")) return;
    for (const selector of rule.selectors) {
      const parsed = parse(selector);
      if (parsed === null || !classes.includes(parsed.cls) || (parsed.state !== null && parsed.state !== state)) continue;
      const specificity = parsed.state === null ? 1 : 2;
      rule.walkDecls((decl) => {
        if (!props.includes(decl.prop)) return;
        if (best === null || specificity > best.specificity || (specificity === best.specificity && order >= best.order)) {
          best = { specificity, order, value: decl.value };
        }
      });
    }
  });
  return (best as { value: string } | null)?.value ?? null;
}

/** `animation-name`, as set by the shorthand (`animate-none`) or the longhand (tailwindcss-animate's `animate-in`). */
const ANIMATION_NAME = ["animation", "animation-name"] as const;

describe.each([["CallPopup.tsx"], ["TakenNotice.tsx"]])("%s under prefers-reduced-motion (compiled)", (file) => {
  it.each([["open"], ["closed"]] as const)("data-state=%s: no animation and no transition win the cascade", async (state) => {
    const classes = `${DIALOG_BASE} ${contentClasses(file)}`.split(/\s+/).filter(Boolean);
    const root = await compile(classes.join(" "));
    expect(winner(root, classes, state, ANIMATION_NAME)).toBe("none");
    expect(winner(root, classes, state, ["transition", "transition-property"])).toBe("none");
  });
});

describe("the check itself", () => {
  it("a bare motion-reduce:animate-none loses to data-[state=open]:animate-in (why the variants are needed)", async () => {
    const classes = `${DIALOG_BASE} motion-reduce:animate-none`.split(/\s+/);
    const root = await compile(classes.join(" "));
    expect(winner(root, classes, "open", ANIMATION_NAME)).toBe("enter");
  });
});
