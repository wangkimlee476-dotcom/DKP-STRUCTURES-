"use strict";

const assert = require("node:assert/strict");
const { Client } = require("pg");

const base = process.env.DKP_TEST_BASE_URL || "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for HTTP integration tests.");

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return values.map(value => value.split(";")[0]).filter(Boolean).join("; ");
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  let data = {};
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) data = await response.json();
  return { response, data, cookie: cookieFrom(response) || cookie || "" };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const { response } = await request("/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Application did not become healthy within 30 seconds.");
}

async function main() {
  await waitForServer();
  const suffix = Date.now() + "-" + Math.random().toString(16).slice(2);
  const supporterEmail = `supporter-${suffix}@example.test`;
  const adminEmail = `admin-${suffix}@example.test`;
  const password = "DKP-Integration-Test-Password-2026!";

  let supporterCookie = "";
  let adminCookie = "";
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const registration = await request("/api/register", {
      method: "POST",
      body: {
        name: "DKP Integration Supporter",
        email: supporterEmail,
        country: "Test Country",
        password,
        acceptTerms: true,
        termsVersion: "2026-11-10"
      }
    });
    assert.equal(registration.response.status, 201, JSON.stringify(registration.data));
    assert.ok(registration.data.user?.supporterId);
    supporterCookie = registration.cookie;
    assert.ok(supporterCookie, "Registration must establish an authenticated session.");
    assert.match(registration.data.user?.supporterId || "", /^DKP-/);

    const referralCode = (await request("/api/dashboard", { cookie: supporterCookie })).data.referral?.code;
    assert.match(referralCode || "", /^DKP-[A-F0-9]{12}$/);

    const referredEmail = `referred-${suffix}@example.test`;
    const referredRegistration = await request("/api/register", {
      method: "POST",
      body: {
        name: "DKP Referred Supporter",
        email: referredEmail,
        country: "Test Country",
        password,
        acceptTerms: true,
        termsVersion: "2026-11-10",
        referralCode
      }
    });
    assert.equal(referredRegistration.response.status, 201, JSON.stringify(referredRegistration.data));
    const referralDashboard = await request("/api/dashboard", { cookie: supporterCookie });
    assert.equal(referralDashboard.data.referral?.count, 1, "The referring supporter must see one successful registration.");

    const invalidReferral = await request("/api/register", {
      method: "POST",
      body: {
        name: "Invalid Referral",
        email: `invalid-referral-${suffix}@example.test`,
        country: "Test Country",
        password,
        acceptTerms: true,
        termsVersion: "2026-11-10",
        referralCode: "DKP-INVALID"
      }
    });
    assert.equal(invalidReferral.response.status, 400, "Invalid referral codes must not be accepted.");

    const forbidden = await request("/api/admin/summary", { cookie: supporterCookie });
    assert.equal(forbidden.response.status, 403, "A supporter must not access admin endpoints.");

    const duplicateAccount = await request("/api/register", {
      method: "POST",
      body: {
        name: "Duplicate Account",
        email: supporterEmail,
        country: "Test Country",
        password,
        acceptTerms: true,
        termsVersion: "2026-11-10"
      }
    });
    assert.equal(duplicateAccount.response.status, 409);

    const submission = await request("/api/contributions/submit", {
      method: "POST",
      cookie: supporterCookie,
      body: { amount: 125, reference: "DKP-TEST-" + suffix, paymentMethod: "Integration test", note: "Synthetic test record; no real funds." }
    });
    assert.equal(submission.response.status, 201, JSON.stringify(submission.data));
    const contributionId = submission.data.id;

    const pendingDashboard = await request("/api/dashboard", { cookie: supporterCookie });
    assert.equal(pendingDashboard.response.status, 200);
    assert.equal(Number(pendingDashboard.data.verifiedTotal), 0, "Pending contributions must not increase verified totals.");

    await db.query("UPDATE users SET role='admin' WHERE email=$1", [supporterEmail]);
    const adminLogin = await request("/api/login", {
      method: "POST",
      body: { email: supporterEmail, password }
    });
    assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.data));
    adminCookie = adminLogin.cookie;
    assert.ok(adminCookie, "Admin login must establish a session.");

    const adminSummary = await request("/api/admin/summary", { cookie: adminCookie });
    assert.equal(adminSummary.response.status, 200, JSON.stringify(adminSummary.data));
    const referralReport = await request("/api/admin/referrals", { cookie: adminCookie });
    assert.equal(referralReport.response.status, 200, JSON.stringify(referralReport.data));
    assert.ok(referralReport.data.referrals.some(item => item.referred_email === referredEmail), "Admin must see the referred registration.");
    const verified = await request(`/api/admin/contributions/${contributionId}/verify`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { adminNote: "Synthetic integration test only; verified against test fixture." }
    });
    assert.equal(verified.response.status, 200, JSON.stringify(verified.data));

    const secondVerify = await request(`/api/admin/contributions/${contributionId}/verify`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { adminNote: "Attempt to verify the same record a second time." }
    });
    assert.equal(secondVerify.response.status, 409, "A contribution must not be credited twice.");

    const dashboardAfter = await request("/api/dashboard", { cookie: adminCookie });
    assert.equal(Number(dashboardAfter.data.verifiedTotal), 125, "Only the verified contribution must increase the total.");

    const support = await request("/api/support-requests", {
      method: "POST",
      body: { name: "Integration Tester", email: adminEmail, country: "Test Country", type: "general", message: "Synthetic integration test support request." }
    });
    assert.equal(support.response.status, 201, JSON.stringify(support.data));
    const supportQueue = await request("/api/admin/support-requests", { cookie: adminCookie });
    assert.equal(supportQueue.response.status, 200);
    assert.ok(supportQueue.data.requests.some(item => item.id === support.data.requestId));

    const audit = await request("/api/admin/audit-logs", { cookie: adminCookie });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.data.logs.some(item => item.target_type === "contribution" && Number(item.target_id) === Number(contributionId)));

    const logout = await request("/api/logout", { method: "POST", cookie: adminCookie });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request("/api/admin/summary", { cookie: adminCookie });
    assert.equal(afterLogout.response.status, 401, "Logout must invalidate the authenticated session.");

    console.log("DKP HTTP integration tests passed: registration, duplicate protection, supporter/admin authorization, pending-to-verified contribution lifecycle, one-time credit, support queue, audit log and logout.");
  } finally {
    // Remove only the synthetic accounts and their dependent test records.
    await db.query("DELETE FROM referrals WHERE referrer_user_id IN (SELECT id FROM users WHERE email = ANY($1::text[])) OR referred_user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))", [[supporterEmail, adminEmail, `referred-${suffix}@example.test`]]).catch(() => {});
    await db.query("DELETE FROM audit_logs WHERE admin_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))", [[supporterEmail, adminEmail, `referred-${suffix}@example.test`]]).catch(() => {});
    await db.query("DELETE FROM support_requests WHERE email = ANY($1::text[])", [[supporterEmail, adminEmail]]).catch(() => {});
    await db.query("DELETE FROM contributions WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))", [[supporterEmail, adminEmail]]).catch(() => {});
    await db.query("DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))", [[supporterEmail, adminEmail]]).catch(() => {});
    await db.query("DELETE FROM user_sessions WHERE sess->>'userId' IN (SELECT id::text FROM users WHERE email = ANY($1::text[]))", [[supporterEmail, adminEmail]]).catch(() => {});
    await db.query("DELETE FROM users WHERE email = ANY($1::text[])", [[supporterEmail, adminEmail]]).catch(() => {});
    await db.end();
  }
}

main().catch(error => {
  console.error("DKP HTTP integration test failed:", error);
  process.exitCode = 1;
});
