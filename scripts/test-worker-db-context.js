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

  const clients = [];
  const fakeClient = id => {
    const client = {
      closed: false,
      async query() {
        if (client.closed) throw new Error("Query attempted after request client was closed.");
        await Promise.resolve();
        return { rows: [{ requestId: id }] };
      },
      async end() {
        client.closed = true;
      }
    };
    clients.push(client);
    return client;
  };

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
  assert.equal(clients.length, 2);
  assert.ok(clients.every(client => client.closed), "Each request-scoped PostgreSQL client must be closed after its handler completes.");

  const failingClient = fakeClient("request-fails");
  await assert.rejects(
    () => withWorkerDatabaseClient(failingClient, async () => {
      throw new Error("simulated request failure");
    }),
    /simulated request failure/
  );
  assert.equal(failingClient.closed, true, "The request-scoped PostgreSQL client must also close when the handler throws.");

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
