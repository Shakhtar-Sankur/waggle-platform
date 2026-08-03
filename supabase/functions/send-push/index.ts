// Supabase Edge Function: send-push
// Sends Firebase Cloud Messaging (FCM HTTP v1) push notifications to all of a
// user's registered devices. Designed to be called either from a database
// trigger (via pg_net) or directly with the service role / a shared secret.
//
// Required function secrets (set with `supabase secrets set ...`):
//   FCM_PROJECT_ID       - Firebase project id
//   FCM_CLIENT_EMAIL     - service account client_email
//   FCM_PRIVATE_KEY      - service account private_key (PEM, keep the \n)
//   PUSH_WEBHOOK_SECRET  - shared secret the DB trigger sends in x-webhook-secret
// Automatically provided by Supabase:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface PushRequest {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Authorize the caller: allow the service role bearer token OR the shared
  // webhook secret used by the database trigger.
  const authHeader = req.headers.get("authorization") ?? "";
  const webhookSecret = req.headers.get("x-webhook-secret") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  const authorized =
    (expectedSecret && webhookSecret === expectedSecret) ||
    (serviceKey && authHeader === `Bearer ${serviceKey}`);
  if (!authorized) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: PushRequest;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.userId || !payload.title || !payload.body) {
    return json({ error: "userId, title and body are required" }, 400);
  }

  const { data: tokens, error } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("user_id", payload.userId);
  if (error) {
    return json({ error: `Could not load device tokens: ${error.message}` }, 500);
  }
  if (!tokens || tokens.length === 0) {
    return json({ sent: 0, message: "No devices registered for user" }, 200);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    return json({ error: `FCM auth failed: ${String(err)}` }, 500);
  }

  const projectId = Deno.env.get("FCM_PROJECT_ID")!;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  let sent = 0;
  const staleTokens: string[] = [];

  for (const { token } of tokens) {
    const message = {
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { priority: "high", notification: { sound: "default" } },
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (res.ok) {
      sent += 1;
    } else {
      // 404 UNREGISTERED / 400 INVALID_ARGUMENT => token is dead, prune it.
      if (res.status === 404 || res.status === 400) {
        staleTokens.push(token);
      }
      console.warn(`FCM send failed (${res.status}) for token ${token.slice(0, 12)}…`);
    }
  }

  if (staleTokens.length > 0) {
    await supabase.from("device_tokens").delete().in("token", staleTokens);
  }

  return json({ sent, pruned: staleTokens.length, total: tokens.length }, 200);
});

// --- Google service-account OAuth (RS256 JWT -> access token) ---

async function getAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL")!;
  const privateKeyPem = (Deno.env.get("FCM_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claim));
  const unsigned = `${encodedHeader}.${encodedClaim}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64urlBytes(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(input: string): string {
  return base64urlBytes(new TextEncoder().encode(input));
}

function base64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
