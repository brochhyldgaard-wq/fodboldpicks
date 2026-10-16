// Engangshjælp: laver et nøglepar til push-notifikationer.
// Svarer kun, så længe VAPID_PRIVATE_KEY ikke er sat i Netlify.
import webpush from "web-push";

export default async () => {
  if (process.env.VAPID_PRIVATE_KEY) {
    return new Response("Nøglerne til påmindelser er allerede sat op.", { status: 403 });
  }
  const k = webpush.generateVAPIDKeys();
  return new Response(
    `Kopiér de to linjer ind som miljøvariabler i Netlify:\n\nVAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\n\nGenindlæser du siden, får du et nyt par. Brug kun ét af dem.\n`,
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }
  );
};

export const config = { path: "/api/vapid-keys" };
