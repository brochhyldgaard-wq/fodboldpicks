// Henter Premier League-tabel, topscorere og indbyrdes opgør fra football-data.org.
// Gratisplanen tillader 10 kald i minuttet, så hver kørsel bruger højst 7.
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

// Indbyrdes opgør for næste rundes kampe. Hentes én gang og fornyes efter 7 dage.
export async function syncH2H(sb, max = 5) {
  const nowIso = new Date().toISOString();
  const { data: upcoming } = await sb.from("matches").select("id, round, kickoff, status")
    .gt("kickoff", nowIso).in("status", ["SCHEDULED", "TIMED"]).order("kickoff").limit(1);
  if (!upcoming?.length) return 0;
  const round = upcoming[0].round;
  const { data: ms } = await sb.from("matches").select("id").eq("round", round);
  const ids = (ms || []).map((m) => m.id);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: fresh } = await sb.from("pl_h2h").select("match_id").in("match_id", ids).gt("updated_at", weekAgo);
  const have = new Set((fresh || []).map((r) => r.match_id));
  const todo = ids.filter((id) => !have.has(id)).slice(0, max);
  for (const id of todo) {
    const d = await get(`/matches/${id}/head2head?limit=10`);
    const a = d.aggregates || {};
    const data = {
      n: a.numberOfMatches ?? (d.matches || []).length,
      goals: a.totalGoals ?? null,
      homeWins: a.homeTeam?.wins ?? null,
      awayWins: a.awayTeam?.wins ?? null,
      draws: a.homeTeam?.draws ?? null,
      last: (d.matches || [])
        .filter((m) => m.score?.fullTime?.home != null)
        .sort((x, y) => new Date(y.utcDate) - new Date(x.utcDate))
        .slice(0, 5)
        .map((m) => ({ date: m.utcDate, home: teamName(m.homeTeam), away: teamName(m.awayTeam), hg: m.score.fullTime.home, ag: m.score.fullTime.away })),
    };
    const { error } = await sb.from("pl_h2h").upsert({ match_id: id, data, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  return todo.length;
}

export async function syncExtra(sb, h2hMax = 5) {
  const out = { standings: 0, scorers: 0, h2h: 0 };
  out.standings = await syncStandings(sb);
  out.scorers = await syncScorers(sb);
  out.h2h = await syncH2H(sb, h2hMax);
  return out;
}
