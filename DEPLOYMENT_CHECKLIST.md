# DKP STRUCTURES — production readiness checklist

This checklist is intentionally conservative. A green build or successful Worker deployment does not mean the fundraising platform is ready to accept real supporter data or contributions.

## Legal, fundraising and privacy
- [ ] Confirm the legal recipient, jurisdiction, fundraising model and any permissions or registrations required.
- [ ] Publish reviewed Terms & Conditions, privacy notice, data-retention policy, complaints process and any refund/cancellation disclosures that legally apply.
- [ ] Clearly disclose that contributions are voluntary and are not investments, shares, loans, deposits, ownership or guaranteed returns.
- [ ] Confirm the campaign target and public progress figures are accurate; never present the USD $1,000,000 planning target as money already raised.
- [ ] Confirm the lawful basis, retention period and access controls for supporter personal data.

## Identity, authentication and authorization
- [x] Public registration creates supporter accounts only; no public email-based admin self-registration.
- [ ] Provision the owner/admin role through a private, authenticated database operation and verify least-privilege admin access.
- [ ] Implement and test email ownership verification before treating an email address as verified.
- [ ] Complete a secure, end-to-end password recovery process that sends a one-time expiring link to the account's verified email address. Current code records a support request and lets an admin generate a link manually; it does not automatically email a reset link.
- [ ] Review session rotation, expiry, cookie settings, logout, password-change invalidation and concurrent-session behavior.
- [x] Browser API writes reject cross-site Fetch Metadata requests and mismatched Origin headers when supplied.
- [ ] Complete independent CSRF/security review, including requests without an Origin header and non-browser clients.
- [ ] Review rate limits, account enumeration, brute-force protection, password policy and admin access logs.

## Database and operations
- [ ] Confirm the Cloudflare Hyperdrive ID belongs to the intended Cloudflare account and points to the correct Neon production branch/database.
- [ ] Apply reviewed PostgreSQL schema migrations before deployment; Worker startup checks schema readiness but does not create production tables.
- [ ] Confirm all required tables, columns, constraints and indexes exist.
- [ ] Use a dedicated least-privilege database role for the application.
- [ ] Configure automated backups and complete a documented restore test.
- [ ] Confirm session records persist and expire correctly in PostgreSQL.
- [ ] Decide whether records from any previous deployment need migration; do not assume they are imported automatically.
- [ ] Configure monitoring, alerting, log retention and incident response.

## Email and customer support
- [ ] Configure a verified transactional email provider and sender domain for account verification and password recovery.
- [ ] Configure support-request notifications; currently support requests are recorded in the admin board, not automatically emailed.
- [ ] Confirm the Smartsupp account, website key and allowed domain are correct.
- [ ] Staff support hours, welcome message, offline message and escalation process.
- [ ] Test live chat, pop-up behavior, email fallback and support-request form on Android and desktop.
- [ ] Publish only support hours and response-time commitments that can actually be met.

## Manual contribution controls
- [ ] Customer service gives payment instructions only after checking the supporter's country and available provider.
- [ ] Confirm cleared funds in the actual receiving account/provider dashboard before any verification.
- [ ] Admin records the payment reference and evidence note.
- [ ] Verify a contribution exactly once; duplicate references must be rejected.
- [ ] Confirm pending/rejected contributions do not change supporter or campaign verified totals.
- [ ] Confirm currency, amount, reference, verifier and timestamp are visible in the audit trail.
- [ ] Do not request card numbers, passwords, one-time codes or bank login credentials.

## Final end-to-end acceptance
- [ ] Test registration, terms acceptance, login, logout, password change and password recovery.
- [ ] Test supporter dashboard, contribution submission, settings, profile, target, history and all navigation controls.
- [ ] Test admin summary, supporter list, support queue, contribution verification/rejection and audit history.
- [ ] Test authorization by attempting admin endpoints from a normal supporter account.
- [ ] Test duplicate submissions and simultaneous verification attempts.
- [ ] Test on current Android and desktop browsers, including narrow mobile screens.
- [ ] Test clean deployment, rollback procedure, database backup and restore.
- [ ] Remove test accounts and test contributions or clearly segregate them from production.
- [ ] Obtain legal, security and operational sign-off before inviting real supporters or collecting contributions.

## Release decision

**Do not launch for real supporters while any critical security, data integrity, legal, database, email recovery or payment-verification item above remains unresolved.**
