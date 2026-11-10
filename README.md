# DKP STRUCTURES — Full-stack platform (PostgreSQL migration)

Node.js + Express application with PostgreSQL-backed supporter accounts, contributions, support requests, audit history and login sessions.

## Features
- Public company-development website and campaign information.
- Supporter registration, login, logout and dashboard.
- Personal targets and recognition levels based on independently verified contributions.
- Customer-support request submission and admin review.
- Admin board at `/admin.html` for pending contribution records, one-time verification/rejection and audit logs.
- Smartsupp integration through `SMARTSUPP_KEY`.
- PostgreSQL stores application data; PostgreSQL also stores login sessions in `user_sessions`.

## Important safety and migration notes
- The application does not process payments. The dashboard total is a record of verified contributions, not a wallet, deposit, investment or withdrawable balance.
- Do not accept real contributions or sensitive personal information until legal review, payment-provider approval, email verification, password recovery, CSRF/security review, backups and restore testing are complete.
- The app creates its PostgreSQL tables automatically on startup. Use a private managed PostgreSQL database and keep `DATABASE_URL` secret.
- This code migration does not copy records from an existing SQLite database. If any real SQLite records exist, export and reconcile them before switching the production service. Do not delete the old database until the import has been checked and backed up.
- Public registration always creates a supporter. It cannot grant administrator privileges.
- A free web host may sleep or restart; the database must be external and persistent. Do not use an expiring trial database for long-term supporter records.

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

## Render deployment
Create a Node web service from this repository:
- Build command: `npm install`
- Start command: `npm start`
- Runtime: Node 20+
- Set `NODE_ENV=production`
- Set `DATABASE_URL` to a managed PostgreSQL connection string.
- Set `SESSION_SECRET` to a unique random value of at least 32 characters.
- Optional: `SUPPORT_EMAIL=dkpstructures@gmail.com`, `SMARTSUPP_KEY` and `PGSSL=true` if required by your database provider.

Do not use a local SQLite file or depend on the Render web service filesystem for durable records. If using a Render-managed free PostgreSQL instance, check its current expiry/retention terms before putting any records there. An external managed PostgreSQL provider can be connected by storing its connection string in Render's secret environment variables.

## Checks
- `npm run check` validates server and inline browser JavaScript syntax.
- `npm run admin:promote -- email@example.com` privately promotes an existing account to administrator.
- `/api/health` checks the API and PostgreSQL connection.

## Remaining launch requirements
- Email verification and password recovery.
- Full CSRF, session and security review.
- Support-request email notifications.
- Automated database backups and tested restore.
- Privacy notice, accurate terms and fundraising/legal review for the actual recipient and jurisdictions.
- Independent end-to-end testing on Android and desktop.
- Confirm payment records against cleared funds in the receiving provider; never trust screenshots alone.
