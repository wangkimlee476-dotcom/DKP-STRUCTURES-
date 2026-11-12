# Cloudflare Workers deployment — DKP STRUCTURES

This is the dedicated rebuild branch. The original branch is left untouched.

## Cloudflare project settings

- GitHub repository: `wangkimlee476-dotcom/DKP-STRUCTURES-`
- Production branch: `rebuild/professional-functional`
- Root directory: `/`
- Build command: leave blank unless Cloudflare requires dependency installation
- Deploy command: `npx wrangler deploy`
- Worker entrypoint: `worker.mjs` (configured in `wrangler.jsonc`)

**Do not use `npx wrangler preview` as the deploy command.** It is a preview-era command and was the cause of the November 10 deployment failure. For local development use `bun run preview` (which runs `wrangler dev`). For production use `bun run deploy` or `npx wrangler deploy`.

## Cloudflare bindings and secrets

The repository's `wrangler.jsonc` currently declares the Hyperdrive binding `HYPERDRIVE` and its preview binding, using the configured ID `455fb135411f45ed814b43b0f74ce930`. This is a real configured ID in source, not a placeholder. Before production, confirm in the Cloudflare account that this ID exists in the correct account and points to the intended Neon production database. Do not replace it with a guessed ID.

The Worker requires these runtime values:

- `HYPERDRIVE.connectionString`: supplied by the configured Cloudflare Hyperdrive binding.
- `SESSION_SECRET`: a newly generated random secret of at least 32 characters, added as a Worker secret. Never commit it or paste it into chat.
- `SUPPORT_EMAIL`: currently set to `dkpstructures@gmail.com`.
- `SMARTSUPP_KEY`: the public website widget key, currently present in `wrangler.jsonc`. Confirm it is the correct key for the production Smartsupp account and allowed domain.
- If transactional email is implemented, configure `RESEND_API_KEY` and `EMAIL_FROM` as Worker secrets/variables according to the email provider's requirements.

Do not add a raw `DATABASE_URL` to the Worker. The Worker reads the connection string through Hyperdrive.

## Database readiness

The Cloudflare Worker intentionally checks for an already-provisioned PostgreSQL schema; it does not run schema-creation migrations on each production request. Before first deployment, apply and review the schema/migrations through a controlled database migration process. Confirm these tables exist:

- `users`
- `contributions`
- `support_requests`
- `audit_logs`
- `user_sessions`
- `password_reset_tokens`

Also confirm the required user columns and the unique partial index `idx_contributions_active_reference` exist. The health endpoint reports schema readiness only after these checks succeed.

Use a dedicated least-privilege application database role. Verify the Hyperdrive connection uses the intended Neon branch/database, and confirm backups plus a tested restore procedure before accepting supporter data.

## Verify after deployment

Run the automated checks before deployment:

```bash
bun install
bun run check
bun run deploy:check
```

Then deploy with:

```bash
bun run deploy
```

After deployment, verify:

1. `/api/health` returns `ok: true`, `database: "PostgreSQL"`, and `schema: "ready"`.
2. The home page, `/dashboard.html`, `/admin.html`, `/forgot-password.html` and `/reset-password.html` load.
3. A test supporter can register, log in, log out, update settings and submit a support request.
4. An authorized admin can review a pending contribution, verify it once, reject another, and see both actions in the audit log.
5. A pending or rejected contribution never increases the verified total.
6. Session persistence works across separate requests and sessions expire as configured.
7. Smartsupp opens on supported mobile and desktop browsers; email/support-form fallbacks remain available.

Use test accounts and test transactions only. Do not create test payment records that could be mistaken for real cleared funds.

## Product and launch safeguards

- The platform records voluntary contributions; it does not process card/bank payments.
- Admins must independently confirm cleared funds in the actual receiving account before verifying a contribution.
- Recognition levels are not investments, shares, ownership, loans, deposits, or promised benefits.
- Existing data in another database or the old SQLite deployment is not automatically imported. Plan and verify any required migration before switching users.
- This deployment adaptation is not a production security certification. Complete the security, legal, email-delivery, privacy, payment-provider and backup reviews in `DEPLOYMENT_CHECKLIST.md` before inviting real supporters.
