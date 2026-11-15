const crypto = require("crypto");

const REFERRAL_CODE_PATTERN = /^DKP-[A-F0-9]{12}$/;

function generateReferralCode() {
  return "DKP-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function normalizeReferralCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

module.exports = {
  REFERRAL_CODE_PATTERN,
  generateReferralCode,
  normalizeReferralCode
};
