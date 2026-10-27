# OpenSEO

> Open source alternative to Semrush and Ahrefs

OpenSEO is an SEO tool for _the people_. If tools like Semrush or Ahrefs are too expensive or bloated, OpenSEO is a pay-as-you-go alternative that you actually control.

> All-in-one SEO tool for you and your AI agent.

Connect with any agent like Claude Code, OpenClaw or Hermes. We have pre-built skills, but you can build your own to tailor OpenSEO to your needs.

<img width="100%" alt="openseo-keyword-research" src="https://github.com/user-attachments/assets/8ebdc439-3e72-41ab-8bde-8cda771ef2e8" />

## About this fork

This is a fork of [every-app/open-seo](https://github.com/every-app/open-seo) with two additions:

- **Raw DataForSEO archive.** Every DataForSEO request and its full, untrimmed response is saved to the deployment's R2 bucket under `raw/<endpoint>/<YYYY-MM-DD>/<timestamp>-<id>.json`. The app keeps only the fields its UI needs (a rank check stores your own position but drops the rest of the SERP you paid for), so the archive keeps everything for later analysis, such as competitor rank history. Archiving is best-effort and never fails a call. See `src/server/lib/dataforseo/raw-archive.ts`.
- **`deploy/enable-managed-oauth.mjs`.** Turns on Cloudflare Access Managed OAuth through the API, which MCP clients need to sign in. Some accounts don't show the toggle in the Zero Trust dashboard.

The fork changes no database schema, so merging upstream stays simple.

### Deploy to a Cloudflare account

You need Node 22.6+, a Cloudflare account with R2 enabled, and a [DataForSEO](https://dataforseo.com) API key.

1. Clone and install:

   ```bash
   git clone https://github.com/martyntaylor/open-seo.git && cd open-seo
   corepack enable && pnpm install
   ```

2. Log in to Cloudflare. Answer yes to "Customize OAuth scopes?" and tick `access:write` alongside the defaults:

   ```bash
   pnpm alchemy login deploy/alchemy/alchemy.run.ts --env-file .env.selfhost --configure
   pnpm alchemy cloudflare bootstrap
   ```

3. In the Cloudflare dashboard, open **Zero Trust** once so Access is enabled on the account. The deploy fails with "Access is not enabled" otherwise.

4. Create `.env.selfhost` and fill in `DATAFORSEO_API_KEY` (the Base64 credential), `ACCESS_ALLOWED_EMAILS`, and `OPENSEO_TELEMETRY_DISABLED=1`:

   ```bash
   cp deploy/.env.selfhost.example .env.selfhost
   ```

5. Deploy, then enable Managed OAuth:

   ```bash
   pnpm deploy:selfhost --yes
   node deploy/enable-managed-oauth.mjs
   ```

   Client registration can take a few minutes to appear. `/mcp` should return `401`, not `302`.

### Connect Claude Code

```bash
claude mcp add --transport http --scope user openseo https://<your-worker-url>/mcp
npx skills add every-app/open-seo -g -y --agent claude-code --skill ai-prompt-research ai-visibility-audit competitive-landscape competitor-analysis keyword-clustering keyword-research link-prospecting local-seo seo-audit seo-coach seo-project-setup seo-report
```

Restart Claude Code (`claude --continue`), run `/mcp`, choose **openseo → Authenticate**, and approve the Access sign-in.

### Read the raw archive

```bash
pnpm exec wrangler r2 object get "open-seo-r2-selfhost/raw/v3/serp/google/organic/live/advanced/<date>/<file>.json" --remote --file out.json
pnpm exec wrangler d1 execute open-seo-db-selfhost --remote --command "SELECT * FROM rank_snapshots LIMIT 10"
```

Wrangler can't list R2 objects. Use the dashboard or the R2 API (`GET /accounts/<id>/r2/buckets/<bucket>/objects?prefix=raw/`) to find keys.

### Update from upstream

```bash
git remote add upstream https://github.com/every-app/open-seo.git   # once per clone
git fetch upstream && git merge upstream/main
pnpm install && pnpm deploy:selfhost --yes
```

Afterwards, check `/mcp` still returns `401`. If it returns `302`, run `node deploy/enable-managed-oauth.mjs` again.

## Hosted Version

Try OpenSEO for free on our website. If you want to support the project, a hosted subscription is $10/month.

[openseo.so](https://openseo.so)

### EveryApp

Host OpenSEO and other open source apps on our platform EveryApp.

[Self-host on EveryApp and give it a star →](https://github.com/every-app/every-app)

## Why use OpenSEO?

- Best in class MCP and AI Skills.
- Modern, simple UI.
  - Focused workflows instead of a bloated, complex SEO suite.
- No subscriptions.
  - Bring your own DataForSEO API key and pay only for what you use.
- Fork and vibe code your own custom tool.

## Main SEO Workflows

- Keyword research
- Rank tracking
- Competitor Insights
- Backlinks
- Site Audits
- AI Visibility

## OpenSEO MCP & Agent Skills

OpenSEO exposes an MCP server so AI agents like Claude Code, OpenClaw, and Hermes can use your SEO data directly. Agent Skills are reusable workflows that guide your agent through SEO tasks using the MCP.

- [Set up ChatGPT web or desktop](https://openseo.so/docs/chatgpt) (works on Free and paid ChatGPT plans)
- [Set up Codex](https://openseo.so/docs/codex-plugin)
- [Set up OpenSEO MCP](https://openseo.so/docs/mcp)
- [Set up OpenSEO Agent Skills](https://openseo.so/docs/skills/setup)

## Self-Hosting

OpenSEO supports two self-hosting paths. Both use email and password accounts: the first visitor creates the admin account, teammates join from invitation links, and MCP clients (Claude, ChatGPT, Codex, Cursor) sign in with the same accounts.

- **Docker** - On your own server or computer, with a prebuilt image that is ready in seconds. Works with Compose-based platforms such as Coolify, Portainer and Dokploy. See [`docs/SELF_HOSTING_DOCKER.md`](./docs/SELF_HOSTING_DOCKER.md).
  - Running the older single-container image? It keeps getting updates; [move to the new setup](./docs/SELF_HOSTING_DOCKER.md#move-from-the-old-docker-image) when you are ready, data included.
- **Cloudflare** - No server to run: one deploy command puts OpenSEO on your own Cloudflare account (works on the free plan). See [`docs/SELF_HOSTING_CLOUDFLARE.md`](./docs/SELF_HOSTING_CLOUDFLARE.md).

For security-conscious setups, two advanced options replace the accounts with your own network controls:

- **Cloudflare Access** in front of the Cloudflare deploy, so Cloudflare checks every request before it reaches OpenSEO. See [`docs/SELF_HOSTING_CLOUDFLARE.md`](./docs/SELF_HOSTING_CLOUDFLARE.md).
- **No sign-in on Docker**, behind Tailscale, a private network or your own authenticating proxy. See [Without sign-in](./docs/SELF_HOSTING_DOCKER.md#without-sign-in-advanced).

Either way, you need a DataForSEO API key to get SEO data. See [`docs/DATAFORSEO_API_KEY.md`](./docs/DATAFORSEO_API_KEY.md).

## Costs

OpenSEO needs a [DataForSEO](https://dataforseo.com/?aff=255379) API key so that you can get SEO data. You pay them directly when self hosting.

See [openseo.so/pricing](https://openseo.so/pricing)

When you self host, your costs will be slightly lower than the estimates on our website. The way the hosted service makes money is by charging 28% extra for every request we make to DataForSEO.

## Local Development

See [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md).

## Contributing

Creating clear issues is the best way to contribute.

Read more here: [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)

We have this skill: `/simple-issue-description` which helps.

```sh
npx skills add every-app/open-seo --skill simple-issue-description
```

## Community

Join Discord to chat: [Discord](https://discord.gg/c9uGs3cFXr)

Follow along for updates:

- Follow on X: https://x.com/bensenescu
- Sign up for the mailing list on our website: [openseo.so](https://openseo.so)
