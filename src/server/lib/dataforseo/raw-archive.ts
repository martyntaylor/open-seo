// Fork addition: keep every raw DataForSEO request/response in R2 so data the
// app trims (e.g. competitor positions in rank-check SERPs) is still queryable.
// Key: raw/<endpoint path>/<YYYY-MM-DD>/<ISO timestamp>-<uuid>.json
export async function archiveRawResponse(
  method: string,
  path: string,
  request: unknown,
  responseText: string,
): Promise<void> {
  // Dynamic import, like runtime-env.ts: outside the Workers runtime (tests,
  // Docker without R2) archiving is skipped rather than crashing the import.
  let bucket: R2Bucket | undefined;
  try {
    bucket = (await import("cloudflare:workers")).env.R2;
  } catch {
    return;
  }
  if (!bucket) return;
  const now = new Date().toISOString();
  const key = `raw${path.split("?")[0]}/${now.slice(0, 10)}/${now}-${crypto.randomUUID()}.json`;
  try {
    await bucket.put(
      key,
      `{"method":${JSON.stringify(method)},"path":${JSON.stringify(path)},"archivedAt":"${now}","request":${JSON.stringify(request ?? null)},"response":${responseText}}`,
      { httpMetadata: { contentType: "application/json" } },
    );
  } catch (error) {
    // Archiving is best-effort: never fail a call DataForSEO has already billed.
    console.error("dataforseo.raw-archive failed", { key, error });
  }
}
