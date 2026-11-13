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
const packageJson = JSON.parse(read("package.json"));
const deployGuide = read("CLOUDFLARE_DEPLOY.md");
const readinessChecklist = read("DEPLOYMENT_CHECKLIST.md");
const routes = [...server.matchAll(/app\.(?:get|post|patch|put|delete)\(["']([^"']+)["']/g)].map(match => match[1]);
const requiredRoutes = ["/api/dashboard","/api/profile/plan","/api/profile/target","/api/profile/settings","/api/profile/email","/api/profile/password","/api/password/forgot","/api/password/reset","/api/support-requests","/api/contributions/submit","/api/admin/summary","/api/admin/users","/api/admin/contributions","/api/admin/contributions/:id/verify","/api/admin/contributions/:id/reject","/api/admin/referrals"];
for (const route of requiredRoutes) if (!routes.includes(route)) throw new Error("Missing server route: " + route);
const requiredUi = [
  [dashboard,'api("/api/dashboard"'],[dashboard,'api("/api/profile/plan"'],[dashboard,'api("/api/profile/target"'],
  [dashboard,'api("/api/profile/settings"'],[dashboard,'api("/api/profile/email"'],[dashboard,'api("/api/profile/password"'],
  [dashboard,'id="copyId"'],[dashboard,'id="copyIdSettings"'],[dashboard,'id="avatarFile"'],[dashboard,'id="adminEntry"'],[dashboard,'id="saveProfile"'],[dashboard,'id="saveEmail"'],[dashboard,'id="savePassword"'],[dashboard,'id="confirmPassword"'],[dashboard,'value="ar"'],[dashboard,"Your support is entirely voluntary."],[dashboard,"Contributions do not currently provide ownership, guaranteed dividends or financial returns."],[dashboard,"may explore legally approved dividend arrangements"],[index,"potential dividend arrangements where permitted."],[index,"do not currently provide ownership, guaranteed dividends, financial returns, employment or entitlement to free construction services."],
  [index,'location.replace("/dashboard.html")'],[index,'href="/forgot-password.html"'],
  [forgot,'/api/password/forgot'],[reset,'/api/password/reset'],[admin,'/api/admin/contributions']
];
for (const [source,needle] of requiredUi) if (!source.includes(needle)) throw new Error("Missing UI/API contract: " + needle);
if (admin.includes("$('create').onsubmit") || admin.includes('$("create").onsubmit')) throw new Error("Admin board must not bind a removed payment-creation form.");
if (!worker.includes("await initializeDatabase(init)") || !worker.includes('schema: "ready"')) throw new Error("Worker must initialize PostgreSQL schema before serving API requests and report schema readiness.");
if (!admin.includes('id="manualCreditForm"') || !admin.includes("api('/api/admin/contributions'") || !server.includes('app.post("/api/admin/contributions"')) throw new Error("Admin must support User ID-based pending payment entry.");
if (!dashboard.includes('class="sidebar"') || !admin.includes('class="sidebar"')) throw new Error("Supporter and admin portals must include the approved sidebar navigation.");
if (!index.includes("--g:#14263d") || !dashboard.includes("--green:#14263d") || !admin.includes("--green:#14263d")) throw new Error("Corporate navy and champagne-gold identity is missing from one or more portals.");
if (!server.includes("idx_contributions_active_reference")) throw new Error("Active contribution references must be unique at the database level.");
if (!worker.includes('import { httpServerHandler } from "cloudflare:node"') || !worker.includes("const server = createServer(app)") || !worker.includes("const nodeHandler = httpServerHandler(server)") || !worker.includes("nodeHandler.fetch(request, env, ctx)") || !worker.includes('typeof nodeHandler.fetch !== "function"') || !worker.includes("withWorkerDatabase(env.HYPERDRIVE.connectionString")) throw new Error("Worker must expose Express through Cloudflare's Fetch-compatible HTTP server handler and use a request-scoped Hyperdrive client.");
if (!server.includes("new AsyncLocalStorage()") || !server.includes("databaseContext.run(client,handler)") || !server.includes("pruneSessionInterval:cloudflareWorker?false:900") || server.includes("workerRequestClients")) throw new Error("Worker database access must remain request-scoped for the full adapter call and background session pruning must be disabled.");
if (worker.includes("nodeServer.listen(") || worker.includes("handleAsNodeRequest(") || worker.includes("app.listen(8787)")) throw new Error("Legacy HTTP adapter startup must not be present.");
if (!wrangler.includes('"binding": "HYPERDRIVE"') || !wrangler.includes('"binding": "ASSETS"')) throw new Error("Required Cloudflare bindings are missing.");
if (!wrangler.includes('"previews"') || !wrangler.includes('"hyperdrive"')) throw new Error("Wrangler preview Hyperdrive configuration is missing.");
if (packageJson.scripts?.deploy !== "bunx wrangler@4.160.0 deploy" || packageJson.scripts?.preview !== "bunx wrangler@4.160.0 dev" || packageJson.scripts?.["deploy:check"] !== "bunx wrangler@4.160.0 deploy --dry-run") throw new Error("Deployment scripts must use wrangler deploy for production and wrangler dev for local preview.");
if (deployGuide.includes("feature/cloudflare-workers") || !deployGuide.includes("rebuild/professional-functional") || !deployGuide.includes("npx wrangler@4.160.0 deploy")) throw new Error("Cloudflare deployment guide contains an outdated branch or deploy command.");
if (!readinessChecklist.includes("does not automatically email a reset link") || !readinessChecklist.includes("Do not launch for real supporters")) throw new Error("Production checklist must disclose current password-recovery and launch-readiness limitations.");
if (!server.includes("referral_code") || !server.includes("CREATE TABLE IF NOT EXISTS referrals") || !server.includes("idx_users_referral_code")) throw new Error("Supporter referral schema and unique codes are missing.");
if (!dashboard.includes('id="referrals"') || !dashboard.includes('id="copyReferralLink"') || !dashboard.includes('id="shareReferralWhatsApp"') || !index.includes('referralCode: f.get("referralCode")')) throw new Error("Supporter referral invitation UI is incomplete.");
if (!admin.includes("/api/admin/referrals") || !admin.includes('id="referrals"')) throw new Error("Admin referral reporting is missing.");
console.log("Platform contract checks passed: Worker bridge, account routes, supporter dashboard, password recovery, admin board and Cloudflare bindings.");
