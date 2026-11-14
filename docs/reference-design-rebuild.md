# DKP STRUCTURES reference-screen rebuild

Reference: the owner-provided 10-screen image (welcome, create account, login, supporter dashboard, make deposit, confirm payment, supporters centre, ranking, complaints centre, admin control centre).

## Build rules
- Rebuild on a clean feature branch based on the current functional Cloudflare/PostgreSQL platform.
- Do not alter or disable the production deployment during development.
- Keep the visual direction from the supplied reference: navy/white/gold, compact mobile-first screens, construction imagery and consistent DKP header.
- Use real account data only. Never show sample supporter names, totals, payment counts, dates or progress as actual records.
- Payment submissions stay pending until an authorised administrator verifies cleared funds. Do not add unconfigured payment rails or pretend that a receipt is proof of cleared funds.
- Supporters Recognition appears on the public welcome page; ranking is calculated from verified contributions and supports a private display option.
- Supporter dashboard has two primary actions only: Make Deposit and Confirm Payment. Any required legal/security disclosures remain available without adding extra dashboard destinations.
- Supporters Centre is management-published, read-only announcements/newsletters/progress updates with an archive and optional notification preferences.
- Complaints Centre is private complaint submission and tracking, not a general chat room.
- Admin Control Centre is restricted to authorised administrators and includes payment verification, supporters, announcements, rankings, complaints and audit/reporting.
- Company introduction includes the complete owner-approved message and clear voluntary contribution/no financial return language.
- Future supporter labour assistance must not be represented as an unconditional legal guarantee until eligibility, scope, location and funding obligations are formally approved and published.

## Release gates
1. Implement and review each screen and its connected API.
2. Run syntax checks, project contract tests and worker/database context tests.
3. Test mobile and desktop layouts.
4. Test auth boundaries and admin-only routes.
5. Test contribution state transitions and ranking calculations against verified records.
6. Test private complaint visibility and management access.
7. Verify migrations, backup and restore procedures.
8. Verify a preview deployment and production configuration.
9. Only then request production cutover approval. Keep the previous production release available for rollback.
