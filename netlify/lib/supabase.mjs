import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL eller SUPABASE_SECRET_KEY mangler i Netlify-miljøvariablerne");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
