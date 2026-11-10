"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "node_modules");
const blockedBrowserEntries = new Set([
  "stream",
  "./lib/streams",
  "./lib/extend-node"
]);

function patchPackage(packageJsonPath) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }

  if (pkg.name !== "iconv-lite" || !pkg.browser || typeof pkg.browser !== "object") {
    return false;
  }

  let changed = false;
  for (const key of blockedBrowserEntries) {
    if (Object.prototype.hasOwnProperty.call(pkg.browser, key)) {
      delete pkg.browser[key];
      changed = true;
    }
  }

  if (!changed) return false;
  if (Object.keys(pkg.browser).length === 0) delete pkg.browser;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Patched iconv-lite browser metadata:", packageJsonPath);
  return true;
}

function walk(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (entry.name === "iconv-lite") {
      count += Number(patchPackage(path.join(child, "package.json")));
      continue;
    }
    // Search scoped packages and nested dependency trees, but not package contents.
    if (entry.name.startsWith("@") || entry.name === "node_modules") {
      count += walk(child);
    }
  }
  return count;
}

if (!fs.existsSync(root)) {
  console.log("node_modules is not present; skipping Cloudflare dependency patch.");
  process.exit(0);
}

const patched = walk(root);
console.log(patched
  ? `Applied Cloudflare iconv-lite compatibility patch to ${patched} package(s).`
  : "No affected iconv-lite browser metadata found; no patch needed.");
