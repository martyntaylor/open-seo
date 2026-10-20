// Fork addition: turn on Cloudflare Access Managed OAuth for the self-host app
// so MCP clients (Claude Code etc.) can sign in. Some accounts don't show the
// toggle in the Zero Trust dashboard; this sets it through the API instead.
// Run after `pnpm deploy:selfhost`, and again if /mcp ever returns 302 not 401.
//   node deploy/enable-managed-oauth.mjs
// Uses the alchemy Cloudflare login (needs access:write); honours ALCHEMY_PROFILE.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const profile = process.env.ALCHEMY_PROFILE || "default";
const token = JSON.parse(
  readFileSync(
    `${homedir()}/.alchemy/credentials/${profile}/cf-oauth.json`,
    "utf8",
  ),
).access;
const account = JSON.parse(
  readFileSync(`${homedir()}/.alchemy/profiles.json`, "utf8"),
).profiles[profile].Cloudflare.accountId;
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/access/apps`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const list = await (await fetch(api, { headers })).json();
if (!list.success)
  throw new Error(`Listing Access apps failed: ${JSON.stringify(list.errors)}`);
const apps = list.result.filter((a) =>
  /open-seo/i.test(`${a.name} ${a.domain}`),
);
if (apps.length !== 1) {
  throw new Error(
    `Expected one OpenSEO Access app, found ${apps.length}: ${apps.map((a) => a.name).join(", ")}`,
  );
}

const url = `${api}/${apps[0].id}`;
const get = await (await fetch(url, { headers })).json();
if (!get.success) throw new Error(`GET failed: ${JSON.stringify(get.errors)}`);
const app = get.result;
const backup = `access-app-backup-${Date.now()}.json`;
writeFileSync(backup, JSON.stringify(app, null, 1));
console.log(`Backed up "${app.name}" config to ${backup}`);

// PUT replaces the app, so send back every existing field plus the OAuth setting.
const { id, uid, aud, created_at, updated_at, ...body } = app;
body.policies = (app.policies ?? []).map((p) => ({
  id: p.id,
  precedence: p.precedence,
}));
body.oauth_configuration = {
  enabled: true,
  dynamic_client_registration: {
    enabled: true,
    allow_any_on_localhost: true,
    allow_any_on_loopback: true,
  },
};

const put = await (
  await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) })
).json();
if (!put.success) throw new Error(`PUT failed: ${JSON.stringify(put.errors)}`);
console.log("Managed OAuth:", JSON.stringify(put.result.oauth_configuration));
console.log(
  "Policies kept:",
  put.result.policies?.length ?? 0,
  "| domain:",
  put.result.domain,
);
console.log(
  "Client registration can take a few minutes to appear before MCP sign-in works.",
);
