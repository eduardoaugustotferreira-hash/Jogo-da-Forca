---
name: cloudflare-deploy
description: "Use when planning, configuring, validating, or deploying Cloudflare Pages, Workers, Durable Objects, D1, Wrangler, migrations, environments, GitHub Actions, rollback, or production approvals."
---

# Cloudflare deployment workflow

## When to use

Use for Cloudflare architecture, Wrangler configuration, local/preview/production environments, D1 migrations, Durable Object bindings, GitHub Actions, release checks, rollback, costs, or deployment planning.

## Procedure

1. **Inspect first.** Read current Wrangler files, package/configuration files, workflows, migrations, and Git status. Preserve unrelated work and do not replace existing settings without comparing them.
2. **Verify current requirements.** Consult the official documentation for [Pages](https://developers.cloudflare.com/pages/), [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/), and [pricing](https://developers.cloudflare.com/workers/platform/pricing/). Confirm current compatibility, limits, plan requirements, and migration behavior before proposing resources.
3. **Separate environments.** Define distinct local, preview, and production bindings/identifiers. Keep non-secret values in environment configuration and secrets in protected secret stores. Never print secret values.
4. **Plan schemas and state.** Make D1 migrations forward-only and reviewable. Treat Durable Object class/storage changes as compatibility-sensitive. Explain data backup, deployment order, and rollback limits before execution.
5. **Validate locally.** Use existing commands first. Validate configuration and migrations against local/test resources. Do not authenticate to, create, or mutate remote resources unless the user authorized that exact operation.
6. **Protect CI.** Run checks and tests before preview deployment. Require protected environment approval and an independent human reviewer for production. The agent preparing a release cannot approve its own production deployment.
7. **Prepare rollback.** Identify the last known-good application version, migration reversibility, forward-fix strategy, data backup/restore procedure, and triggers to halt rollout. Do not imply that code rollback automatically reverses D1 or Durable Object state.
8. **Deploy only by explicit authorization.** Before deploying, state target environment, commit, commands, expected changes/costs, migration effects, rollback plan, and approval boundary. Stop if authorization is ambiguous.

## Quality checks

- No secrets or tokens in tracked files, generated config, command output, workflow logs, or documentation examples.
- Resource IDs and bindings are environment-specific; production is not an implicit default.
- Migrations are ordered, reviewed, and tested against a disposable/local database.
- Workflow permissions are least-privilege; production requires a protected environment and human approval.
- Deployment status and rollback limitations are reported from actual command results.
