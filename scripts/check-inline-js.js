const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("public/index.html", "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (const [, attributes, source] of scripts) {
  if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
  new vm.Script(source, { filename: \`public/index.html:inline-script-\${++checked}.js\` });
}
if (!checked) throw new Error("No inline JavaScript blocks were found to validate.");
console.log(\`Validated \${checked} inline JavaScript block(s).\`);
