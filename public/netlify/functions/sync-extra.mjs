// Kører én gang i timen (7 minutter over): tabel og topscorere.
import { adminClient } from "../lib/supabase.mjs";
import { syncExtra } from "../lib/extra.mjs";

export default async () => {
  try {
    const r = await syncExtra(adminClient());
    console.log(`Tabel: ${r.standings} hold, topscorere: ${r.scorers}`);
  } catch (e) {
    console.error("Synkronisering af Premier League-data fejlede:", e.message || e);
  }
};

export const config = { schedule: "7 * * * *" };
