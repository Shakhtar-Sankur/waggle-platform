// Set the four push secrets on Supabase, reading the Firebase service-account
// key straight from its JSON file.
//
// Why this exists: FCM_PRIVATE_KEY is a ~1700-character PEM full of \n escapes.
// Copying it by hand through a terminal is the step that breaks most push
// setups — a stray line break or a lost quote and JWT signing fails with a
// misleading error.
//
// Why it writes a temp env file rather than passing the key as an argument:
// Node >=18.20 refuses to spawn .cmd files without shell:true (EINVAL, a
// command-injection mitigation), and going through the shell would hand the PEM
// to cmd.exe to re-parse — the very mangling this script exists to prevent.
// So the key goes into a temp dotenv file, only its PATH crosses the shell, and
// the file is deleted afterwards even if the command fails.
//
// Usage (from the repo root):
//   node supabase/set-push-secrets.mjs "<path-to-service-account.json>" "<webhook-secret>"
//
// Prerequisites: npx.cmd supabase login && npx.cmd supabase link --project-ref <ref>

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const [, , keyPath, webhookSecret] = process.argv;

if (!keyPath || !webhookSecret) {
  console.error(
    "\nUsage:\n  node supabase/set-push-secrets.mjs <path-to-service-account.json> <webhook-secret>\n",
  );
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(readFileSync(keyPath, "utf8"));
} catch (error) {
  console.error(`\n  x Could not read ${keyPath}\n    ${error.message}\n`);
  process.exit(1);
}

if (sa.type !== "service_account" || !sa.private_key || !sa.client_email || !sa.project_id) {
  console.error(
    "\n  x That file is not a Firebase service-account key.\n" +
      "    You may have picked google-services.json by mistake — that is the APP\n" +
      "    config. You need Project settings -> Service accounts -> Generate new\n" +
      "    private key.\n",
  );
  process.exit(1);
}

// Escaped form. The edge function does .replace(/\\n/g, "\n"); a value with real
// newlines also works there (the replace is simply a no-op), so either is safe —
// but escaped keeps the dotenv file to one line per secret.
const escapedKey = sa.private_key.replace(/\r?\n/g, "\\n");

console.log("Setting secrets for:");
console.log("  FCM_PROJECT_ID      =", sa.project_id);
console.log("  FCM_CLIENT_EMAIL    =", sa.client_email);
console.log("  FCM_PRIVATE_KEY     = <hidden>", `(${sa.private_key.length} chars)`);
console.log("  PUSH_WEBHOOK_SECRET =", webhookSecret);
console.log("");

const envPath = join(tmpdir(), `bz-push-${randomBytes(6).toString("hex")}.env`);
writeFileSync(
  envPath,
  [
    `FCM_PROJECT_ID=${sa.project_id}`,
    `FCM_CLIENT_EMAIL=${sa.client_email}`,
    `FCM_PRIVATE_KEY="${escapedKey}"`,
    `PUSH_WEBHOOK_SECRET=${webhookSecret}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

let status = 1;
try {
  const isWindows = process.platform === "win32";
  const result = spawnSync(
    isWindows ? "npx.cmd" : "npx",
    ["supabase", "secrets", "set", "--env-file", envPath],
    // shell:true is required on Windows to launch a .cmd at all. Only the temp
    // file PATH is passed here, never the key itself, so shell re-parsing is
    // harmless.
    { stdio: "inherit", shell: isWindows },
  );
  if (result.error) {
    console.error(`\n  x Could not run the Supabase CLI: ${result.error.code ?? ""} ${result.error.message}`);
  }
  status = result.status ?? 1;
} finally {
  // The temp file holds a live private key — remove it whatever happened.
  try {
    unlinkSync(envPath);
  } catch {
    console.error(`  ! Could not delete the temp file, please remove it: ${envPath}`);
  }
}

if (status !== 0) {
  console.error(
    "\n  x supabase secrets set failed (exit " + status + ").\n" +
      "    If it says you are not logged in or linked:\n" +
      "      npx.cmd supabase login\n" +
      "      npx.cmd supabase link --project-ref rqzuuvlougzhynckvqzd\n",
  );
  process.exit(status);
}

console.log("\n  OK - secrets set. Next:  npx.cmd supabase functions deploy send-push\n");
