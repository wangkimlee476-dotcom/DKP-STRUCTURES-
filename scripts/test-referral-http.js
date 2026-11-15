const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { generateReferralCode } = require("../referrals");

const port = Number(process.env.PORT || 3000);
const baseUrl = "http://127.0.0.1:" + port;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const server = spawn(process.execPath, ["server.js"], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error("Application exited before becoming healthy.\n" + serverOutput);
    }
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch (error) {
      // The server may still be starting.
    }
    await sleep(250);
  }
  throw new Error("Application did not become healthy in time.\n" + serverOutput);
}

function sessionCookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "Expected the application to issue a session cookie.");
  return value.split(";")[0];
}

async function register(config, name, email, referralCode) {
  const payload = {
    name,
    email,
    country: "Testland",
    password: "TestSupporterPass123!",
    acceptTerms: true,
    termsVersion: config.termsVersion
  };
  if (referralCode) payload.referralCode = referralCode;
  const response = await fetch(baseUrl + "/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  assert.equal(response.status, 201, body.error || "Supporter registration failed.");
  return { user: body.user, cookie: sessionCookie(response) };
}

async function main() {
  await waitForHealth();

  const configResponse = await fetch(baseUrl + "/api/config");
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const referrer = await register(config, "Referral Owner " + suffix, "owner-" + suffix + "@example.test");
  assert.match(referrer.user.referralCode, /^DKP-[A-F0-9]{12}$/);

  const referred = await register(
    config,
    "Referral Invitee " + suffix,
    "invitee-" + suffix + "@example.test",
    referrer.user.referralCode
  );

  const dashboardResponse = await fetch(baseUrl + "/api/dashboard", {
    headers: { Cookie: referrer.cookie }
  });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.referralCount, 1);
  assert.equal(dashboard.user.referralCode, referrer.user.referralCode);
  assert.equal(JSON.stringify(dashboard).includes(referred.user.email), false);
  assert.equal(JSON.stringify(dashboard).includes(referred.user.name), false);

  const deniedResponse = await fetch(baseUrl + "/api/admin/referrals", {
    headers: { Cookie: referrer.cookie }
  });
  assert.equal(deniedResponse.status, 403);

  const adminEmail = "admin-" + suffix + "@example.test";
  const adminPassword = "AdminTestPassword123!";
  const adminHash = await bcrypt.hash(adminPassword, 12);
  await pool.query(
    "INSERT INTO users(supporter_id,full_name,email,country,password_hash,role,terms_version,terms_accepted_at,referral_code) VALUES($1,$2,$3,$4,$5,'admin',$6,NOW(),$7)",
    ["DKP-ADMIN-" + suffix.toUpperCase(), "Test Administrator", adminEmail, "Testland", adminHash, config.termsVersion, generateReferralCode()]
  );

  const loginResponse = await fetch(baseUrl + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert.equal(loginResponse.status, 200);
  const adminCookie = sessionCookie(loginResponse);

  const summaryResponse = await fetch(baseUrl + "/api/admin/summary", {
    headers: { Cookie: adminCookie }
  });
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.equal(summary.referralRegistrations, 1);

  const referralsResponse = await fetch(baseUrl + "/api/admin/referrals", {
    headers: { Cookie: adminCookie }
  });
  assert.equal(referralsResponse.status, 200);
  const referrals = await referralsResponse.json();
  assert.equal(referrals.referrals.length, 1);
  assert.equal(referrals.referrals[0].supporter_id, referrer.user.supporterId);
  assert.equal(referrals.referrals[0].referral_count, 1);
  assert.equal("email" in referrals.referrals[0], false);
  assert.equal("referred_name" in referrals.referrals[0], false);
  assert.equal("referred_email" in referrals.referrals[0], false);

  const invalidEmail = "invalid-" + suffix + "@example.test";
  const invalidResponse = await fetch(baseUrl + "/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Invalid Referral",
      email: invalidEmail,
      country: "Testland",
      password: "TestSupporterPass123!",
      acceptTerms: true,
      termsVersion: config.termsVersion,
      referralCode: "DKP-000000000000"
    })
  });
  assert.equal(invalidResponse.status, 400);
  const invalidUser = await pool.query("SELECT id FROM users WHERE email=$1", [invalidEmail]);
  assert.equal(invalidUser.rowCount, 0);

  const contributionCount = await pool.query("SELECT COUNT(*)::int AS n FROM contributions");
  assert.equal(contributionCount.rows[0].n, 0);

  process.stdout.write("Referral HTTP integration checks passed: attribution, aggregate-only privacy, admin access control and unchanged contributions.\n");
}

main()
  .catch(error => {
    process.stderr.write(String(error.stack || error) + "\n" + serverOutput);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise(resolve => server.once("exit", resolve)),
        sleep(3000)
      ]);
    }
    await pool.end();
  });
