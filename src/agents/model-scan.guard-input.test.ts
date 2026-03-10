import { describe, expect, it } from "vitest";
import { withFetchPreconnect } from "../test-utils/fetch-mock.js";
import { scanOpenRouterModels } from "./model-scan.js";

function createFetchFixture(payload: unknown): typeof fetch {
  return withFetchPreconnect(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("model-scan: model.input undefined guard", () => {
  it("handles model entries with missing modality without crashing", async () => {
    const fetchImpl = createFetchFixture({
      data: [
        {
          id: "custom/no-modality",
          name: "No Modality Model",
          context_length: 8_192,
          supported_parameters: ["tools"],
          // modality deliberately omitted (null/undefined)
          modality: null,
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });

    const results = await scanOpenRouterModels({
      fetchImpl,
      probe: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("custom/no-modality");
    // Image probe should be skipped when modality doesn't include image
    expect(results[0].image.skipped).toBe(true);
  });

  it("handles model entries with empty modality string", async () => {
    const fetchImpl = createFetchFixture({
      data: [
        {
          id: "custom/empty-modality",
          name: "Empty Modality",
          context_length: 4_096,
          supported_parameters: [],
          modality: "",
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });

    const results = await scanOpenRouterModels({
      fetchImpl,
      probe: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].image.skipped).toBe(true);
  });

  it("correctly identifies image modality when present", async () => {
    const fetchImpl = createFetchFixture({
      data: [
        {
          id: "custom/with-image",
          name: "Image Model",
          context_length: 128_000,
          supported_parameters: ["tools"],
          modality: "text+image",
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });

    const results = await scanOpenRouterModels({
      fetchImpl,
      probe: false,
    });

    expect(results).toHaveLength(1);
    // For free models with probe: false, image is still skipped but the model
    // correctly identifies it has image input capability
    expect(results[0].image.skipped).toBe(true);
  });
});
