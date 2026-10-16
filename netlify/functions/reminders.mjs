// Kører hvert 5. minut: sender en påmindelse til spillere, der mangler tips til kampe,
// som starter inden for 90 minutter. Hver spiller får højst én påmindelse pr. kamp.
import webpush from "web-push";
import { adminClient } from "../lib/supabase.mjs";

const fmt = (iso) =>
  new Date(iso).toLocaleTimeString("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });

export default async () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("VAPID-nøgler mangler, påmindelser er slået fra");
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const sb = adminClient();

  const now = Date.now();
  const { data: matches, error } = await sb
    .from("matches")
    .select("id, home, away, kickoff, status")
    .gt("kickoff", new Date(now).toISOString())
    .lte("kickoff", new Date(now + 90 * 60 * 1000).toISOString())
    .in("status", ["SCHEDULED", "TIMED"])
    .order("kickoff");
  if (error) return console.error(error.message);
  if (!matches?.length) return;

  const ids = matches.map((m) => m.id);
  const [{ data: players }, { data: tips }, { data: sent }, { data: subs }] = await Promise.all([
    sb.from("players").select("user_id"),
    sb.from("tips").select("user_id, match_id").in("match_id", ids),
    sb.from("reminders_sent").select("user_id, match_id").in("match_id", ids),
    sb.from("push_subscriptions").select("*"),
  ]);
  const has = new Set((tips || []).map((t) => t.user_id + "|" + t.match_id));
  const done = new Set((sent || []).map((t) => t.user_id + "|" + t.match_id));

  for (const p of players || []) {
    const missing = matches.filter((m) => !has.has(p.user_id + "|" + m.id) && !done.has(p.user_id + "|" + m.id));
    const mySubs = (subs || []).filter((s) => s.user_id === p.user_id);
    if (!missing.length || !mySubs.length) continue;

    const body = missing.map((m) => `${m.home}–${m.away} kl. ${fmt(m.kickoff)}`).join("\n");
    const payload = JSON.stringify({
      title: missing.length === 1 ? "Du mangler et tip" : `Du mangler ${missing.length} tips`,
      body,
      url: "/",
      tag: "tips-" + missing[0].id,
    });

    let delivered = false;
    for (const s of mySubs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        delivered = true;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // udløbet abonnement
        } else {
          console.error("Push fejlede:", e.statusCode, e.body || e.message);
        }
      }
    }
    if (delivered) {
      await sb.from("reminders_sent").upsert(missing.map((m) => ({ user_id: p.user_id, match_id: m.id })));
    }
  }
};

export const config = { schedule: "*/5 * * * *" };
