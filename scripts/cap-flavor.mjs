// Runs a command as one app flavour: `node scripts/cap-flavor.mjs business cap sync android`
// or `node scripts/cap-flavor.mjs business vite build --outDir dist-business`.
//
// npm scripts on Windows cannot set an environment variable inline, so this does
// it. The flavour travels as an environment variable rather than a Vite mode on
// purpose: `vite build --mode business` skips .env.production, which let
// .env.local (the Docker stack on this computer, 127.0.0.1) into the phone build.
import { spawnSync } from "node:child_process";

const [flavor, ...command] = process.argv.slice(2);
if (!["gig", "business", "waggle"].includes(flavor) || !command.length) {
  console.error("usage: node scripts/cap-flavor.mjs <gig|business|waggle> <command…>");
  process.exit(2);
}

const result = spawnSync("npx", command, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CAP_FLAVOR: flavor, VITE_APP_FLAVOR: flavor },
});
process.exit(result.status ?? 1);
