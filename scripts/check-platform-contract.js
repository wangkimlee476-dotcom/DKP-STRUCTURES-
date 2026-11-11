const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const server = read("server.mjs");
const worker = read("worker.mjs");
const dashboard = read("public/dashboard.html");
const index = read("public/index.html");
const admin = read("public/admin.html");
const forgot = read("public/forgot-password.html");
const reset = read("public/reset-password.html");
const wrangler = read("wrangler.jsonc");
const routes = [...server.matchAll(/app\.(?:get|post|patch|put|delete)\(["']([^"']+)["']/g)].map(match => match[1]);
const requiredRoutes = ["/api/dashboard","/api/profile/plan","/api/profile/target","/api/profile/settings","/api/profile/email","/api/profile/password","/api/password/forgot","/api/password/reset","/api/support-requests","/api/admin/summary","/api/admin/users","/api/admin/contributions","/api/admin/contributions/:id/verify","/api/admin/contributions/:id/reject"];
for (const route of requiredRoutes) if (!routes.includes(route)) throw new Error("Missing server route: " + route);
const requiredUi = [
  [dashboard,'api("/api/dashboard"'],[dashboard,'api("/api/profile/plan"'],[dashboard,'api("/api/profile/target"'],
  [dashboard,'api("/api/profile/settings"'],[dashboard,'api("/api/profile/email"'],[dashboard,'api("/api/profile/password"'],
  [dashboard,'id="copyId"'],[dashboard,'id="copyIdSettings"'],[dashboard,'id="avatarFile"'],[dashboard,'id="adminEntry"'],[dashboard,'id="saveProfile"'],[dashboard,'id="saveEmail"'],[dashboard,'id="savePassword"'],[dashboard,'id="confirmPassword"'],[dashboard,'value="ar"'],[dashboard,"Your support is entirely voluntary."],[dashboard,"No financial return, ownership, employment, reward or other benefit is promised."],[dashboard,"we intend to remember and acknowledge"],
  [index,'location.replace("/dashboard.html")'],[index,'href="/forgot-password.html"'],
  [forgot,'/api/password/forgot'],[reset,'/api/password/reset'],[admin,'/api/admin/contributions']
];
for (const [source,needle] of requiredUi) if (!source.includes(needle)) throw new Error("Missing UI/API contract: " + needle);
if (!worker.includes("handleAsNodeRequest(8787, request)") || !worker.includes("app.listen(8787)") || !worker.includes("withWorkerDatabase(env.HYPERDRIVE.connectionString")) throw new Error("Worker must start Express and use a request-scoped Hyperdrive client.");
if (!server.includes("new AsyncLocalStorage()") || !server.includes("workerRequestClients.get(requestId)") || !server.includes("pruneSessionInterval:cloudflareWorker?false:900") || !worker.includes("x-dkp-worker-request-id")) throw new Error("Worker database access must be request-scoped and background session pruning must be disabled.");
if (worker.includes("nodeServer.listen(") || worker.includes("httpServerHandler")) throw new Error("Legacy HTTP adapter must not be present.");
if (!wrangler.includes('"binding": "HYPERDRIVE"') || !wrangler.includes('"binding": "ASSETS"')) throw new Error("Required Cloudflare bindings are missing.");
console.log("Platform contract checks passed: Worker bridge, account routes, supporter dashboard, password recovery, admin board and Cloudflare bindings.");
