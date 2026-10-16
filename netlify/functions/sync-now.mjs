// Kaldes fra appen, når administratoren trykker "Hent kampe nu".
import { adminClient } from "../lib/supabase.mjs";
import { syncMatches } from "../lib/sync.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Brug POST", { status: 405 });
  try {
    const sb = adminClient();
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await sb.auth.getUser(token);
    const user = data?.user;
    if (!user) return Response.json({ error: "Du er ikke logget ind" }, { status: 401 });
    const { data: p } = await sb.from("players").select("is_admin").eq("user_id", user.id).maybeSingle();
    if (!p?.is_admin) return Response.json({ error: "Kun administratoren kan hente kampe" }, { status: 403 });
    const count = await syncMatches(sb);
    return Response.json({ ok: true, count });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
};

export const config = { path: "/api/sync" };
