# Cloudflare Workers deployment — DKP STRUCTURES

This branch adapts the existing Express + PostgreSQL application for Cloudflare Workers. It does not change the main branch.

## Cloudflare project settings

- GitHub repository: `wangkimlee476-dotcom/DKP-STRUCTURES-`
- Branch: `feature/cloudflare-workers`
- Root directory: `/`
- Build command: leave blank (or `npm install` if the dashboard requires one)
- Deploy command: `npx wrangler deploy`
- Worker entrypoint: `worker.mjs` (configured in `wrangler.jsonc`)

Do not deploy until the Hyperdrive ID and secrets below are configured.

## 1. Create a Hyperdrive configuration for Neon

In Cloudflare, open **Storage & databases → Hyperdrive → Create configuration**.

In Neon, open the **DKP STRUCTURES** project and select the production branch and `dkp_structures` database. Use a direct, non-pooled PostgreSQL connection string for Hyperdrive (disable the Neon's connection-pooling option when copying it). Keep the connection string private; do not paste it into GitHub or a chat.

Use the existing database role only if you understand that the app's first startup creates tables. For a production launch, prefer a dedicated least-privilege application role after schema creation and grants have been reviewed.

After Cloudflare creates the Hyperdrive configuration, copy its ID. Replace the placeholder `REPLACE_WITH_CLOUDFLARE_HYPERDRIVE_ID` in `wrangler.jsonc` with that ID and commit the change to this branch.

## 2. Add secrets in Cloudflare

In the Worker settings, add these as **Secrets**, not plain text variables:

- `SESSION_SECRET`: a newly generated random secret of at least 32 characters. Do not reuse a secret from another host.
- Do not add `DATABASE_URL`; the Worker receives the database connection through the Hyperdrive binding.

Optional plain-text variables are already defined in `wrangler.jsonc`:

- `SUPPORT_EMAIL`
- `TERMS_VERSION`
- `NODE_ENV`

Optional secret:

- `SMARTSUPP_KEY`, only if a real Smartsupp website key has been created.

## 3. Verify after deployment

- Open `/api/health`; it should return JSON with `ok: true` and `database: "PostgreSQL"`.
- Open the home page and `/admin.html`; verify static assets load.
- Test supporter registration, login, logout and dashboard using a test account.
- Do not enter real supporter or contribution records until security review, email verification, password recovery, backups/restore and legal review are complete.

## Important

- The application does not process payments. Contributions are manually recorded and independently verified.
- Existing SQLite records, if any, are not imported by this code branch.
- This is a deployment adaptation, not a production security certification.
- Keep the existing PostgreSQL migration pull request separate; review and merge it before merging this Cloudflare branch into the main release line.
