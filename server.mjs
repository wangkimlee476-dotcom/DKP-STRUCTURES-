import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

if (!globalThis.__DKP_ENV) dotenv.config();
const runtimeEnv=globalThis.__DKP_ENV||process.env;
const cloudflareWorker=runtimeEnv.CF_WORKER==="true";
const __dirname=cloudflareWorker?"/":path.dirname(fileURLToPath(import.meta.url));
const PgSession=connectPgSimple(session);
const {Pool,Client}=pg;
const databaseContext=new AsyncLocalStorage();
const workerRequestClients=new Map();
const app=express(),PORT=Number(runtimeEnv.PORT||3000),prod=runtimeEnv.NODE_ENV==="production";
if(!runtimeEnv.DATABASE_URL)throw new Error("DATABASE_URL is required.");
if(prod&&(!runtimeEnv.SESSION_SECRET||runtimeEnv.SESSION_SECRET.length<32))throw new Error("SESSION_SECRET must contain at least 32 characters.");
const parsed=new URL(runtimeEnv.DATABASE_URL);
const ssl=runtimeEnv.PGSSL==="true"||(runtimeEnv.PGSSL!=="false"&&!["localhost","127.0.0.1"].includes(parsed.hostname));
const pool=cloudflareWorker?{
 query(...args){const client=databaseContext.getStore();if(!client)return Promise.reject(new Error("Database query executed outside the current Worker request."));return client.query(...args)},
 async connect(){const client=databaseContext.getStore();if(!client)throw new Error("Database connection requested outside the current Worker request.");return{query:(...args)=>client.query(...args),release(){}}},
 on(){return this}
}:new Pool({connectionString:runtimeEnv.DATABASE_URL,ssl:ssl?{rejectUnauthorized:false}:false,max:10,connectionTimeoutMillis:10000});
if(!cloudflareWorker)pool.on("error",e=>console.error("PostgreSQL pool error:",e.message));
const termsVersion=runtimeEnv.TERMS_VERSION||"2026-11-10";
const clean=v=>String(v||"").trim(),emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const levels=[["Basic",100,499],["Bronze",500,1249],["Silver",1250,2999],["Gold",3000,6999],["Platinum",7000,14999],["Diamond",15000,29999],["Founding",30000,Number.MAX_SAFE_INTEGER]];
const levelFor=n=>levels.find(x=>n>=x[1]&&n<=x[2])?.[0]||"Basic";
const publicUser=u=>({id:u.id,supporterId:u.supporter_id,name:u.full_name,email:u.email,country:u.country,role:u.role,personalTarget:Number(u.personal_target||0),selectedPlan:u.selected_plan||"Basic",selectedAmount:Number(u.selected_amount||100),language:u.language||"en",theme:u.theme||"light",avatarData:u.avatar_data||null,createdAt:u.created_at});
const totalFor=async id=>Number((await pool.query("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE user_id=$1 AND status='verified'",[id])).rows[0].total);
function establish(req,res,status,payload,id){req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start session."});req.session.userId=id;req.session.save(e=>e?res.status(500).json({error:"Could not save login session."}):res.status(status).json(payload));});}
function auth(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Please sign in first."});next();}
const admin=route(async(req,res,next)=>{if(!req.session.userId)return res.status(401).json({error:"Please sign in first."});const r=await pool.query("SELECT role FROM users WHERE id=$1",[req.session.userId]);if(r.rows[0]?.role!=="admin")return res.status(403).json({error:"Administrator access required."});next();});
app.disable("x-powered-by");app.set("trust proxy",1);app.use(helmet({contentSecurityPolicy:false}));
if(cloudflareWorker)app.use((req,res,next)=>{
 const requestId=req.get("x-dkp-worker-request-id");
 const client=workerRequestClients.get(requestId);
 if(!client)return res.status(500).json({error:"Database request context is unavailable."});
 databaseContext.run(client,next);
});
/*
 * Avoid Express/body-parser's iconv-lite -> raw-body -> node:stream import
 * path in the Cloudflare Workers bundle. Parse the two supported form types
 * directly from the adapter's IncomingMessage stream instead.
 */
app.use((req,res,next)=>{
  req.body={};
  if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return next();
  const contentType=String(req.headers["content-type"]||"").split(";")[0].trim().toLowerCase();
  if(contentType!=="application/json"&&contentType!=="application/x-www-form-urlencoded")return next();
  const chunks=[];
  let size=0,finished=false;
  req.on("data",chunk=>{
    if(finished)return;
    const bytes=chunk instanceof Uint8Array?chunk:new TextEncoder().encode(String(chunk));
    size+=bytes.byteLength;
    if(size>350*1024){
      finished=true;
      res.status(413).json({error:"Request body is too large."});
      return;
    }
    chunks.push(bytes);
  });
  req.on("end",()=>{
    if(finished)return;
    try{
      const bytes=new Uint8Array(size);
      let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const bodyText=new TextDecoder().decode(bytes);
      if(contentType==="application/json"){
        req.body=bodyText?JSON.parse(bodyText):{};
        if(!req.body||typeof req.body!=="object"||Array.isArray(req.body))throw new Error("JSON body must be an object.");
      }else{
        req.body=Object.fromEntries(new URLSearchParams(bodyText));
      }
      next();
    }catch{
      res.status(400).json({error:"Request body is not valid."});
    }
  });
  req.on("error",next);
});
app.use(session({store:new PgSession({pool,tableName:"user_sessions",createTableIfMissing:false,pruneSessionInterval:cloudflareWorker?false:900}),name:"dkp.sid",secret:runtimeEnv.SESSION_SECRET||"development-only-change-this-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:prod,maxAge:28800000}}));
app.use("/api",(req,res,next)=>{if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return next();if(String(req.get("sec-fetch-site")||"").toLowerCase()==="cross-site")return res.status(403).json({error:"Cross-site requests are not allowed."});const o=req.get("origin");if(o){try{if(new URL(o).host!==req.get("host"))return res.status(403).json({error:"Request origin is not allowed."});}catch{return res.status(403).json({error:"Invalid request origin."});}}next();});
app.use("/api/",rateLimit({windowMs:900000,limit:100,standardHeaders:"draft-7",legacyHeaders:false}));if(!cloudflareWorker)app.use(express.static(path.join(__dirname,"public")));
app.get("/api/config",(req,res)=>res.json({smartsuppKey:runtimeEnv.SMARTSUPP_KEY||"",supportEmail:runtimeEnv.SUPPORT_EMAIL||"dkpstructures@gmail.com",termsVersion}));
app.get("/api/health",route(async(req,res)=>{await pool.query("SELECT 1");res.json({ok:true,service:"DKP Structures API",database:"PostgreSQL"});}));
app.post("/api/register",rateLimit({windowMs:3600000,limit:8}),route(async(req,res)=>{
 const name=clean(req.body.name),email=clean(req.body.email).toLowerCase(),country=clean(req.body.country),password=String(req.body.password||"");
 if(name.length<2||name.length>100||!emailOk(email)||country.length<2||country.length>80||password.length<12)return res.status(400).json({error:"Enter your name, valid email, country and a password of at least 12 characters."});
 if(req.body.acceptTerms!==true||req.body.termsVersion!==termsVersion)return res.status(400).json({error:"Please accept the current Terms & Conditions."});
 const hash=await bcrypt.hash(password,12),sid="DKP-"+crypto.randomBytes(4).toString("hex").toUpperCase();
 try{const ins=await pool.query("INSERT INTO users(supporter_id,full_name,email,country,password_hash,role,terms_version,terms_accepted_at) VALUES($1,$2,$3,$4,$5,'supporter',$6,NOW()) RETURNING id",[sid,name,email,country,hash,termsVersion]);const u=(await pool.query("SELECT * FROM users WHERE id=$1",[ins.rows[0].id])).rows[0];establish(req,res,201,{user:publicUser(u)},u.id);}
 catch(e){if(e.code==="23505")return res.status(409).json({error:"An account with this email already exists."});throw e;}
}));
app.post("/api/login",rateLimit({windowMs:900000,limit:10}),route(async(req,res)=>{const email=clean(req.body.email).toLowerCase(),p=String(req.body.password||"");const u=(await pool.query("SELECT * FROM users WHERE email=$1",[email])).rows[0];if(!u||!(await bcrypt.compare(p,u.password_hash)))return res.status(401).json({error:"Email or password is incorrect."});establish(req,res,200,{user:publicUser(u)},u.id);}));
app.post("/api/logout",(req,res)=>req.session.destroy(e=>{if(e)return res.status(500).json({error:"Could not sign out."});res.clearCookie("dkp.sid");res.json({ok:true});}));
app.get("/api/me",auth,route(async(req,res)=>{const u=(await pool.query("SELECT * FROM users WHERE id=$1",[req.session.userId])).rows[0];if(!u)return res.status(401).json({error:"Please sign in again."});res.json({user:publicUser(u)});}));

// Supporter account preferences and security.
const supportedLanguages = new Set(["en","id","es","fr","de","pt","ar","hi","ko","zh","ja","tr","th","vi","nl","it","ru"]);
app.patch("/api/profile/settings",auth,route(async(req,res)=>{
 const name=clean(req.body.name),country=clean(req.body.country),language=clean(req.body.language||"en"),theme=clean(req.body.theme||"light");
 const hasAvatar=Object.prototype.hasOwnProperty.call(req.body,"avatarData");
 const avatar=req.body.avatarData;
 if(name.length<2||name.length>100||country.length<2||country.length>80)return res.status(400).json({error:"Enter a valid name and country."});
 if(!supportedLanguages.has(language))return res.status(400).json({error:"Choose a supported language."});
 if(!["light","dark","system"].includes(theme))return res.status(400).json({error:"Choose a valid theme."});
 if(hasAvatar&&avatar!==null&&avatar!==""&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(avatar))||String(avatar).length>300000))return res.status(400).json({error:"Choose a PNG, JPEG or WebP image smaller than 220 KB."});
 await pool.query("UPDATE users SET full_name=$1,country=$2,language=$3,theme=$4,avatar_data=CASE WHEN $5 THEN $6 ELSE avatar_data END WHERE id=$7",[name,country,language,theme,hasAvatar,avatar||null,req.session.userId]);
 const u=(await pool.query("SELECT * FROM users WHERE id=$1",[req.session.userId])).rows[0];
 res.json({user:publicUser(u)});
}));
app.patch("/api/profile/plan",auth,route(async(req,res)=>{
 const plan=clean(req.body.plan),amount=Number(req.body.amount);
 const ranges={Basic:[100,499],Bronze:[500,1249],Silver:[1250,2999],Gold:[3000,6999],Platinum:[7000,14999],Diamond:[15000,29999],Founding:[30000,100000000]};
 if(!ranges[plan]||!Number.isFinite(amount)||amount<ranges[plan][0]||amount>ranges[plan][1])return res.status(400).json({error:"Choose an amount within the selected recognition level."});
 await pool.query("UPDATE users SET selected_plan=$1,selected_amount=$2 WHERE id=$3",[plan,amount,req.session.userId]);
 res.json({ok:true,selectedPlan:plan,selectedAmount:amount,message:"Your preference has been saved. This does not make a payment or create an obligation."});
}));
app.patch("/api/profile/email",auth,route(async(req,res)=>{
 const email=clean(req.body.newEmail).toLowerCase(),password=String(req.body.currentPassword||"");
 if(!emailOk(email)||email.length>254||!password)return res.status(400).json({error:"Enter a valid new email and your current password."});
 const u=(await pool.query("SELECT password_hash FROM users WHERE id=$1",[req.session.userId])).rows[0];
 if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Your current password is incorrect."});
 try{await pool.query("UPDATE users SET email=$1 WHERE id=$2",[email,req.session.userId]);}
 catch(e){if(e.code==="23505")return res.status(409).json({error:"That email address is already used by another account."});throw e;}
 res.json({ok:true,email,message:"Your email address has been updated."});
}));
app.patch("/api/profile/password",auth,route(async(req,res)=>{
 const current=String(req.body.currentPassword||""),next=String(req.body.newPassword||"");
 if(next.length<12||next.length>128)return res.status(400).json({error:"Your new password must be 12–128 characters long."});
 const u=(await pool.query("SELECT password_hash FROM users WHERE id=$1",[req.session.userId])).rows[0];
 if(!u||!(await bcrypt.compare(current,u.password_hash)))return res.status(401).json({error:"Your current password is incorrect."});
 await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2",[await bcrypt.hash(next,12),req.session.userId]);
 res.json({ok:true,message:"Your password has been changed."});
}));
app.post("/api/password/forgot",rateLimit({windowMs:3600000,limit:5}),route(async(req,res)=>{
 const email=clean(req.body.email).toLowerCase();
 if(!emailOk(email))return res.status(400).json({error:"Enter the email address on your account."});
 const u=(await pool.query("SELECT id,full_name,country FROM users WHERE email=$1",[email])).rows[0];
 if(u)await pool.query("INSERT INTO support_requests(user_id,name,email,country,request_type,message) VALUES($1,$2,$3,$4,'account',$5)",[u.id,u.full_name,email,u.country,"Password reset requested. Please verify the requester's control of the registered email before issuing a one-time reset link."]);
 res.json({ok:true,message:"If the address belongs to an account, a password-recovery request has been sent to the support team. The team must verify ownership before issuing a reset link."});
}));
app.post("/api/password/reset",rateLimit({windowMs:900000,limit:8}),route(async(req,res)=>{
 const token=String(req.body.token||""),password=String(req.body.newPassword||"");
 if(token.length<32||token.length>200||password.length<12||password.length>128)return res.status(400).json({error:"The reset link or new password is invalid."});
 const tokenHash=crypto.createHash("sha256").update(token).digest("hex"),c=await pool.connect();
 try{
  await c.query("BEGIN");
  const r=await c.query("SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE",[tokenHash]);
  if(!r.rowCount){await c.query("ROLLBACK");return res.status(400).json({error:"This reset link has expired or has already been used. Request a new one."});}
  await c.query("UPDATE users SET password_hash=$1 WHERE id=$2",[await bcrypt.hash(password,12),r.rows[0].user_id]);
  await c.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",[r.rows[0].user_id]);
  await c.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1",[String(r.rows[0].user_id)]);
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 res.json({ok:true,message:"Password reset complete. Please sign in with your new password."});
}));
app.post("/api/admin/users/:id/password-reset",admin,route(async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Invalid supporter account."});
 const u=(await pool.query("SELECT id,email FROM users WHERE id=$1",[id])).rows[0];if(!u)return res.status(404).json({error:"Supporter account not found."});
 const token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex");
 await pool.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",[id]);
 await pool.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,created_by) VALUES($1,$2,NOW()+INTERVAL '30 minutes',$3)",[id,hash,req.session.userId]);
 const origin="https://"+String(req.get("host")||"dkp-structures.dkpstructures.workers.dev");
 res.status(201).json({email:u.email,resetUrl:origin+"/reset-password.html?token="+encodeURIComponent(token),expiresInMinutes:30,message:"Send this one-time link only to the verified account email. It expires in 30 minutes and can be used once."});
}));

app.get("/api/dashboard",auth,route(async(req,res)=>{const u=(await pool.query("SELECT * FROM users WHERE id=$1",[req.session.userId])).rows[0];if(!u)return res.status(401).json({error:"Please sign in again."});const total=await totalFor(u.id),history=(await pool.query('SELECT amount,currency,reference,payment_method,status,created_at AS date,verified_at AS "verifiedAt" FROM contributions WHERE user_id=$1 ORDER BY id DESC LIMIT 50',[u.id])).rows.map(x=>({...x,amount:Number(x.amount)}));res.json({user:publicUser(u),verifiedTotal:total,level:levelFor(total),progress:u.personal_target?Math.min(100,Math.round(total/Number(u.personal_target)*100)):0,history,balanceMeaning:"Verified contribution total only. It is not cash held for the supporter, a bank deposit, withdrawable balance or investment account."});}));
app.patch("/api/profile/target",auth,route(async(req,res)=>{const t=Number(req.body.target);if(!Number.isFinite(t)||t<100||t>100000000)return res.status(400).json({error:"Enter a target of at least USD $100."});await pool.query("UPDATE users SET personal_target=$1 WHERE id=$2",[t,req.session.userId]);res.json({target:t});}));
app.post("/api/support-requests",rateLimit({windowMs:3600000,limit:10}),route(async(req,res)=>{const n=clean(req.body.name),e=clean(req.body.email).toLowerCase(),c=clean(req.body.country),t=clean(req.body.type),m=clean(req.body.message);if(n.length<2||!emailOk(e)||c.length<2||m.length<10||m.length>3000)return res.status(400).json({error:"Please provide your name, valid email, country and a message (10–3000 characters)."});if(!["payment_methods","general","account"].includes(t))return res.status(400).json({error:"Invalid support request type."});const r=await pool.query("INSERT INTO support_requests(user_id,name,email,country,request_type,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[req.session.userId||null,n,e,c,t,m]);res.status(201).json({ok:true,requestId:r.rows[0].id,message:"Your support request has been recorded. Please wait for the support team to reply using the contact details you supplied."});}));
app.get("/api/admin/summary",admin,route(async(req,res)=>{const r=(await pool.query("SELECT (SELECT COUNT(*) FROM users WHERE role='supporter') users,(SELECT COUNT(*) FROM support_requests WHERE status='open') open,(SELECT COUNT(*) FROM contributions WHERE status='pending') pending,(SELECT COUNT(*) FROM contributions WHERE status='rejected') rejected,(SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='verified') total")).rows[0];res.json({users:Number(r.users),openSupportRequests:Number(r.open),pendingContributions:Number(r.pending),rejectedContributions:Number(r.rejected),verifiedTotal:Number(r.total)});}));
app.get("/api/admin/users",admin,route(async(req,res)=>res.json({users:(await pool.query("SELECT id,supporter_id,full_name,email,country,role,created_at FROM users ORDER BY id DESC LIMIT 500")).rows})));
app.get("/api/admin/support-requests",admin,route(async(req,res)=>res.json({requests:(await pool.query("SELECT * FROM support_requests ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC LIMIT 500")).rows})));
app.patch("/api/admin/support-requests/:id",admin,route(async(req,res)=>{const id=Number(req.params.id),s=clean(req.body.status),note=clean(req.body.adminNote).slice(0,2000);if(!Number.isSafeInteger(id)||id<1||!["open","in_progress","closed"].includes(s))return res.status(400).json({error:"Invalid support request or status."});const c=await pool.connect();try{await c.query("BEGIN");const u=await c.query("UPDATE support_requests SET status=$1,admin_note=$2 WHERE id=$3 RETURNING id",[s,note,id]);if(!u.rowCount){await c.query("ROLLBACK");return res.status(404).json({error:"Support request not found."});}await c.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",[req.session.userId,"update_support_request","support_request",id,s]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.json({ok:true});}));
app.post("/api/admin/contributions",admin,route(async(req,res)=>{const sid=clean(req.body.supporterId),amount=Number(req.body.amount),ref=clean(req.body.reference),method=clean(req.body.paymentMethod)||"Customer service recorded",note=clean(req.body.customerServiceNote);if(!Number.isFinite(amount)||amount<100||amount>100000000||ref.length<4||ref.length>120||method.length>100||note.length<8||note.length>1000)return res.status(400).json({error:"Enter a valid amount (minimum USD $100), payment reference, payment method and customer-service confirmation."});const u=(await pool.query("SELECT id FROM users WHERE supporter_id=$1",[sid])).rows[0];if(!u)return res.status(404).json({error:"Supporter not found."});const c=await pool.connect();let id;try{await c.query("BEGIN");id=(await c.query("INSERT INTO contributions(user_id,amount,reference,payment_method,customer_service_note,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING id",[u.id,amount,ref,method,note])).rows[0].id;await c.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",[req.session.userId,"record_pending_contribution","contribution",id,JSON.stringify({reference:ref,paymentMethod:method,amount})]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.status(201).json({id,status:"pending",message:"Payment record created as pending. Do not credit the supporter until customer service independently confirms cleared funds."});}));
app.patch("/api/admin/contributions/:id/verify",admin,route(async(req,res)=>{const id=Number(req.params.id),note=clean(req.body.adminNote);if(!Number.isSafeInteger(id)||id<1||note.length<8||note.length>1000)return res.status(400).json({error:"Provide a verification note of at least 8 characters, including how payment success was confirmed."});const c=await pool.connect();let row;try{await c.query("BEGIN");row=(await c.query("SELECT * FROM contributions WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!row){await c.query("ROLLBACK");return res.status(404).json({error:"Payment record not found."});}if(row.status!=="pending"){await c.query("ROLLBACK");return res.status(409).json({error:"This record has already been processed. No second credit was made."});}await c.query("UPDATE contributions SET status='verified',verified_by=$1,verified_at=NOW(),admin_note=$2 WHERE id=$3",[req.session.userId,note,id]);await c.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",[req.session.userId,"verify_and_credit_contribution","contribution",id,JSON.stringify({amount:Number(row.amount),currency:row.currency,reference:row.reference,note})]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.json({ok:true,status:"verified",creditedAmount:Number(row.amount),currency:row.currency,message:"Verified contribution total updated once."});}));
app.patch("/api/admin/contributions/:id/reject",admin,route(async(req,res)=>{const id=Number(req.params.id),note=clean(req.body.adminNote);if(!Number.isSafeInteger(id)||id<1||note.length<8||note.length>1000)return res.status(400).json({error:"Provide a rejection reason of at least 8 characters."});const c=await pool.connect();try{await c.query("BEGIN");const row=(await c.query("SELECT status FROM contributions WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!row){await c.query("ROLLBACK");return res.status(404).json({error:"Payment record not found."});}if(row.status!=="pending"){await c.query("ROLLBACK");return res.status(409).json({error:"Only pending payment records can be rejected."});}await c.query("UPDATE contributions SET status='rejected',rejected_by=$1,rejected_at=NOW(),admin_note=$2 WHERE id=$3",[req.session.userId,note,id]);await c.query("INSERT INTO audit_logs(admin_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",[req.session.userId,"reject_contribution","contribution",id,note]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.json({ok:true,status:"rejected"});}));
app.get("/api/admin/contributions",admin,route(async(req,res)=>{const r=await pool.query("SELECT c.id,c.amount,c.currency,c.reference,c.payment_method,c.customer_service_note,c.status,c.created_at,c.verified_at,c.admin_note,u.supporter_id,u.full_name,u.email,u.country FROM contributions c JOIN users u ON u.id=c.user_id ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END,c.id DESC LIMIT 500");res.json({contributions:r.rows.map(x=>({...x,amount:Number(x.amount)}))});}));
app.get("/api/admin/audit-logs",admin,route(async(req,res)=>res.json({logs:(await pool.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500")).rows})));
app.use("/api",(req,res)=>res.status(404).json({error:"API route not found."}));if(!cloudflareWorker)app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{console.error("Request failed:",{path:req.path,method:req.method,message:err?.message,code:err?.code});if(res.headersSent)return next(err);res.status(500).json({error:"An unexpected server error occurred.",diagnostic:{path:req.path,message:String(err?.message||"Unknown error").slice(0,240),code:err?.code||null}});});
async function init(){await pool.query("CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,supporter_id VARCHAR(32) UNIQUE NOT NULL,full_name VARCHAR(100) NOT NULL,email VARCHAR(254) UNIQUE NOT NULL,country VARCHAR(80) NOT NULL,password_hash TEXT NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'supporter' CHECK(role IN ('supporter','admin')),personal_target DOUBLE PRECISION NOT NULL DEFAULT 0,terms_version VARCHAR(40) NOT NULL,terms_accepted_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS contributions(id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),amount NUMERIC(14,2) NOT NULL CHECK(amount>=100),currency VARCHAR(3) NOT NULL DEFAULT 'USD',reference VARCHAR(120) NOT NULL,payment_method VARCHAR(100) NOT NULL DEFAULT 'Customer service recorded',customer_service_note VARCHAR(1000) NOT NULL DEFAULT '',status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),verified_by INTEGER REFERENCES users(id),verified_at TIMESTAMPTZ,rejected_by INTEGER REFERENCES users(id),rejected_at TIMESTAMPTZ,admin_note VARCHAR(1000) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS support_requests(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id),name VARCHAR(100) NOT NULL,email VARCHAR(254) NOT NULL,country VARCHAR(80) NOT NULL,request_type VARCHAR(30) NOT NULL,message VARCHAR(3000) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'open',admin_note VARCHAR(2000),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS audit_logs(id SERIAL PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES users(id),action VARCHAR(100) NOT NULL,target_type VARCHAR(50) NOT NULL,target_id INTEGER,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_plan VARCHAR(40) NOT NULL DEFAULT 'Basic';ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_amount NUMERIC(14,2) NOT NULL DEFAULT 100;ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(12) NOT NULL DEFAULT 'en';ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(12) NOT NULL DEFAULT 'light';ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT;CREATE TABLE IF NOT EXISTS password_reset_tokens(id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash VARCHAR(64) NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id,expires_at DESC);CREATE INDEX IF NOT EXISTS idx_contributions_user_status ON contributions(user_id,status);CREATE INDEX IF NOT EXISTS idx_contributions_status_created ON contributions(status,created_at DESC);CREATE INDEX IF NOT EXISTS idx_support_requests_status_created ON support_requests(status,created_at DESC)");}
if(!cloudflareWorker)init().then(()=>app.listen(PORT,()=>console.log("DKP Structures running on port "+PORT+" with PostgreSQL"))).catch(e=>{console.error("PostgreSQL initialisation failed:",e);process.exit(1);});
if(!cloudflareWorker)process.on("SIGTERM",async()=>{await pool.end();process.exit(0);});
export function withWorkerDatabaseClient(client,handler){
 return databaseContext.run(client,handler);
}
export async function withWorkerDatabase(connectionString,handler){
 const client=new Client({connectionString});
 await client.connect();
 const requestId=crypto.randomUUID();
 workerRequestClients.set(requestId,client);
 try{return await handler(requestId)}
 finally{workerRequestClients.delete(requestId)}
}
export { app, init, pool };
