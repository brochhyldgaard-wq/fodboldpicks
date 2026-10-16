// Giver appen de offentlige nøgler, så de ikke skal skrives ind i koden.
export default async () =>
  Response.json(
    {
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || null,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );

export const config = { path: "/api/config" };
