# DKP STRUCTURES deployment checklist

## Before any public launch
- [ ] Confirm legal recipient, jurisdiction, fundraising model and required permissions.
- [ ] Publish accurate terms, privacy notice, refund/complaints information and campaign disclosures.
- [ ] Replace email-based admin bootstrap with secure owner-only provisioning.
- [ ] Add email verification and password reset.
- [ ] Add CSRF protection and complete security review.
- [ ] Migrate SQLite/session storage to persistent production database/session storage.
- [ ] Configure backups and test restore.
- [ ] Configure support-request email notifications (currently requests only appear in admin board).
- [ ] Set production secrets and HTTPS.

## Smartsupp and email
- [ ] Create and verify Smartsupp account.
- [ ] Add actual site domain to Smartsupp if requested.
- [ ] Set `SMARTSUPP_KEY` to website chat key.
- [ ] Set `SUPPORT_EMAIL=dkpstructures@gmail.com`.
- [ ] Add staffed agents, hours, welcome and offline messages.
- [ ] Test live chat and email fallback.

## Manual contribution process
- [ ] Customer service gives payment options only after checking the supporter’s country and provider availability.
- [ ] Confirm cleared funds in the actual receiving account/provider dashboard.
- [ ] Admin records payment as pending with unique reference.
- [ ] Admin verifies with an evidence note.
- [ ] Confirm the verified contribution total increases once only.
- [ ] Confirm pending/rejected records do not change totals.

## Final checks
- [ ] Test registration, login, logout, dashboard, support requests and admin controls.
- [ ] Test from Android and desktop browsers.
- [ ] Remove test accounts and test contributions before launch.
- [ ] Do not collect contributions until legal and payment-provider checks are complete.
