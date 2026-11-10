# DKP STRUCTURES — Full platform starter (v4)

This is the full Node.js + Express platform, not the static Netlify page.

## Included
- Public DKP Structures website and campaign information.
- Supporter registration and login.
- Server-backed supporter dashboard and personal target.
- Supporter recognition levels based on verified contribution totals.
- Support request form saved to the application database.
- Deposit/payment-options buttons that direct visitors to the customer-support request form.
- Admin board at `/admin.html`.
- Admin workflow to create pending contribution records, verify cleared payments manually, credit verified contribution totals once, reject records, and inspect audit logs.
- Smartsupp website chat integration configured through `SMARTSUPP_KEY`.
- Direct email support links to **dkpstructures@gmail.com**; if Smartsupp is not connected, the chat button opens an email draft instead.

## Important: this is a full-stack starter, not a production-certified financial platform
Do not accept real contributions or sensitive personal information until legal review, payment-provider approval, security hardening, email verification, password recovery, controlled admin provisioning, persistent production database, backups and restore tests are complete.

The dashboard displays a **verified contribution total**, not a cash wallet, bank deposit, withdrawable balance, savings account or investment account. The website does not process payments. Supporters must contact customer service first for available payment methods.

## Run locally
Requirements: Node.js 20+.

1. Copy `.env.example` to `.env`.
2. Set a unique random `SESSION_SECRET` of at least 32 characters.
3. Set `ADMIN_EMAIL=dkpstructures@gmail.com` only for a private test deployment. In this starter, the matching email is granted admin role at registration. This bootstrap method is NOT safe for public launch until replaced by an owner-only invitation and email verification.
4. Set `SMARTSUPP_KEY` to your real Smartsupp website chat key after creating the Smartsupp account.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

## Smartsupp setup
1. Create/sign in to Smartsupp: https://www.smartsupp.com/
2. Verify your email and add the deployed website domain to your Smartsupp workspace if prompted.
3. Open Smartsupp settings and find **Chat box → Chat code** (the exact menu wording may change).
4. Copy the website chat key only. Do not share your Smartsupp password or private API token.
5. In your hosting provider's environment settings, set `SMARTSUPP_KEY` to that key.
6. Set `SUPPORT_EMAIL=dkpstructures@gmail.com`.
7. Redeploy/restart the app and test the blue chat button from a separate browser/device.
8. Add actual support agents, set staffed hours, and configure the welcome/offline messages in Smartsupp.

## Customer support
- Public support email: **dkpstructures@gmail.com**
- Email link: `mailto:dkpstructures@gmail.com`
- Live chat: Smartsupp widget after `SMARTSUPP_KEY` is configured.
- If chat is not configured or unavailable, the floating chat button opens a pre-addressed email draft.

## Deploy the full application
Deploy as a Node.js web service, not a static-site upload. The app needs a persistent writable data directory for SQLite and the SQLite session store. The default filesystem on many cloud hosts is ephemeral. For production, migrate the database/session store to a managed PostgreSQL database and persistent session store, or use a host with a properly configured persistent disk. Verify backup and restore before use.

Typical Node service commands:
- Build: `npm install`
- Start: `npm start`

Set production environment variables in the hosting dashboard:
- `NODE_ENV=production`
- `SESSION_SECRET` (strong random secret, 32+ characters)
- `ADMIN_EMAIL` (owner address, but do not enable public registration-based admin assignment in production)
- `SUPPORT_EMAIL=dkpstructures@gmail.com`
- `SMARTSUPP_KEY` (real website chat key)
- `DB_PATH` (persistent storage path if retaining SQLite)

## Known launch blockers to resolve before public account registration
- Replace email-based first-registration admin assignment with a private owner invitation/provisioning process.
- Add email verification and password reset.
- Add CSRF protection and review rate limits, session cookie settings and output handling.
- Add notifications for support requests; currently requests are saved in the database and visible in the admin board, but this code does not send notification emails.
- Migrate SQLite and SQLite sessions to production-grade persistent storage.
- Add scheduled backups and prove a restore works.
- Complete privacy notice, terms, fundraising disclosures and legal review for the actual recipient and jurisdiction.
- Only use payment methods approved for the actual fundraising arrangement. Do not imply the site itself accepts or processes payments.

## Manual contribution verification workflow
1. Supporter contacts customer support at **dkpstructures@gmail.com** or through Smartsupp to request currently available payment methods.
2. Customer service independently checks the receiving payment provider/account and confirms funds have cleared.
3. Admin opens `/admin.html`, finds the supporter and creates a pending contribution record with amount, payment method, unique reference and customer-service confirmation note.
4. Admin independently checks the receiving account/provider record, then records a verification note and selects **Verify & credit supporter**.
5. The database transaction changes the record to verified and adds the amount to the supporter’s verified contribution total once. Repeated verification is blocked.
6. Pending and rejected records do not increase the verified contribution total.

Never mark a payment verified based only on a screenshot, an email supplied by the payer, or an unconfirmed claim. Confirm in the actual receiving account/provider dashboard.
