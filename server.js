require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const termsVersion = process.env.TERMS_VERSION || "2026-11-10";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured.");
}
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in production.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initializeDatabase() {
  await pool.query("SELECT 1");
  await pool.query("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, supporter_id VARCHAR(80) UNIQUE NOT NULL, full_name VARCHAR(120) NOT NULL, email VARCHAR(320) UNIQUE NOT NULL, country VARCHAR(80) NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'supporter' CHECK (role IN ('supporter','admin')), personal_target DOUBLE PRECISION NOT NULL DEFAULT 0, terms_version VARCHAR(80) NOT NULL, terms_accepted_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), selected_plan VARCHAR(80) NOT NULL DEFAULT 'Basic', selected_amount NUMERIC NOT NULL DEFAULT 100, language VARCHAR(12) NOT NULL DEFAULT 'en', theme VARCHAR(12) NOT NULL DEFAULT 'light', avatar_data TEXT)");
  await pool.query("CREATE TABLE IF NOT EXISTS contributions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount NUMERIC NOT NULL CHECK (amount >= 100), currency VARCHAR(12) NOT NULL DEFAULT 'USD', reference VARCHAR(120) NOT NULL, payment_method VARCHAR(100) NOT NULL DEFAULT 'Customer service recorded', customer_service_note VARCHAR(1000) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')), verified_by INTEGER REFERENCES users(id), verified_at TIMESTAMPTZ, rejected_by INTEGER REFERENCES users(id), rejected_at TIMESTAMPTZ, admin_note VARCHAR(2000) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS support_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name VARCHAR(120) NOT NULL, email VARCHAR(320) NOT NULL, country VARCHAR(80) NOT NULL, request_type VARCHAR(40) NOT NULL, message TEXT NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'open', admin_note TEXT, admin_reply TEXT, replied_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS admin_reply TEXT");
  await pool.query("ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ");
  await pool.query("CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), action VARCHAR(120) NOT NULL, target_type VARCHAR(80) NOT NULL, target_id INTEGER, details TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS password_reset_tokens (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash VARCHAR(255) UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR NOT NULL PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP(6) NOT NULL)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_contributions_user_status ON contributions(user_id, status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_contributions_status_created ON contributions(status, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_support_requests_status_created ON support_requests(status, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id, expires_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire)");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "350kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60
  }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));
app.use(express.static(path.join(__dirname, "public")));

const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const clean = v => String(v || "").trim();

const levels = [
  ["Basic", 100, 499],
  ["Bronze", 500, 1249],
  ["Silver", 1250, 2999],
  ["Gold", 3000, 6999],
  ["Platinum", 7000, 14999],
  ["Diamond", 15000, 29999],
  ["Founding", 30000, Number.MAX_SAFE_INTEGER]
];

function levelFor(total) {
  const amount = Number(total || 0);
  return levels.find(x => amount >= x[1] && amount <= x[2])?.[0] || "Basic";
}

function establishSession(req, userId, res, successStatus, payload) {
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start session." });
    req.session.userId = userId;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "Could not save your login session. Please try again." });
      res.status(successStatus).json(payload);
    });
  });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  try {
    const result = await pool.query("SELECT role FROM users WHERE id=$1", [req.session.userId]);
    if (!result.rows[0] || result.rows[0].role !== "admin") {
      return res.status(403).json({ error: "Administrator access required." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function userPublic(u) {
  return {
    id: u.id,
    supporterId: u.supporter_id,
    name: u.full_name,
    email: u.email,
    country: u.country,
    role: u.role,
    personalTarget: Number(u.personal_target || 0),
    language: u.language || "en",
    theme: u.theme || "light",
    avatarData: u.avatar_data || "",
    createdAt: u.created_at
  };
}

async function totalFor(id) {
  const result = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE user_id=$1 AND status='verified'", [id]);
  return Number(result.rows[0].total || 0);
}

app.get("/api/config", (req, res) => {
  res.json({
    smartsuppKey: process.env.SMARTSUPP_KEY || "",
    supportEmail: process.env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
    termsVersion
  });
});

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "DKP Structures API", database: "PostgreSQL" });
  } catch (err) {
    next(err);
  }
});

app.post("/api/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 8 }), async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const email = clean(req.body.email).toLowerCase();
    const country = clean(req.body.country);
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 100 || !emailOk(email) || country.length < 2 || country.length > 80 || password.length < 12) {
      return res.status(400).json({ error: "Enter your name, valid email, country and a password of at least 12 characters." });
    }
    if (req.body.acceptTerms !== true || req.body.termsVersion !== termsVersion) {
      return res.status(400).json({ error: "Please accept the current Terms & Conditions." });
    }
    const existing = await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", [email]);
    if (existing.rowCount) return res.status(409).json({ error: "An account with this email already exists." });
    const hash = await bcrypt.hash(password, 12);
    const supporterId = "DKP-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    // Public registration must never grant administrator privileges.
    const inserted = await pool.query(
      "INSERT INTO users(supporter_id,full_name,email,country,password_hash,role,terms_version,terms_accepted_at) VALUES($1,$2,$3,$4,$5,'supporter',$6,$7) RETURNING id",
      [supporterId, name, email, country, hash, termsVersion, new Date().toISOString()]
    );
    const userId = inserted.rows[0].id;
    const userResult = await pool.query("SELECT * FROM users WHERE id=$1", [userId]);
    establishSession(req, userId, res, 201, { user: userPublic(userResult.rows[0]) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    next(err);
  }
});

app.post("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res, next) => {
  try {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || "");
    const result = await pool.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email]);
    const u = result.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    establishSession(req, u.id, res, 200, { user: userPublic(u) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Account not found." });
    res.json({ user: userPublic(result.rows[0]) });
  } catch (err) { next(err); }
});

app.get("/api/dashboard", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
    const u = result.rows[0];
    if (!u) return res.status(404).json({ error: "Account not found." });
    const total = await totalFor(u.id);
    const historyResult = await pool.query(
      "SELECT amount,currency,reference,payment_method,status,created_at AS date,verified_at AS \"verifiedAt\" FROM contributions WHERE user_id=$1 ORDER BY id DESC LIMIT 50",
      [u.id]
    );
    res.json({
      user: userPublic(u),
      verifiedTotal: total,
      level: levelFor(total),
      progress: u.personal_target ? Math.min(100, Math.round(total / Number(u.personal_target) * 100)) : 0,
      history: historyResult.rows,
      balanceMeaning: "Verified contribution total only. It is not cash held for the supporter, a bank deposit, withdrawable balance or investment account."
    });
  } catch (err) { next(err); }
});

app.patch("/api/profile", requireAuth, async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const country = clean(req.body.country);
    const language = clean(req.body.language || "en");
    const theme = clean(req.body.theme || "light");
    const avatarData = req.body.avatarData;
    const supportedLanguages = ["en", "es", "id", "ms", "de", "fr", "nl", "pt", "ar", "zh", "ja"];
    if (name.length < 2 || name.length > 100 || country.length < 2 || country.length > 80) {
      return res.status(400).json({ error: "Enter a valid full name and country." });
    }
    if (!supportedLanguages.includes(language) || !["light", "dark"].includes(theme)) {
      return res.status(400).json({ error: "Choose a supported language and appearance." });
    }
    if (avatarData !== undefined && avatarData !== null && avatarData !== "") {
      if (typeof avatarData !== "string" || avatarData.length > 310000 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatarData)) {
        return res.status(400).json({ error: "Profile photo must be PNG, JPG or WebP and no larger than 220 KB." });
      }
      await pool.query(
        "UPDATE users SET full_name=$1,country=$2,language=$3,theme=$4,avatar_data=$5 WHERE id=$6",
        [name, country, language, theme, avatarData, req.session.userId]
      );
    } else {
      await pool.query(
        "UPDATE users SET full_name=$1,country=$2,language=$3,theme=$4 WHERE id=$5",
        [name, country, language, theme, req.session.userId]
      );
    }
    const updated = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
    if (!updated.rows[0]) return res.status(404).json({ error: "Account not found." });
    res.json({ user: userPublic(updated.rows[0]), message: "Profile and preferences saved." });
  } catch (err) { next(err); }
});

app.patch("/api/profile/target", requireAuth, async (req, res, next) => {
  try {
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target < 100 || target > 100000000) {
      return res.status(400).json({ error: "Enter a target of at least USD $100." });
    }
    await pool.query("UPDATE users SET personal_target=$1 WHERE id=$2", [target, req.session.userId]);
    res.json({ target });
  } catch (err) { next(err); }
});

app.post("/api/support-requests", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }), async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const email = clean(req.body.email).toLowerCase();
    const country = clean(req.body.country);
    const type = clean(req.body.type);
    const message = clean(req.body.message);
    if (name.length < 2 || !emailOk(email) || country.length < 2 || message.length < 10 || message.length > 3000) {
      return res.status(400).json({ error: "Please provide your name, valid email, country and a message (10–3000 characters)." });
    }
    if (!["payment_methods", "general", "account"].includes(type)) {
      return res.status(400).json({ error: "Invalid support request type." });
    }
    const result = await pool.query(
      "INSERT INTO support_requests(user_id,name,email,country,request_type,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [req.session.userId || null, name, email, country, type, message]
    );
    res.status(201).json({
      ok: true,
      requestId: result.rows[0].id,
      message: "Your support request has been recorded. Please wait for the support team to reply using the contact details you supplied."
    });
  } catch (err) { next(err); }
});

app.get("/api/support-requests/mine", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,request_type,message,status,admin_reply,replied_at,created_at FROM support_requests WHERE user_id=$1 ORDER BY id DESC LIMIT 50", [req.session.userId]);
    res.json({ requests: result.rows });
  } catch (err) { next(err); }
});

app.get("/api/admin/summary", requireAdmin, async (req, res, next) => {
  try {
    const [users, support, pending, rejected, verified] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='supporter'"),
      pool.query("SELECT COUNT(*)::int AS n FROM support_requests WHERE status='open'"),
      pool.query("SELECT COUNT(*)::int AS n FROM contributions WHERE status='pending'"),
      pool.query("SELECT COUNT(*)::int AS n FROM contributions WHERE status='rejected'"),
      pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM contributions WHERE status='verified'")
    ]);
    res.json({
      users: users.rows[0].n,
      openSupportRequests: support.rows[0].n,
      pendingContributions: pending.rows[0].n,
      rejectedContributions: rejected.rows[0].n,
      verifiedTotal: Number(verified.rows[0].n || 0)
    });
  } catch (err) { next(err); }
});

app.get("/api/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,supporter_id,full_name,email,country,role,created_at FROM users ORDER BY id DESC LIMIT 500");
    res.json({ users: result.rows });
  } catch (err) { next(err); }
});

app.get("/api/admin/support-requests", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM support_requests ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC LIMIT 500");
    res.json({ requests: result.rows });
  } catch (err) { next(err); }
});

app.patch("/api/admin/support-requests/:id", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const status = clean(req.body.status);
    const note = clean(req.body.adminNote);
    const reply = clean(req.body.adminReply);
    const id = Number(req.params.id);
    if (!["open", "in_progress", "closed"].includes(status) || !Number.isSafeInteger(id) || id < 1 || note.length > 2000 || reply.length > 3000) {
      return res.status(400).json({ error: "Invalid status, request ID, note or reply." });
    }
    await client.query("BEGIN");
    inTransaction = true;
    const updated = await client.query(
      "UPDATE support_requests SET status=$1,admin_note=$2,admin_reply=CASE WHEN $3 <> '' THEN $3 ELSE admin_reply END,replied_at=CASE WHEN $3 <> '' THEN NOW() ELSE replied_at END WHERE id=$4 RETURNING id",
      [status, note, reply, id]
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({ error: "Support request not found." });
    }
    await client.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",
      [req.session.userId, "update_support_request", "support_request", id, JSON.stringify({ status, replied: Boolean(reply) })]);
    await client.query("COMMIT");
    inTransaction = false;
    res.json({ ok: true, message: reply ? "Reply saved and visible in the supporter's dashboard." : "Support request updated." });
  } catch (err) {
    if (inTransaction) await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

app.post("/api/admin/contributions", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const supporterId = clean(req.body.supporterId);
    const amount = Number(req.body.amount);
    const reference = clean(req.body.reference);
    const paymentMethod = clean(req.body.paymentMethod) || "Customer service recorded";
    const serviceNote = clean(req.body.customerServiceNote);
    const uResult = await client.query("SELECT id FROM users WHERE supporter_id=$1", [supporterId]);
    const u = uResult.rows[0];
    if (!u) return res.status(404).json({ error: "Supporter not found." });
    if (!Number.isFinite(amount) || amount < 100 || amount > 100000000 || reference.length < 4 || reference.length > 120 || paymentMethod.length > 100 || serviceNote.length > 1000) {
      return res.status(400).json({ error: "Enter a valid amount (minimum USD $100), payment reference and payment method." });
    }
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO contributions(user_id,amount,reference,payment_method,customer_service_note,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING id",
      [u.id, amount, reference, paymentMethod, serviceNote]
    );
    const id = inserted.rows[0].id;
    await client.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",
      [req.session.userId, "record_pending_contribution", "contribution", id, JSON.stringify({ reference, paymentMethod, amount })]);
    await client.query("COMMIT");
    res.status(201).json({
      id,
      status: "pending",
      message: "Payment record created as pending. Do not credit the supporter until customer service independently confirms cleared funds."
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

app.patch("/api/admin/contributions/:id/verify", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const note = clean(req.body.adminNote);
  if (!Number.isSafeInteger(id) || id < 1 || note.length < 8 || note.length > 1000) {
    return res.status(400).json({ error: "Provide a verification note of at least 8 characters, including how payment success was confirmed." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM contributions WHERE id=$1 FOR UPDATE", [id]);
    const c = result.rows[0];
    if (!c) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payment record not found." });
    }
    if (c.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This record is already " + c.status + ". No second credit was made." });
    }
    const changed = await client.query(
      "UPDATE contributions SET status='verified',verified_by=$1,verified_at=NOW(),admin_note=$2 WHERE id=$3 AND status='pending'",
      [req.session.userId, note, id]
    );
    if (changed.rowCount !== 1) throw new Error("This payment record has already been processed.");
    await client.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",
      [req.session.userId, "verify_and_credit_contribution", "contribution", id, JSON.stringify({ amount: c.amount, currency: c.currency, reference: c.reference, note })]);
    await client.query("COMMIT");
    res.json({
      ok: true,
      status: "verified",
      creditedAmount: Number(c.amount),
      currency: c.currency,
      message: "Verified contribution total updated once."
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.message === "This payment record has already been processed.") return res.status(409).json({ error: err.message });
    next(err);
  } finally { client.release(); }
});

app.patch("/api/admin/contributions/:id/reject", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const note = clean(req.body.adminNote);
  if (!Number.isSafeInteger(id) || id < 1 || note.length < 8 || note.length > 1000) {
    return res.status(400).json({ error: "Provide a rejection reason of at least 8 characters." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM contributions WHERE id=$1 FOR UPDATE", [id]);
    const c = result.rows[0];
    if (!c) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payment record not found." });
    }
    if (c.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only pending payment records can be rejected." });
    }
    await client.query("UPDATE contributions SET status='rejected',rejected_by=$1,rejected_at=NOW(),admin_note=$2 WHERE id=$3 AND status='pending'",
      [req.session.userId, note, id]);
    await client.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",
      [req.session.userId, "reject_contribution", "contribution", id, note]);
    await client.query("COMMIT");
    res.json({ ok: true, status: "rejected" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

app.get("/api/admin/contributions", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT c.id,c.amount,c.currency,c.reference,c.payment_method,c.customer_service_note,c.status,c.created_at,c.verified_at,c.admin_note,u.supporter_id,u.full_name,u.email,u.country FROM contributions c JOIN users u ON u.id=c.user_id ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END,c.id DESC LIMIT 500"
    );
    res.json({ contributions: result.rows });
  } catch (err) { next(err); }
});

app.get("/api/admin/audit-logs", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500");
    res.json({ logs: result.rows });
  } catch (err) { next(err); }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error("DKP Structures request failed:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "The application could not complete this request." });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => console.log("DKP Structures running on port " + PORT));
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
