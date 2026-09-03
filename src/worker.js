const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API_URL = "https://oauth.reddit.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/auth/reddit" && request.method === "GET") {
        return beginLogin(request, env);
      }
      if (url.pathname === "/auth/reddit/callback" && request.method === "GET") {
        return finishLogin(request, env);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        return getMe(request, env);
      }
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return submitPost(request, env);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        assertSameOrigin(request);
        return json({ ok: true }, 200, {
          "Set-Cookie": clearCookie("reddit_session", request),
        });
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
        return json({ error: "Nicht gefunden." }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = status === 500 ? "Der Server konnte die Anfrage nicht verarbeiten." : error.message;
      console.error(error);
      return json({ error: message }, status);
    }
  },
};

async function beginLogin(request, env) {
  requireConfig(env);
  const state = crypto.randomUUID();
  const stateCookie = await seal({ state, expires: Date.now() + 10 * 60_000 }, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: env.REDDIT_CLIENT_ID,
    response_type: "code",
    state,
    redirect_uri: env.REDDIT_REDIRECT_URI,
    duration: "permanent",
    scope: "identity submit",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${REDDIT_AUTHORIZE_URL}?${params}`,
      "Set-Cookie": makeCookie("reddit_oauth_state", stateCookie, request, 600),
      "Cache-Control": "no-store",
    },
  });
}

async function finishLogin(request, env) {
  requireConfig(env);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) return redirectWithStatus(request, `login_error=${encodeURIComponent(error)}`);

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const stateToken = readCookie(request, "reddit_oauth_state");
  const savedState = stateToken ? await unseal(stateToken, env.SESSION_SECRET) : null;
  if (!code || !returnedState || !savedState || savedState.expires < Date.now() || savedState.state !== returnedState) {
    return redirectWithStatus(request, "login_error=state");
  }

  const token = await tokenRequest(env, new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.REDDIT_REDIRECT_URI,
  }));
  if (!token.refresh_token) throw new HttpError(502, "Reddit hat keine dauerhafte Anmeldung zurückgegeben.");

  const session = await seal({ refreshToken: token.refresh_token, created: Date.now() }, env.SESSION_SECRET);
  const headers = new Headers({
    Location: `${new URL(request.url).origin}/?connected=1`,
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", makeCookie("reddit_session", session, request, 60 * 60 * 24 * 180));
  headers.append("Set-Cookie", clearCookie("reddit_oauth_state", request));
  return new Response(null, { status: 302, headers });
}

async function getMe(request, env) {
  const accessToken = await getAccessToken(request, env);
  const response = await redditFetch("/api/v1/me", accessToken, env);
  if (!response.ok) throw new HttpError(502, "Reddit konnte das Konto nicht laden.");
  const account = await response.json();
  return json({ connected: true, name: account.name, icon: account.snoovatar_img || account.icon_img || "" });
}

async function submitPost(request, env) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, "Die Beitragsdaten fehlen.");

  const subreddit = cleanSubreddit(body.subreddit);
  const title = String(body.title || "").trim();
  const kind = body.kind === "link" ? "link" : "self";
  const content = String(kind === "link" ? body.url || "" : body.text || "").trim();

  if (!subreddit) throw new HttpError(400, "Bitte ein gültiges Subreddit eingeben.");
  if (!title || title.length > 300) throw new HttpError(400, "Der Titel muss zwischen 1 und 300 Zeichen lang sein.");
  if (kind === "link" && !isHttpUrl(content)) throw new HttpError(400, "Bitte eine vollständige http- oder https-Adresse eingeben.");
  if (kind === "self" && content.length > 40_000) throw new HttpError(400, "Der Text ist zu lang.");

  const accessToken = await getAccessToken(request, env);
  const params = new URLSearchParams({
    api_type: "json",
    sr: subreddit,
    title,
    kind,
    resubmit: "true",
    sendreplies: "true",
    nsfw: body.nsfw ? "true" : "false",
    spoiler: body.spoiler ? "true" : "false",
  });
  params.set(kind === "link" ? "url" : "text", content);

  const response = await redditFetch("/api/submit", accessToken, env, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const result = await response.json().catch(() => ({}));
  const errors = result?.json?.errors || [];
  if (!response.ok || errors.length) {
    const detail = errors.map((entry) => entry[1]).filter(Boolean).join(" ");
    throw new HttpError(400, detail || "Reddit hat den Beitrag abgelehnt. Prüfe die Regeln des Subreddits.");
  }

  const postUrl = result?.json?.data?.url;
  return json({ ok: true, url: postUrl || `https://www.reddit.com/r/${subreddit}/new/` });
}

async function getAccessToken(request, env) {
  requireConfig(env);
  const token = readCookie(request, "reddit_session");
  const session = token ? await unseal(token, env.SESSION_SECRET) : null;
  if (!session?.refreshToken) throw new HttpError(401, "Bitte zuerst mit Reddit verbinden.");
  const refreshed = await tokenRequest(env, new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  }));
  if (!refreshed.access_token) throw new HttpError(401, "Die Reddit-Anmeldung ist abgelaufen. Bitte erneut verbinden.");
  return refreshed.access_token;
}

async function tokenRequest(env, body) {
  const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const response = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(env),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new HttpError(401, "Reddit konnte die Anmeldung nicht bestätigen.");
  return data;
}

function redditFetch(path, accessToken, env, options = {}) {
  return fetch(`${REDDIT_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": userAgent(env),
      ...(options.headers || {}),
    },
  });
}

function userAgent(env) {
  return env.APP_USER_AGENT || "web:reddit-poster:v1.0.0";
}

function requireConfig(env) {
  const missing = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_REDIRECT_URI", "SESSION_SECRET"].filter((key) => !env[key]);
  if (missing.length) throw new HttpError(503, `Einrichtung unvollständig: ${missing.join(", ")}`);
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Diese Anfrage wurde blockiert.");
}

function cleanSubreddit(value) {
  return String(value || "").trim().replace(/^r\//i, "").replace(/^\/r\//i, "").match(/^[A-Za-z0-9_]{2,21}$/)?.[0] || "";
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function redirectWithStatus(request, query) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${new URL(request.url).origin}/?${query}`,
      "Set-Cookie": clearCookie("reddit_oauth_state", request),
    },
  });
}

function readCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function makeCookie(name, value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie(name, request) {
  return makeCookie(name, "", request, 0);
}

async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const merged = new Uint8Array(iv.length + cipher.length);
  merged.set(iv);
  merged.set(cipher, iv.length);
  return base64UrlEncode(merged);
}

async function unseal(token, secret) {
  try {
    const bytes = base64UrlDecode(token);
    const key = await encryptionKey(secret);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
