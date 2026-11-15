const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const files = ["public/index.html", "public/admin.html"];
let checked = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const blocks = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi));
  if (!blocks.length) throw new Error("No inline script blocks found in " + file);

  blocks.forEach((match, index) => {
    const result = spawnSync(process.execPath, ["--check", "-"], {
      input: match[1],
      encoding: "utf8"
    });
    if (result.status !== 0) {
      process.stderr.write(file + " inline script " + (index + 1) + " failed:\n");
      process.stderr.write(result.stderr || result.stdout || "Unknown syntax error.\n");
      process.exitCode = 1;
    }
    checked += 1;
  });
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write("Syntax checked " + checked + " inline browser script(s).\n");
