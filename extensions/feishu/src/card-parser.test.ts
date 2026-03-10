import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFeishuCardToMarkdownString } from "./card-parser.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/feishu-card-parser",
);

describe("parseFeishuCardToMarkdownString", () => {
  it("parses complex technical documentation card correctly", () => {
    const card = JSON.parse(fs.readFileSync(path.join(fixturePath, "card-input.json"), "utf8"));
    const expected = fs.readFileSync(path.join(fixturePath, "card-expected.md"), "utf8").trim();
    expect(parseFeishuCardToMarkdownString(card)).toBe(expected);
  });
});
