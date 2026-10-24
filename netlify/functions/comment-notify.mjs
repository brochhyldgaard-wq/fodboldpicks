// Kaldes af appen, når en spiller har skrevet en kommentar.
// Sender en påmindelse til de andre, der har tippet kampen – højst én pr. kamp hvert 15. minut.
import webpush from "web-push";
import { adminClient } from "../lib/supabase.mjs";

const QUIET_MIN = 15;

export default async (req) => {
  if (req.method !== "POST") return new Response("Brug POST", { status: 405 });
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return Response.json({ sent: 0, note: "Påmindelser er ikke sat op" });
  try {
    const sb = adminClient();
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await sb.auth.getUser(token);
    const user = data?.user;
    if (!user) return Response.json({ error: "Du er ikke logget ind" }, { status: 401 });

    const { comment_id } = await req.json().catch(() => ({}));
    const { data: c } = await sb.from("comments").select("id, match_id, user_id, body, created_at").eq("id", comment_id).maybeSingle();
    // kun forfatteren kan udløse påmindelsen, og kun lige efter kommentaren er skrevet
    if (!c || c.user_id !== user.id || Date.now() - new Date(c.created_at).getTime() > 2 * 60 * 1000) {
      return Response.json({ sent: 0 });
    }

    const [{ data: m }, { data: author }, { data: tippers }] = await Promise.all([
      sb.from("matches").select("home, away").eq("id", c.match_id).maybeSingle(),
      sb.from("players").select("nick").eq("user_id", user.id).maybeSingle(),
      sb.from("tips").select("user_id").eq("match_id", c.match_id),
    ]);
    const ids = [...new Set((tippers || []).map((t) => t.user_id))].filter((id) => id !== user.id);
    if (!ids.length) return Response.json({ sent: 0 });

    const since = new Date(Date.now() - QUIET_MIN * 60 * 1000).toISOString();
    const [{ data: wants }, { data: recent }, { data: subs }] = await Promise.all([
      sb.from("players").select("user_id").in("user_id", ids).eq("notify_comments", true),
      sb.from("comment_push_log").select("user_id").eq("match_id", c.match_id).in("user_id", ids).gt("sent_at", since),
      sb.from("push_subscriptions").select("*").in("user_id", ids),
    ]);
    const skip = new Set((recent || []).map((r) => r.user_id));
    const targets = (wants || []).map((w) => w.user_id).filter((id) => !skip.has(id));
    if (!targets.length) return Response.json({ sent: 0 });

    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const payload = JSON.stringify({
      title: `${author?.nick || "En spiller"} om ${m ? `${m.home}–${m.away}` : "en kamp"}`,
      body: c.body,
      url: "/",
      tag: "c-" + c.match_id,
    });
    let sent = 0;
    for (const uid of targets) {
      let ok = false;
      for (const s of (subs || []).filter((x) => x.user_id === uid)) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          ok = true;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
      if (ok) {
        sent++;
        await sb.from("comment_push_log").upsert({ user_id: uid, match_id: c.match_id, sent_at: new Date().toISOString() });
      }
    }
    return Response.json({ sent });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
};

export const config = { path: "/api/comment-notify" };
