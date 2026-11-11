const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const htmlFiles = fs.readdirSync(publicDir).filter(name => name.endsWith(".html"));
let checked = 0;

for (const name of htmlFiles) {
  const html = fs.readFileSync(path.join(publicDir, name), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attributes, source] of scripts) {
    if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
    checked += 1;
    new vm.Script(source, { filename: "public/" + name + ":inline-script-" + checked + ".js" });
  }
}

if (!checked) throw new Error("No inline JavaScript blocks were found to validate.");
console.log("Validated " + checked + " inline JavaScript block(s) across " + htmlFiles.length + " HTML file(s).");
