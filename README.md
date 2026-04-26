# avidx-agents

Scheduled AI agents for AvidX. Each agent is a TypeScript script that runs on a Render Cron Job, calls the Anthropic API, and posts somewhere (Slack, Notion, etc.).

See [CLAUDE.md](./CLAUDE.md) for architectural constraints when working in this repo.

## Local dev

1. `pnpm install`
2. Copy `.env.example` to `.env` and fill in values
3. Run an agent: `pnpm dev:hello`

The same `pnpm tsx agents/<name>/index.ts` command runs locally and on Render — no build step.

## Adding a new agent

1. Create `agents/<name>/index.ts`. Call `loadEnv()` first; wrap the body in a `main().catch()` that calls `logger.error('<name>', err)` then `process.exit(1)`. See [agents/hello-world/index.ts](./agents/hello-world/index.ts).
2. Add a script to `package.json`: `"dev:<name>": "tsx agents/<name>/index.ts"`.
3. Add a service block to `render.yaml`:
   ```yaml
   - type: cron
     name: <name>-agent
     env: node
     region: oregon
     schedule: "0 12 * * *"   # UTC
     buildCommand: pnpm install && pnpm build
     startCommand: pnpm tsx agents/<name>/index.ts
     envVars:
       - fromGroup: avidx-agents-shared
   ```
4. Push. Render syncs the blueprint and provisions the new service.

## Adding a new env var

1. Add the field to the zod schema in [lib/env.ts](./lib/env.ts).
2. Add a placeholder line to [.env.example](./.env.example).
3. Add the value to your local `.env`.
4. Add the value to the `avidx-agents-shared` env group on Render.
5. **Redeploy each affected service** — env group changes do not propagate automatically.

## Render deployment

- Repo is wired to Render as a Blueprint pointing at [render.yaml](./render.yaml).
- Shared secrets live in the `avidx-agents-shared` env group (created manually in Render).
- Trigger a job manually from the Render dashboard ("Run job now") to test without waiting for the cron.
- Per-job logs are visible in the Render dashboard. Errors also post to Slack `#agent-errors`.

## Troubleshooting

- **Agent posted nothing and didn't error in logs** — check `#agent-errors`; the catch handler always posts there before exiting.
- **`Invalid environment variables` on startup** — the missing var is named in the error. Set it in `.env` (local) or the env group (Render).
- **Slack webhook returns 404** — webhook was deleted/regenerated; create a new one in the Slack app settings and update the env var.
