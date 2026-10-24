// Reservekilde: henter slutresultater fra API-Football for kampe, som football-data.org
// endnu ikke har afsluttet 2 timer efter kampstart. Bruger højst 80 af de 100 daglige kald.
const API = "https://v3.football.api-sports.io";
const DONE_SHORT = ["FT", "AET", "PEN"];
const DAILY_CAP = 80;
const GAP_MIN = 25; // mindst 25 minutter mellem automatiske kald

const STOP = new Set(["fc", "afc", "town", "city", "united", "utd", "hotspur", "albion", "hove", "and", "wanderers"]);
const ALIAS = { man: "manchester", nottm: "nottingham", spurs: "tottenham", wolves: "wolverhampton" };
function tokens(name) {
  return (name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
    .map((t) => ALIAS[t] || t).filter((t) => !STOP.has(t));
}
const sameTeam = (a, b) => { const A = tokens(a), B = tokens(b); return A.some((t) => B.includes(t)); };
const seasonOf = (d) => (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

export async function fillMissingResults(sb, { force = false } = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return { skipped: "API_FOOTBALL_KEY mangler i Netlify" };
  const now = Date.now();
  const { data: pending, error } = await sb.from("matches")
    .select("id, home, away, kickoff, status")
    .eq("manual", false)
    .not("status", "in", "(FINISHED,AWARDED,POSTPONED,CANCELLED)")
    .lt("kickoff", new Date(now - 2 * 3600e3).toISOString())
    .gt("kickoff", new Date(now - 4 * 864e5).toISOString());
  if (error) throw error;
  if (!pending?.length) return { pending: 0, filled: 0, calls: 0 };

  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await sb.from("ext_api_usage").select("*").eq("day", day).maybeSingle();
  const used = usage?.calls || 0;
  if (!force && usage?.last_at && now - new Date(usage.last_at).getTime() < GAP_MIN * 60e3) {
    return { pending: pending.length, filled: 0, calls: 0, note: "venter på næste tilladte kald" };
  }
  if (used >= DAILY_CAP) return { pending: pending.length, filled: 0, calls: 0, note: "dagens kald er brugt" };

  const dates = [...new Set(pending.map((m) => new Date(m.kickoff).toISOString().slice(0, 10)))];
  let calls = 0, filled = 0;
  try {
    for (const d of dates) {
      if (used + calls >= DAILY_CAP) break;
      const season = seasonOf(new Date(d + "T12:00:00Z"));
      const res = await fetch(`${API}/fixtures?league=39&season=${season}&date=${d}`, { headers: { "x-apisports-key": key } });
      calls++;
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`API-Football svarede ${res.status}`);
      const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
      if (errs && errs.length) throw new Error("API-Football: " + errs.join("; "));
      for (const m of pending.filter((x) => new Date(x.kickoff).toISOString().slice(0, 10) === d)) {
        const k = new Date(m.kickoff).getTime();
        const f = (j.response || []).find((x) =>
          Math.abs(new Date(x.fixture.date).getTime() - k) < 3 * 3600e3 &&
          sameTeam(m.home, x.teams?.home?.name) && sameTeam(m.away, x.teams?.away?.name));
        if (!f || !DONE_SHORT.includes(f.fixture?.status?.short) || f.goals?.home == null || f.goals?.away == null) continue;
        const { error: e } = await sb.from("matches")
          .update({ status: "FINISHED", home_goals: f.goals.home, away_goals: f.goals.away, updated_at: new Date().toISOString() })
          .eq("id", m.id).eq("manual", false);
        if (!e) filled++;
      }
    }
  } finally {
    await sb.from("ext_api_usage").upsert({ day, calls: used + calls, last_at: new Date().toISOString() });
  }
  return { pending: pending.length, filled, calls, usedToday: used + calls };
}
