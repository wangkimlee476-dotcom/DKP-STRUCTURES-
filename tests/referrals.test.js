const test = require("node:test");
const assert = require("node:assert/strict");
const { generateReferralCode, normalizeReferralCode } = require("../referrals");

test("generated referral codes use the DKP prefix and twelve uppercase hex characters", () => {
  assert.match(generateReferralCode(), /^DKP-[A-F0-9]{12}$/);
});

test("generated referral codes are distinct in a sample", () => {
  const codes = new Set(Array.from({ length: 500 }, () => generateReferralCode()));
  assert.equal(codes.size, 500);
});

test("normalizes lowercase codes and surrounding whitespace", () => {
  assert.equal(normalizeReferralCode("  dkp-a1b2c3d4e5f6  "), "DKP-A1B2C3D4E5F6");
});

test("treats a missing referral code as no referral", () => {
  assert.equal(normalizeReferralCode(undefined), "");
  assert.equal(normalizeReferralCode("   "), "");
});

test("rejects malformed referral codes", () => {
  assert.equal(normalizeReferralCode("DKP-123"), null);
  assert.equal(normalizeReferralCode("DKP-1234567890AB<script>"), null);
});
