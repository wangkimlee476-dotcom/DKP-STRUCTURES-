
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const dbPath = process.env.DB_PATH || "./data/dkp.sqlite";

fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in production.");
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 supporter_id TEXT UNIQUE NOT NULL,
 full_name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL COLLATE NOCASE,
 country TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'supporter',
 personal_target REAL NOT NULL DEFAULT 0,
 terms_version TEXT NOT NULL,
 terms_accepted_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contributions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount REAL NOT NULL CHECK(amount >= 100),
 currency TEXT NOT NULL DEFAULT 'USD',
 reference TEXT NOT NULL,
 payment_method TEXT NOT NULL DEFAULT 'Customer service recorded',
 customer_service_note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 verified_by INTEGER REFERENCES users(id),
 verified_at TEXT,
 rejected_by INTEGER REFERENCES users(id),
 rejected_at TEXT,
 admin_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS support_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER REFERENCES users(id),
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 country TEXT NOT NULL,
 request_type TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 admin_id INTEGER NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 target_type TEXT NOT NULL,
 target_id INTEGER,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const contributionColumns = db.prepare("PRAGMA table_info(contributions)").all().map(c => c.name);

for (const [name, definition] of [
  ["payment_method", "TEXT NOT NULL DEFAULT 'Customer service recorded'"],
  ["customer_service_note", "TEXT NOT NULL DEFAULT ''"],
  ["rejected_by", "INTEGER REFERENCES users(id)"],
  ["rejected_at", "TEXT"],
  ["admin_note", "TEXT NOT NULL DEFAULT ''"]
]) {
  if (!contributionColumns.includes(name)) {
    db.exec(`ALTER TABLE contributions ADD COLUMN ${name} ${definition}`);
  }
}

const termsVersion = process.env.TERMS_VERSION || "2026-11-10";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: path.dirname(path.resolve(dbPath))
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

// Reject cross-origin browser writes to session-authenticated API routes.
// SameSite=Lax cookies are an additional layer, not a replacement for this check.
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") {
    return res.status(403).json({ error: "Cross-site requests are not allowed." });
  }

  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({ error: "Request origin is not allowed." });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }

  next();
});

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
  return levels.find(x => total >= x[1] && total <= x[2])?.[0] || "Basic";
}

function establishSession(req, userId, res, successStatus, payload) {
  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({ error: "Could not start session." });
    }

    req.session.userId = userId;

    req.session.save(saveErr => {
      if (saveErr) {
        return res.status(500).json({
          error: "Could not save your login session. Please try again."
        });
      }

      res.status(successStatus).json(payload);
    });
  });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please sign in first." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please sign in first." });
  }

  const u = db.prepare("SELECT role FROM users WHERE id=?").get(req.session.userId);

  if (!u || u.role !== "admin") {
    return res.status(403).json({ error: "Administrator access required." });
  }

  next();
}

function userPublic(u) {
  return {
    id: u.id,
    supporterId: u.supporter_id,
    name: u.full_name,
    email: u.email,
    country: u.country,
    role: u.role,
    personalTarget: u.personal_target,
    createdAt: u.created_at
  };
}

function totalFor(id) {
  return db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE user_id=? AND status='verified'"
  ).get(id).total;
}

app.get("/api/config", (req, res) => {
  res.json({
    smartsuppKey: process.env.SMARTSUPP_KEY || "",
    supportEmail: process.env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
    termsVersion
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "DKP Structures API" });
});

app.post("/api/register", rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8
}), async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const country = clean(req.body.country);
  const password = String(req.body.password || "");

  if (
    name.length < 2 ||
    name.length > 100 ||
    !emailOk(email) ||
    country.length < 2 ||
    country.length > 80 ||
    password.length < 12
  ) {
    return res.status(400).json({
      error: "Enter your name, valid email, country and a password of at least 12 characters."
    });
  }

  if (req.body.acceptTerms !== true || req.body.termsVersion !== termsVersion) {
    return res.status(400).json({
      error: "Please accept the current Terms & Conditions."
    });
  }

  if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) {
    return res.status(409).json({
      error: "An account with this email already exists."
    });
  }

  const hash = await bcrypt.hash(password, 12);
  const supporterId = "DKP-" + require("crypto").randomBytes(4).toString("hex").toUpperCase();
  // Public self-registration must never grant administrator privileges.
  // Provision administrators through a private, owner-controlled database operation.
  const role = "supporter";

  const info = db.prepare(`
    INSERT INTO users(
      supporter_id,full_name,email,country,password_hash,role,terms_version,terms_accepted_at
    )
    VALUES(?,?,?,?,?,?,?,?)
  `).run(
    supporterId,
    name,
    email,
    country,
    hash,
    role,
    termsVersion,
    new Date().toISOString()
  );

  const u = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);

  establishSession(req, info.lastInsertRowid, res, 201, {
    user: userPublic(u)
  });
});

app.post("/api/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10
}), async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);

  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({
      error: "Email or password is incorrect."
    });
  }

  establishSession(req, u.id, res, 200, {
    user: userPublic(u)
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  res.json({ user: userPublic(u) });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  const total = totalFor(u.id);

  const history = db.prepare(`
    SELECT amount,currency,reference,payment_method,status,
    created_at AS date,verified_at AS verifiedAt
    FROM contributions
    WHERE user_id=?
    ORDER BY id DESC
    LIMIT 50
  `).all(u.id);

  res.json({
    user: userPublic(u),
    verifiedTotal: total,
    level: levelFor(total),
    progress: u.personal_target
      ? Math.min(100, Math.round(total / u.personal_target * 100))
      : 0,
    history,
    balanceMeaning: "Verified contribution total only. It is not cash held for the supporter, a bank deposit, withdrawable balance or investment account."
  });
});

app.patch("/api/profile/target", requireAuth, (req, res) => {
  const target = Number(req.body.target);

  if (!Number.isFinite(target) || target < 100 || target > 100000000) {
    return res.status(400).json({
      error: "Enter a target of at least USD $100."
    });
  }

  db.prepare("UPDATE users SET personal_target=? WHERE id=?")
    .run(target, req.session.userId);

  res.json({ target });
});

app.post("/api/support-requests", rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10
}), (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const country = clean(req.body.country);
  const type = clean(req.body.type);
  const message = clean(req.body.message);

  if (
    name.length < 2 ||
    !emailOk(email) ||
    country.length < 2 ||
    message.length < 10 ||
    message.length > 3000
  ) {
    return res.status(400).json({
      error: "Please provide your name, valid email, country and a message (10–3000 characters)."
    });
  }

  const allowed = ["payment_methods", "general", "account"];

  if (!allowed.includes(type)) {
    return res.status(400).json({ error: "Invalid support request type." });
  }

  const id = db.prepare(`
    INSERT INTO support_requests(user_id,name,email,country,request_type,message)
    VALUES(?,?,?,?,?,?)
  `).run(
    req.session.userId || null,
    name,
    email,
    country,
    type,
    message
  ).lastInsertRowid;

  res.status(201).json({
    ok: true,
    requestId: id,
    message: "Your support request has been recorded. Please wait for the support team to reply using the contact details you supplied."
  });
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='supporter'").get().n,
    openSupportRequests: db.prepare("SELECT COUNT(*) n FROM support_requests WHERE status='open'").get().n,
    pendingContributions: db.prepare("SELECT COUNT(*) n FROM contributions WHERE status='pending'").get().n,
    rejectedContributions: db.prepare("SELECT COUNT(*) n FROM contributions WHERE status='rejected'").get().n,
    verifiedTotal: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM contributions WHERE status='verified'").get().n
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json({
    users: db.prepare(`
      SELECT id,supporter_id,full_name,email,country,role,created_at
      FROM users
      ORDER BY id DESC
      LIMIT 500
    `).all()
  });
});

app.get("/api/admin/support-requests", requireAdmin, (req, res) => {
  res.json({
    requests: db.prepare(`
      SELECT *
      FROM support_requests
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC
      LIMIT 500
    `).all()
  });
});

app.patch("/api/admin/support-requests/:id", requireAdmin, (req, res) => {
  const status = clean(req.body.status);
  const note = clean(req.body.adminNote).slice(0, 2000);

  if (!["open", "in_progress", "closed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  db.prepare("UPDATE support_requests SET status=?,admin_note=? WHERE id=?")
    .run(status, note, Number(req.params.id));

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,target_type,target_id,details)
    VALUES(?,?,?,?,?)
  `).run(
    req.session.userId,
    "update_support_request",
    "support_request",
    Number(req.params.id),
    status
  );

  res.json({ ok: true });
});

app.post("/api/admin/contributions", requireAdmin, (req, res) => {
  const supporterId = clean(req.body.supporterId);
  const amount = Number(req.body.amount);
  const reference = clean(req.body.reference);
  const paymentMethod = clean(req.body.paymentMethod) || "Customer service recorded";
  const serviceNote = clean(req.body.customerServiceNote);

  const u = db.prepare("SELECT id FROM users WHERE supporter_id=?").get(supporterId);

  if (!u) {
    return res.status(404).json({ error: "Supporter not found." });
  }

  if (
    !Number.isFinite(amount) ||
    amount < 100 ||
    amount > 100000000 ||
    reference.length < 4 ||
    reference.length > 120 ||
    paymentMethod.length > 100 ||
    serviceNote.length > 1000
  ) {
    return res.status(400).json({
      error: "Enter a valid amount (minimum USD $100), payment reference and payment method."
    });
  }

  const id = db.prepare(`
    INSERT INTO contributions(
      user_id,amount,reference,payment_method,customer_service_note,status
    )
    VALUES(?,?,?,?,?,'pending')
  `).run(
    u.id,
    amount,
    reference,
    paymentMethod,
    serviceNote
  ).lastInsertRowid;

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,target_type,target_id,details)
    VALUES(?,?,?,?,?)
  `).run(
    req.session.userId,
    "record_pending_contribution",
    "contribution",
    id,
    JSON.stringify({ reference, paymentMethod, amount })
  );

  res.status(201).json({
    id,
    status: "pending",
    message: "Payment record created as pending. Do not credit the supporter until customer service independently confirms cleared funds."
  });
});

app.patch("/api/admin/contributions/:id/verify", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const note = clean(req.body.adminNote);

  if (!Number.isSafeInteger(id) || id < 1 || note.length < 8 || note.length > 1000) {
    return res.status(400).json({
      error: "Provide a verification note of at least 8 characters, including how payment success was confirmed."
    });
  }

  const c = db.prepare("SELECT * FROM contributions WHERE id=?").get(id);

  if (!c) {
    return res.status(404).json({ error: "Payment record not found." });
  }

  if (c.status !== "pending") {
    return res.status(409).json({
      error: `This record is already ${c.status}. No second credit was made.`
    });
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const changed = db.prepare(`
      UPDATE contributions
      SET status='verified',verified_by=?,verified_at=?,admin_note=?
      WHERE id=? AND status='pending'
    `).run(req.session.userId, now, note, id);

    if (changed.changes !== 1) {
      throw new Error("This payment record has already been processed.");
    }

    db.prepare(`
      INSERT INTO audit_logs(admin_id,action,target_type,target_id,details)
      VALUES(?,?,?,?,?)
    `).run(
      req.session.userId,
      "verify_and_credit_contribution",
      "contribution",
      id,
      JSON.stringify({
        amount: c.amount,
        currency: c.currency,
        reference: c.reference,
        note
      })
    );
  });

  try {
    tx();
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }

  res.json({
    ok: true,
    status: "verified",
    creditedAmount: c.amount,
    currency: c.currency,
    message: "Verified contribution total updated once."
  });
});

app.patch("/api/admin/contributions/:id/reject", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const note = clean(req.body.adminNote);

  if (!Number.isSafeInteger(id) || id < 1 || note.length < 8 || note.length > 1000) {
    return res.status(400).json({
      error: "Provide a rejection reason of at least 8 characters."
    });
  }

  const c = db.prepare("SELECT * FROM contributions WHERE id=?").get(id);

  if (!c) {
    return res.status(404).json({ error: "Payment record not found." });
  }

  if (c.status !== "pending") {
    return res.status(409).json({
      error: "Only pending payment records can be rejected."
    });
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE contributions
    SET status='rejected',rejected_by=?,rejected_at=?,admin_note=?
    WHERE id=? AND status='pending'
  `).run(req.session.userId, now, note, id);

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,target_type,target_id,details)
    VALUES(?,?,?,?,?)
  `).run(
    req.session.userId,
    "reject_contribution",
    "contribution",
    id,
    note
  );

  res.json({ ok: true, status: "rejected" });
});

app.get("/api/admin/contributions", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      c.id,c.amount,c.currency,c.reference,c.payment_method,
      c.customer_service_note,c.status,c.created_at,c.verified_at,
      c.admin_note,u.supporter_id,u.full_name,u.email,u.country
    FROM contributions c
    JOIN users u ON u.id=c.user_id
    ORDER BY
      CASE c.status WHEN 'pending' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END,
      c.id DESC
    LIMIT 500
  `).all();

  res.json({ contributions: rows });
});

app.get("/api/admin/audit-logs", requireAdmin, (req, res) => {
  res.json({
    logs: db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY id DESC
      LIMIT 500
    `).all()
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`DKP Structures running on port ${PORT}`);
});
