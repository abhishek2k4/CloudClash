const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMPETITION_CODE = process.env.COMPETITION_CODE || "CLOUD26";

const hasCredentials = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const explicitPersistenceSetting = process.env.PERSISTENCE_ENABLED;
const persistenceRequested = explicitPersistenceSetting === undefined
  ? process.env.NODE_ENV === "production"
  : explicitPersistenceSetting.toLowerCase() === "true";
const isConfigured = hasCredentials && persistenceRequested;

if (hasCredentials && !persistenceRequested) {
  console.log("Supabase credentials found, but persistence is disabled for this environment.");
}
if (persistenceRequested && !hasCredentials) {
  console.warn("Persistence is enabled but Supabase credentials are missing. Running in memory-only mode.");
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return response;
}

export const persistenceEnabled = isConfigured;

export async function loadCompetitionState() {
  if (!isConfigured) return null;

  const query = new URLSearchParams({
    id: `eq.${COMPETITION_CODE}`,
    select: "state",
    limit: "1",
  });
  const response = await request(`competition_state?${query.toString()}`);
  const rows = await response.json();
  return rows[0]?.state ?? null;
}

export async function saveCompetitionState(state) {
  if (!isConfigured) return;

  await request("competition_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: COMPETITION_CODE,
      state,
      updated_at: new Date().toISOString(),
    }),
  });
}
