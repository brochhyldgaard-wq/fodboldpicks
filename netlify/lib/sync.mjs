// Henter Premier League-kampe fra football-data.org og gemmer dem i Supabase.
const NAMES = {
  "Man United": "Man Utd",
  "Brighton Hove": "Brighton",
  "Nottingham": "Nottm Forest",
  "Wolverhampton": "Wolves",
};
export const teamName = (t) => NAMES[t?.shortName] || t?.shortName || t?.name || "Ukendt";

export async function syncMatches(sb) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) throw new Error("FOOTBALL_DATA_TOKEN mangler i Netlify-miljøvariablerne");

  const res = await fetch("https://api.football-data.org/v4/competitions/PL/matches", {
    headers: { "X-Auth-Token": token },
  });
  if (!res.ok) throw new Error(`football-data.org svarede ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const { data: existing, error: exErr } = await sb.from("matches").select("id, manual");
  if (exErr) throw exErr;
  const manual = new Set((existing || []).filter((r) => r.manual).map((r) => r.id));
  const now = new Date().toISOString();

  const auto = [];
  const fixedResult = [];
  for (const m of data.matches || []) {
    if (!m.homeTeam?.id || !m.awayTeam?.id || !m.matchday) continue; // hold ikke fastlagt endnu
    const base = {
      id: String(m.id),
      round: m.matchday,
      home: teamName(m.homeTeam),
      away: teamName(m.awayTeam),
      home_crest: m.homeTeam.crest || null,
      away_crest: m.awayTeam.crest || null,
      kickoff: m.utcDate,
      updated_at: now,
    };
    if (manual.has(base.id)) {
      fixedResult.push(base); // manuelt resultat: opdater kun tidspunkt og hold
    } else {
      auto.push({
        ...base,
        status: m.status,
        home_goals: m.score?.fullTime?.home ?? null,
        away_goals: m.score?.fullTime?.away ?? null,
      });
    }
  }

  // To separate kald, så manuelt indtastede resultater aldrig overskrives.
  if (auto.length) {
    const { error } = await sb.from("matches").upsert(auto, { onConflict: "id" });
    if (error) throw error;
  }
  if (fixedResult.length) {
    const { error } = await sb.from("matches").upsert(fixedResult, { onConflict: "id" });
    if (error) throw error;
  }
  return auto.length + fixedResult.length;
}
