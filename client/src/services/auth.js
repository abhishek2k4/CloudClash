const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORAGE_KEY = "cloudclash.auth.session";
let refreshPromise = null;

function ensureConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Account sign-in is not configured yet. Add the Supabase URL and anon key to the frontend environment.");
  }
}

async function authRequest(path, body, token) {
  ensureConfigured();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.message || data.error_description || data.error || "Authentication failed.");
  }
  return data;
}

function normalizeSession(data) {
  if (!data?.access_token || !data?.refresh_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: data.user || null
  };
}

function saveSession(session) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export async function signUp(email, password) {
  const data = await authRequest("signup", { email, password });
  const session = normalizeSession(data);
  if (session) saveSession(session);
  return { session, needsEmailConfirmation: !session };
}

export async function signIn(email, password) {
  const data = await authRequest("token?grant_type=password", { email, password });
  const session = normalizeSession(data);
  if (!session) throw new Error("Supabase did not return a valid session.");
  saveSession(session);
  return session;
}

export async function getSession() {
  ensureConfigured();
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    stored = null;
  }
  if (!stored?.accessToken || !stored?.refreshToken) return null;
  if (Number(stored.expiresAt) > Math.floor(Date.now() / 1000) + 60) return stored;

  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const data = await authRequest("token?grant_type=refresh_token", { refresh_token: stored.refreshToken });
      const refreshed = normalizeSession(data);
      if (!refreshed) throw new Error("Session refresh failed.");
      saveSession(refreshed);
      return refreshed;
    } catch {
      saveSession(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function signOut(session) {
  try {
    if (session?.accessToken) await authRequest("logout", null, session.accessToken);
  } finally {
    saveSession(null);
  }
}


export function getProfile(session) {
  const metadata = session?.user?.user_metadata || {};
  return {
    gameName: typeof metadata.game_name === "string" ? metadata.game_name : "",
    bio: typeof metadata.bio === "string" ? metadata.bio : ""
  };
}

export async function updateProfile({ gameName, bio }) {
  const session = await getSession();
  if (!session?.accessToken) throw new Error("Please sign in again to update your profile.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify({
      data: {
        ...(session.user?.user_metadata || {}),
        game_name: String(gameName || "").trim().slice(0, 40),
        bio: String(bio || "").trim().slice(0, 240)
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.message || data.error_description || "Could not save your profile.");
  }
  const updatedSession = { ...session, user: data };
  saveSession(updatedSession);
  return { session: updatedSession, profile: getProfile(updatedSession) };
}
