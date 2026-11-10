require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: npm run admin:promote -- owner@example.com");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
  });
  try {
    const result = await pool.query(
      "UPDATE users SET role='admin' WHERE email=$1 RETURNING id,email,role",
      [email]
    );
    if (!result.rowCount) throw new Error("No account found for that email. Register the owner account first.");
    process.stdout.write("Administrator role granted to " + result.rows[0].email + ".\n");
  } finally {
    await pool.end();
  }
}
main().catch(error => {
  process.stderr.write(error.message + "\n");
  process.exit(1);
});
