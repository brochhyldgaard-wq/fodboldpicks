// Kører hvert 15. minut: henter kamptider, status og resultater, og bruger reservekilden ved forsinkede resultater.
import { adminClient } from "../lib/supabase.mjs";
import { syncMatches } from "../lib/sync.mjs";
import { fillMissingResults } from "../lib/fallback.mjs";

export default async () => {
  const sb = adminClient();
  try {
    const n = await syncMatches(sb);
    console.log(`Synkroniseret ${n} kampe`);
  } catch (e) {
    console.error("Synkronisering fejlede:", e.message || e);
  }
  try {
    const r = await fillMissingResults(sb);
    if (r.pending) console.log(`Reservekilde: ${r.pending} kampe mangler resultat, ${r.filled} hentet, ${r.calls} kald (${r.usedToday ?? "?"} i dag)${r.note ? ", " + r.note : ""}`);
    if (r.skipped) console.log("Reservekilde: " + r.skipped);
  } catch (e) {
    console.error("Reservekilde fejlede:", e.message || e);
  }
};

export const config = { schedule: "*/15 * * * *" };
