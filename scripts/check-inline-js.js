const fs = require("node:fs");
const vm = require("node:vm");

let checked = 0;
for (const page of ["public/index.html", "public/dashboard.html"]) {
  const html = fs.readFileSync(page, "utf8");
  const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
  for (const [, attributes, source] of scripts) {
    if (/\\bsrc\\s*=/.test(attributes) || !source.trim()) continue;
    checked += 1;
    new vm.Script(source, { filename: page + ":inline-script-" + checked + ".js" });
  }
}
if (!checked) throw new Error("No inline JavaScript blocks were found to validate.");
console.log("Validated " + checked + " inline JavaScript block(s) across both pages.");
