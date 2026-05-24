# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A TypeScript monorepo of scheduled AI agents. Each agent is a standalone Node entrypoint that runs to completion on a Render Cron Job — there is no long-running server, no queue worker, no shared runtime loop.

## Stack constraints (load-bearing)

- **TypeScript, strict mode.** No `any` escapes; fix the type, don't widen it.
- **pnpm** for package management. Do not introduce npm or yarn lockfiles.
- **Node 20+.** Use built-in `fetch`, `node:` prefixed imports, native ESM.
- **Raw `@anthropic-ai/sdk`.** No LangChain, no CrewAI, no LlamaIndex, no agent frameworks of any kind. If a task seems to call for one, model it directly with the SDK's tool-use loop instead.
- **Render Cron Jobs** for hosting. Agents run directly via `./node_modules/.bin/tsx agents/<name>/index.ts` — no compile step, no `dist/`. Each invocation must exit cleanly; no daemons. `tsx` must be in `dependencies` (not `devDependencies`) because Render prunes devDeps after install.

## Layout

```
agents/<name>/   one directory per agent; entrypoint runs to completion on a Render Cron Job
  hello-world/   placeholder verifying infra end-to-end; delete once first real agent ships
services/<name>/ always-on Render Web Services (not crons); long-running process, not one-shot
lib/             shared code: env, claude, slack, logger (real); linear, notion, umami (stubs)
tools/           reusable Anthropic tool definitions (currently empty)
```

All Render services and cron jobs are declared in `render.yaml`. Changes deploy automatically on push to main.

When adding a new agent: create `agents/<name>/index.ts`, compose tools from `tools/`, share infrastructure via `lib/`. Do not duplicate a tool definition into an agent — promote it to `tools/` and import. The `README.md` has the full add-an-agent checklist (script entry, render.yaml service block).

When adding a new service: create `services/<name>/index.ts` and add a `type: web` entry to `render.yaml`. Services run via `./node_modules/.bin/tsx services/<name>/index.ts` — use `./node_modules/.bin/tsx` directly (not `pnpm tsx`) because Render prunes `devDependencies` in production; `tsx` must stay in `dependencies`.

When adding a new tool: define the JSON schema and the handler together in `tools/<tool-name>.ts`, exported as a pair the agent loop can register.

## Commands

- `pnpm install` — install dependencies
- `pnpm dev:hello` — run the hello-world agent locally (one-shot, exits on completion)
- `pnpm build` / `pnpm typecheck` — both run `tsc --noEmit`; there is no compile output
- Run any agent locally: `pnpm tsx agents/<name>/index.ts`

No test runner is wired up yet. Add one when the first agent needs coverage.

## Conventions

- **One agent per cron entry.** Resist bundling multiple jobs into one process.
- **All env access goes through `lib/env.ts`** (`loadEnv()` — zod-validated, cached). Never read `process.env` directly outside that module. To add a var: extend the schema, update `.env.example`, and add to the Render env group.
- **Default Claude model** is the `DEFAULT_MODEL` constant in `lib/claude.ts`. Bump there once to upgrade every agent.
- **Anthropic SDK retries are built in** (`maxRetries: 3` on the client). Don't wrap calls in a custom retry loop.
- **Tool handlers are pure where possible** — take inputs, return outputs, push side effects (network, disk) behind `lib/` clients so they can be swapped in tests.
- **Errors must post to `#agent-errors`.** Wrap each agent's `main()` in `.catch()` that calls `logger.error(agentName, err)` and exits 1. The logger redacts `KEY|TOKEN|WEBHOOK|PASSWORD` patterns and truncates stacks to 2000 chars.
- **Slack channel routing** is centralized in `lib/slack.ts` `postToChannel(channel, text, blocks?)`. Add a channel by extending the `Channel` union and `webhookFor` switch.
- **Slack auth is split by use case.** Agents post via incoming webhooks (`lib/slack.ts`, `SLACK_WEBHOOK_*` env vars). The webhook receiver service uses `SLACK_BOT_TOKEN` for Slack Web API calls (reading channel history, fetching thread parents) — a different auth mechanism. Both credentials live in the `avidx-agents-shared` env group.
