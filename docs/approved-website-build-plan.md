# DKP STRUCTURES — Approved Website Build Plan

## Working branch
`feature/dkp-approved-site-structure`

This is a development branch based on `rebuild/professional-functional`. Do not deploy it directly to production. The production website must remain unchanged until the feature work is tested and explicitly approved for release.

## Public welcome page
1. Show the DKP STRUCTURES brand and construction-focused hero.
2. Put Login and Create Account at the top of the visitor journey.
3. Show Supporters Recognition on the first page, with links to the full ranking.
4. Show the complete company introduction supplied by the owner, including the US$1 million fundraising target and voluntary-contribution disclosures.
5. Keep company information publicly readable without requiring an account.

## Supporter dashboard
The dashboard should expose only two primary tasks:
- Make Deposit: select a contribution plan, choose an amount (minimum USD 100), and view the approved payment instructions.
- Confirm Payment: select the corresponding plan, enter the transfer reference and payment details, and submit proof/details for manual verification.

A submitted payment must remain pending until an authorised administrator independently verifies cleared funds. Do not describe contributions as a wallet balance, investment, loan, deposit account, or source of financial returns. Do not invent payment methods or payment instructions.

## Supporters Centre
- Management-only publishing of official announcements, newsletters, milestones and project updates.
- Newest-first feed, archived updates and pinned notices.
- Supporters may read updates; questions should be submitted privately.

## Supporters Recognition
- Public monthly and lifetime rankings based only on verified contributions.
- Supporters can choose a public display name or keep their recognition private.
- Recognition levels are acknowledgement only and must not imply ownership, investment rights or financial returns.
- Never display sample names, totals or rankings as if they were live records.

## Complaints Centre
- Complaint submissions only; no public discussion or general chat.
- Categories include payment, account access, contribution records, staff/management conduct and other complaints.
- Give each complaint a reference number and private status tracking (Received, Under Review, Resolved).
- Restrict complaint records to the submitting supporter and authorised staff.

## Admin Control Centre
- Payment verification and rejection with audit history.
- Supporter account management.
- Announcement/newsletter publishing.
- Ranking oversight.
- Complaint review and status updates.
- Accurate reporting from verified records only.

## Release and safety requirements
- Preserve the existing production deployment while developing.
- Test authentication, role permissions, payment submission/verification, complaint privacy, announcement access, ranking calculations and mobile layouts.
- Verify database migrations, backup and restore procedures.
- Review the fundraising terms, privacy disclosures and the proposed future home-construction labour commitment before describing any benefit as a legally guaranteed entitlement.
- Do not launch or publish illustrative data, unverified milestones, invented payment methods or unsupported guarantees.
