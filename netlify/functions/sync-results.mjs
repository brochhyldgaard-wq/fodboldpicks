// Kører hvert 15. minut: henter kamptider, status og resultater.
import { adminClient } from "../lib/supabase.mjs";
import { syncMatches } from "../lib/sync.mjs";

export default async () => {
  try {
    const n = await syncMatches(adminClient());
    console.log(`Synkroniseret ${n} kampe`);
  } catch (e) {
    console.error("Synkronisering fejlede:", e.message || e);
  }
};

export const config = { schedule: "*/15 * * * *" };
