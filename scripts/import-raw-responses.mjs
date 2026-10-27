// Fork addition: import DataForSEO responses saved on disk before the R2 raw
// archive existed. Every file goes to R2 (API envelopes in the live archive
// layout, anything else as-is under imported/), and keyword data becomes
// saved keywords + metrics in the given project, tagged by source.
//
// Usage: node scripts/import-raw-responses.mjs <projectId>=<dir> [...] [--apply]
// Without --apply it only prints what it would do.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, basename, dirname } from "node:path";

const D1 = "open-seo-db-selfhost";
const R2 = "open-seo-r2-selfhost";
const LOCATIONS = { "United States": 2840, "United Kingdom": 2826 };

const apply = process.argv.includes("--apply");
const targets = process.argv
  .slice(2)
  .filter((arg) => arg.includes("="))
  .map((arg) => {
    const [projectId, dir] = arg.split("=");
    return { projectId, dir };
  });
if (targets.length === 0) {
  console.error(
    "Usage: import-raw-responses.mjs <projectId>=<dir> [...] [--apply]",
  );
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : walk(path);
    return entry.name.endsWith(".json") ? [path] : [];
  });

// Research date: a YYYY-MM-DD in the path, else the file's mtime.
const fileDate = (path) =>
  path.match(/\d{4}-\d{2}-\d{2}/g)?.at(-1) ??
  statSync(path).mtime.toISOString().slice(0, 10);

// Tag from the file name, minus dates and batch numbers; folder-prefixed when
// the folder names the topic (e.g. regions/overview.json -> "regions overview").
const fileTag = (path) => {
  const folder = basename(dirname(path));
  const stem = basename(path, ".json")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]\d+$/, "")
    .replaceAll(/[-_]/g, " ");
  return /\d{4}-\d{2}-\d{2}|^(raw|dataforseo|seo)$/.test(folder)
    ? stem
    : `${folder} ${stem}`;
};

const intentOf = (raw) => {
  const value = (raw ?? "").toLowerCase();
  for (const intent of [
    "informational",
    "commercial",
    "transactional",
    "navigational",
  ]) {
    if (value.includes(intent.slice(0, 6))) return intent;
  }
  return "unknown";
};

const trendOf = (monthly) =>
  (monthly ?? []).map((m) => ({
    year: m.year ?? 0,
    month: m.month ?? 0,
    searchVolume: m.search_volume ?? 0,
  }));

// Mirrors mapKeywordDataItems / mapAdsKeywordItems in research-data.ts.
const labsRow = (item) => ({
  keyword: item.keyword,
  searchVolume: item.keyword_info?.search_volume ?? null,
  cpc: item.keyword_info?.cpc ?? null,
  competition: item.keyword_info?.competition ?? null,
  keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
  intent: intentOf(item.search_intent_info?.main_intent),
  trend: trendOf(item.keyword_info?.monthly_searches),
});
const adsRow = (item) => ({
  keyword: item.keyword,
  searchVolume: item.search_volume ?? null,
  cpc: item.cpc ?? null,
  competition:
    item.competition_index != null ? item.competition_index / 100 : null,
  keywordDifficulty: null,
  intent: "unknown",
  trend: trendOf(item.monthly_searches),
});

// Returns { rows, locationCode, languageCode, tag } or null for non-keyword data.
function keywordRows(data, path) {
  if (Array.isArray(data)) {
    const first = data[0];
    if (!first || typeof first !== "object" || !("keyword" in first))
      return null;
    // Labs items saved without the envelope.
    if ("keyword_info" in first)
      return { rows: data.map(labsRow), tag: fileTag(path) };
    // Skill output: {keyword, volume, cpc, competition, difficulty, intent, trend}.
    // Its 12-value trend has no dates, so it is dropped rather than guessed.
    if ("volume" in first) {
      return {
        tag: fileTag(path),
        rows: data.map((r) => ({
          keyword: r.keyword,
          searchVolume: r.volume ?? null,
          cpc: r.cpc ?? null,
          competition: typeof r.competition === "number" ? r.competition : null,
          keywordDifficulty: r.difficulty ?? null,
          intent: intentOf(r.intent),
          trend: [],
        })),
      };
    }
    return null;
  }
  const task = data?.tasks?.[0];
  if (!task?.path) return null;
  const endpoint = task.path.join("/");
  const result = task.result?.[0];
  const request = task.data ?? {};
  const locationCode =
    result?.location_code ??
    request.location_code ??
    LOCATIONS[request.location_name];
  const languageCode = result?.language_code ?? request.language_code;
  const seed = request.keyword ?? fileTag(path);
  if (/keyword_overview|keyword_suggestions/.test(endpoint)) {
    return {
      rows: (result?.items ?? []).map(labsRow),
      locationCode,
      languageCode,
      tag: seed,
    };
  }
  if (endpoint.includes("related_keywords")) {
    const rows = (result?.items ?? []).map((i) =>
      labsRow(i.keyword_data ?? {}),
    );
    return { rows, locationCode, languageCode, tag: seed };
  }
  if (endpoint.includes("google_ads/search_volume")) {
    // One result per keyword here, not one result with items.
    return {
      rows: (task.result ?? []).map(adsRow),
      locationCode: task.result?.[0]?.location_code ?? locationCode,
      languageCode: task.result?.[0]?.language_code ?? languageCode,
      tag: fileTag(path),
    };
  }
  return null;
}

const sql = (value) =>
  value == null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;

const uploads = [];
const statements = [];
for (const { projectId, dir } of targets) {
  const [project] = JSON.parse(
    execFileSync("npx", [
      "wrangler",
      "d1",
      "execute",
      D1,
      "--remote",
      "--json",
      "--command",
      `select location_code, language_code from projects where id = ${sql(projectId)}`,
    ]),
  )[0].results;
  if (!project) throw new Error(`No project ${projectId}`);

  // keyword|location|language -> best row; Labs rows (with KD) beat Ads rows, newer beats older.
  const best = new Map();
  for (const path of walk(dir)) {
    let data;
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      console.warn(`skip (not JSON): ${path}`);
      continue;
    }
    const date = fileDate(path);
    const rel = relative(dirname(dir), path);
    const task = data?.tasks?.[0];
    if (task?.path) {
      const endpoint = `/${task.path.join("/")}`;
      const archived = JSON.stringify({
        method: "POST",
        path: endpoint,
        archivedAt: `${date}T00:00:00.000Z`,
        importedFrom: rel,
        request: data.tasks.map((t) => t.data),
        response: data,
      });
      uploads.push({
        key: `raw${endpoint}/${date}/${date}T00:00:00.000Z-import-${basename(path)}`,
        body: archived,
      });
    } else {
      uploads.push({
        key: `imported/${rel}`,
        body: readFileSync(path, "utf8"),
      });
    }

    const found = keywordRows(data, path);
    if (!found) continue;
    const locationCode = found.locationCode ?? project.location_code;
    const languageCode = found.languageCode ?? project.language_code;
    for (const row of found.rows) {
      const keyword = row.keyword?.trim().toLowerCase();
      // No-volume rows (DataForSEO had no data) stay in R2 only.
      if (!keyword || row.searchVolume == null) continue;
      const key = `${keyword}|${locationCode}|${languageCode}`;
      const current = best.get(key);
      const score = (r) =>
        `${r.row.keywordDifficulty != null ? 1 : 0}${r.date}`;
      const candidate = {
        row: { ...row, keyword },
        date,
        locationCode,
        languageCode,
        tag: found.tag,
      };
      if (!current || score(candidate) > score(current))
        best.set(key, candidate);
    }
  }

  const tags = new Set();
  for (const { row, date, locationCode, languageCode, tag } of best.values()) {
    tags.add(tag);
    const where = `project_id = ${sql(projectId)} and keyword = ${sql(row.keyword)} and location_code = ${locationCode} and language_code = ${sql(languageCode)}`;
    statements.push(
      `insert into saved_keywords (id, project_id, keyword, location_code, language_code) values (${sql(crypto.randomUUID())}, ${sql(projectId)}, ${sql(row.keyword)}, ${locationCode}, ${sql(languageCode)}) on conflict do nothing;`,
      `insert into keyword_metrics (project_id, keyword, location_code, language_code, search_volume, cpc, competition, keyword_difficulty, intent, monthly_searches, fetched_at) values (${sql(projectId)}, ${sql(row.keyword)}, ${locationCode}, ${sql(languageCode)}, ${sql(row.searchVolume)}, ${sql(row.cpc)}, ${sql(row.competition)}, ${sql(row.keywordDifficulty)}, ${sql(row.intent)}, ${sql(JSON.stringify(row.trend))}, ${sql(`${date}T00:00:00.000Z`)}) on conflict do nothing;`,
      `insert into saved_keyword_tag_assignments (saved_keyword_id, tag_id) select s.id, t.id from saved_keywords s, saved_keyword_tags t where s.${where} and t.project_id = ${sql(projectId)} and t.normalized_name = ${sql(`import: ${tag}`.toLowerCase())} on conflict do nothing;`,
    );
  }
  // Tags must exist before the assignments that select them.
  statements.unshift(
    ...[...tags].map(
      (tag) =>
        `insert into saved_keyword_tags (id, project_id, name, normalized_name) values (${sql(crypto.randomUUID())}, ${sql(projectId)}, ${sql(`import: ${tag}`)}, ${sql(`import: ${tag}`.toLowerCase())}) on conflict do nothing;`,
    ),
  );
  console.log(
    `${dir}: ${best.size} keywords, ${tags.size} tags: ${[...tags].join(", ")}`,
  );
}
console.log(
  `${uploads.length} files to R2 (${uploads.filter((u) => u.key.startsWith("raw/")).length} into raw/)`,
);

const sqlFile = join(tmpdir(), "import-raw-responses.sql");
writeFileSync(sqlFile, statements.join("\n"));
console.log(`SQL written to ${sqlFile}`);
if (!apply) process.exit(0);

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", D1, "--remote", "--file", sqlFile, "--yes"],
  { stdio: "inherit" },
);
// Each wrangler put costs a few seconds of CLI startup, so run several at once.
const run = promisify(execFile);
let next = 0;
let finished = 0;
const failed = [];
await Promise.all(
  Array.from({ length: 8 }, async (_, worker) => {
    const file = join(tmpdir(), `import-raw-object-${worker}.json`);
    while (next < uploads.length) {
      const { key, body } = uploads[next++];
      writeFileSync(file, body);
      // wrangler puts fail transiently now and then; re-running the import is safe.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await run(
            "npx",
            [
              "wrangler",
              "r2",
              "object",
              "put",
              `${R2}/${key}`,
              "--file",
              file,
              "--content-type",
              "application/json",
              "--remote",
            ],
            { timeout: 60_000 },
          );
          break;
        } catch (error) {
          if (attempt === 3)
            failed.push(
              `${key}: ${String(error.stderr || error.message)
                .trim()
                .split("\n")
                .at(-1)}`,
            );
        }
      }
      if (++finished % 50 === 0)
        console.log(`R2 ${finished}/${uploads.length}`);
    }
  }),
);
if (failed.length) {
  console.error(`${failed.length} uploads failed:\n${failed.join("\n")}`);
  process.exit(1);
}
console.log("done");
