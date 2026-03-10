import { describe, expect, it } from "vitest";
import { TAB_GROUPS } from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("does not expose unfinished settings slices in the sidebar", () => {
    const settings = TAB_GROUPS.find((group) => group.label === "settings");
    expect(settings?.tabs).toEqual(["config", "debug", "logs"]);
  });
});
