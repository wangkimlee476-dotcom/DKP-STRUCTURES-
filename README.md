# DKP STRUCTURES — supporter and fundraising platform

Node.js + Express application with a Cloudflare Workers adapter and PostgreSQL-backed supporter accounts, contribution records, support requests, audit history and login sessions.

## Features in the current code
- Public company-development website and campaign information.
- Supporter registration, login, logout and dashboard.
- Unique supporter referral codes, shareable invitation links, referral registration attribution and admin referral reporting; referrals are attribution only and carry no commissions or rewards.
- Personal targets and recognition levels based on independently verified contributions.
- Supporter profile/settings and contribution submission for manual review.
- Customer-support request submission and admin review.
- Admin board at `/admin.html` for pending contribution records, one-time verification/rejection and audit logs.
- Smartsupp widget integration and email/support-form fallbacks.
- PostgreSQL stores application data and login sessions.

## Important product and safety notes
- The application does not process payments. The dashboard total is a record of verified contributions, not a wallet, deposit, investment or withdrawable balance.
- Contributions are voluntary. Recognition levels do not create shares, ownership, loans, deposits, guaranteed returns or other promised benefits.
- Do not accept real contributions or sensitive personal information until legal review, email verification, secure password recovery, CSRF/security review, backups and restore testing are complete.
- Public registration creates supporter accounts only; it cannot grant administrator privileges.
- Current password recovery is not automatic email delivery: a request is recorded for the support team, and an administrator can generate a one-time reset link for delivery to the verified account email. Do not describe this as fully automated until a verified email provider workflow is implemented and tested.
- Support requests are stored in the admin board; automatic email notifications are not currently implemented.
- The Cloudflare Worker checks for a pre-provisioned PostgreSQL schema and required indexes at startup. It does not create or migrate the production schema on live requests.
- The non-Worker Node runtime can create/update its PostgreSQL schema on startup. Do not confuse that local/server behavior with Cloudflare production behavior.
- This code does not copy records from an existing SQLite database or another deployment. If real records exist, export, reconcile, back up and verify them before switching production. Do not delete the old database until the import is independently checked.

## Cloudflare Workers deployment (rebuild branch)
Use branch `rebuild/professional-functional`.

- Root directory: `/`
- Build command: leave blank unless Cloudflare requires dependency installation.
- Deploy command: `npx wrangler deploy`
- Do not use `npx wrangler preview` as the production deploy command.
- Worker entrypoint: `worker.mjs` from `wrangler.jsonc`.
- Configure the existing Hyperdrive binding to the intended Neon production database.
- Add `SESSION_SECRET` as a Cloudflare Worker secret (random, at least 32 characters); never commit it or paste it into chat.
- Ensure the production PostgreSQL schema, tables, columns and indexes described in `CLOUDFLARE_DEPLOY.md` have been applied before deployment.

Read `CLOUDFLARE_DEPLOY.md` and `DEPLOYMENT_CHECKLIST.md` before any production launch.

## Local setup
1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to your PostgreSQL connection string.
4. Set a random `SESSION_SECRET` of at least 32 characters.
5. Run `npm install`, then `npm start`.
6. Open `http://localhost:3000`. The health endpoint is `/api/health`.

## Create the first administrator safely
1. Register your owner account through the website.
2. From a private server shell with `DATABASE_URL` configured, run:
   `npm run admin:promote -- owner@example.com`
3. Use the exact email address of the account you own. This script changes only that existing account's role. Never add a public admin-registration route or expose database credentials.

## Automated checks
- `bun run check` runs server/Worker syntax checks, inline browser JavaScript checks, platform contract checks and request-scoped Worker database tests.
- `bun run deploy:check` runs Wrangler's production deployment dry-run.
- GitHub Actions runs these checks on pushes to `rebuild/professional-functional`.
- A passing automated build is not proof that the live Neon database, Cloudflare secrets, email delivery, Smartsupp, admin permissions or payment-verification workflow are correctly configured. Those require integration and end-to-end tests.

## Remaining launch requirements
See `DEPLOYMENT_CHECKLIST.md` for the full release gate. Key items include:
- Verify owner/admin provisioning and attempt unauthorized admin access with a supporter account.
- Implement and test verified-email ownership and one-time password reset email delivery.
- Complete CSRF, session and independent security review.
- Configure support-request notifications and staffed Smartsupp support.
- Confirm Neon schema, least-privilege DB role, backups and tested restore.
- Complete privacy, terms and fundraising/legal review for the actual recipient and jurisdictions.
- Run end-to-end tests on Android and desktop.
- Confirm payment records against cleared funds in the receiving provider; never trust screenshots alone.
