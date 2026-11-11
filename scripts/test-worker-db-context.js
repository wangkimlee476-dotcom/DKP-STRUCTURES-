"use strict";

const assert = require("node:assert/strict");

globalThis.__DKP_ENV = {
  NODE_ENV: "production",
  CF_WORKER: "true",
  DATABASE_URL: "postgres://test:test@localhost:5432/dkp_test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters"
};

async function main() {
  const { pool, withWorkerDatabaseClient } = await import("../server.mjs");

  const fakeClient = id => ({
    async query() {
      await Promise.resolve();
      return { rows: [{ requestId: id }] };
    }
  });

  async function request(id, waitMs) {
    return withWorkerDatabaseClient(fakeClient(id), async () => {
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      const direct = await pool.query("SELECT request scope");
      const transactionClient = await pool.connect();
      try {
        await transactionClient.query("BEGIN");
        const transactional = await transactionClient.query("SELECT transaction scope");
        await transactionClient.query("COMMIT");
        return [direct.rows[0].requestId, transactional.rows[0].requestId];
      } finally {
        transactionClient.release();
      }
    });
  }

  const results = await Promise.all([
    request("request-A", 8),
    request("request-B", 0)
  ]);

  assert.deepEqual(results, [
    ["request-A", "request-A"],
    ["request-B", "request-B"]
  ]);
  await assert.rejects(
    () => pool.query("SELECT outside request"),
    /outside the current Worker request/
  );

  console.log("Worker database context checks passed: isolated request clients, session queries and transaction clients.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
