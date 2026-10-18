// Henter Premier League-tabel og topscorere fra football-data.org (to kald pr. kørsel).
import { teamName } from "./sync.mjs";

const API = "https://api.football-data.org/v4";

async function get(path) {
  const res = await fetch(API + path, { headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN } });
  if (!res.ok) {
    const e = new Error(`football-data.org svarede ${res.status} på ${path}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export async function syncStandings(sb) {
  const d = await get("/competitions/PL/standings");
  const total = (d.standings || []).find((s) => s.type === "TOTAL") || (d.standings || [])[0];
  if (!total) return 0;
  const now = new Date().toISOString();
  const rows = total.table.map((r) => ({
    team: teamName(r.team), position: r.position, crest: r.team.crest || null,
    played: r.playedGames, won: r.won, draw: r.draw, lost: r.lost, points: r.points,
    goals_for: r.goalsFor, goals_against: r.goalsAgainst, goal_diff: r.goalDifference, updated_at: now,
  }));
  const { error } = await sb.from("pl_standings").upsert(rows, { onConflict: "team" });
  if (error) throw error;
  // fjern hold, der ikke længere er i ligaen (for eksempel efter en ny sæson)
  await sb.from("pl_standings").delete().lt("updated_at", now);
  return rows.length;
}

export async function syncScorers(sb) {
  let d;
  try { d = await get("/competitions/PL/scorers?limit=10"); }
  catch (e) { if (e.status === 403) return 0; throw e; } // ikke med i abonnementet
  const now = new Date().toISOString();
  const rows = (d.scorers || []).map((s, i) => ({
    rank: i + 1, player: s.player?.name || "Ukendt", team: teamName(s.team), crest: s.team?.crest || null,
    goals: s.goals ?? 0, assists: s.assists ?? null, penalties: s.penalties ?? null, played: s.playedMatches ?? null, updated_at: now,
  }));
  if (rows.length) {
    const { error } = await sb.from("pl_scorers").upsert(rows, { onConflict: "rank" });
    if (error) throw error;
  }
  await sb.from("pl_scorers").delete().gt("rank", rows.length);
  return rows.length;
}

export async function syncExtra(sb) {
  const out = { standings: 0, scorers: 0 };
  out.standings = await syncStandings(sb);
  out.scorers = await syncScorers(sb);
  return out;
}
