import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A missing "}" in styles.css does not fail the build: the rules after it
 * become nested (CSS nesting) and silently stop applying. That happened once
 * after a merge and hid the deals card's and delivery's styles, so check it.
 */
describe("styles.css", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("closes every block, and nests rules only inside @-rules", () => {
    const stack: string[] = [];
    let selector = "";
    for (const ch of css) {
      if (ch === "{") {
        const head = selector.trim();
        const parent = stack.at(-1);
        if (parent !== undefined) expect(parent.startsWith("@"), `"${head}" is nested inside "${parent}"`).toBe(true);
        stack.push(head);
        selector = "";
      } else if (ch === "}") {
        expect(stack.length, "an extra }").toBeGreaterThan(0);
        stack.pop();
        selector = "";
      } else if (ch === ";") {
        selector = "";
      } else {
        selector += ch;
      }
    }
    expect(stack, "unclosed blocks").toEqual([]);
  });
});
