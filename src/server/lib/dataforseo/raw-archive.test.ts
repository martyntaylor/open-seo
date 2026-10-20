import { describe, expect, it, vi } from "vitest";

const put = vi.fn<(key: string, body: string) => Promise<void>>();
vi.mock("cloudflare:workers", () => ({ env: { R2: { put } } }));

import { archiveRawResponse } from "@/server/lib/dataforseo/raw-archive";

describe("archiveRawResponse", () => {
  it("stores the request and untouched response as valid JSON under a dated endpoint key", async () => {
    await archiveRawResponse(
      "POST",
      "/v3/serp/google/organic/live/advanced",
      [{ keyword: "seo" }],
      '{"tasks":[{"result":[{"items":[{"rank_absolute":1}]}]}]}',
    );

    const [key, body] = put.mock.calls[0];
    expect(key).toMatch(
      /^raw\/v3\/serp\/google\/organic\/live\/advanced\/\d{4}-\d{2}-\d{2}\/.+\.json$/,
    );
    expect(JSON.parse(body)).toMatchObject({
      method: "POST",
      request: [{ keyword: "seo" }],
      response: { tasks: [{ result: [{ items: [{ rank_absolute: 1 }] }] }] },
    });
  });

  it("never throws when the R2 write fails", async () => {
    put.mockRejectedValueOnce(new Error("r2 down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      archiveRawResponse("GET", "/v3/x", undefined, "{}"),
    ).resolves.toBeUndefined();
  });
});
