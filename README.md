# Tipsligaen: opsætning

Premier League-tipsspil for op til 10 spillere. Siden ligger på Netlify, og data og login ligger i Supabase. Kampe og resultater hentes automatisk fra football-data.org. Spillere, der mangler tips 90 minutter før kampstart, får en påmindelse på telefonen.

Opsætningen tager cirka 30 minutter. Du skal bruge fire gratis konti: football-data.org, Supabase, GitHub og Netlify.

---

## 1. Hent en nøgle hos football-data.org

1. Opret en gratis konto på football-data.org (menuen "Register" eller "Get your free API key").
2. Nøglen (API token) kommer på mail. Gem den. Den skal bruges i trin 4 som `FOOTBALL_DATA_TOKEN`.

## 2. Opret databasen i Supabase

1. Opret en konto på supabase.com og lav et nyt projekt. Vælg en region i EU, for eksempel Frankfurt. Gem databaseadgangskoden et sikkert sted.
2. Åbn **SQL Editor**, indsæt hele indholdet af `supabase/schema.sql`, og tryk **Run**.
3. Find invitationskoden ved at køre denne linje i SQL Editor:
   ```sql
   select invite_code from settings;
   ```
   Vil du hellere have din egen kode, så kør `update settings set invite_code = 'DINKODE';`
4. Gå til **Authentication**, åbn indstillingerne for **Email**-login, og slå **Confirm email** fra. Så kan spillerne logge ind med det samme uden en bekræftelsesmail.
5. Find tre værdier under **Project Settings** (eller via knappen **Connect** på projektets forside):
   - Project URL, som bliver `SUPABASE_URL`
   - Publishable key (hedder "anon" i ældre projekter), som bliver `SUPABASE_PUBLISHABLE_KEY`
   - Secret key (hedder "service_role" i ældre projekter), som bliver `SUPABASE_SECRET_KEY`

   Secret key giver fuld adgang til databasen. Den må kun ligge i Netlify og aldrig deles.

## 3. Læg koden på GitHub

1. Opret en konto på github.com og lav et nyt **privat** repository, for eksempel `tipsligaen`.
2. Vælg **uploading an existing file**, og træk hele indholdet af projektmappen ind (mapperne `public`, `netlify`, `supabase` samt filerne `netlify.toml` og `package.json`). Tryk **Commit changes**.

## 4. Udgiv på Netlify

1. Opret en konto på netlify.com med din GitHub-konto.
2. Vælg **Add new project**, derefter **Import an existing project** og **GitHub**, og vælg dit repository.
3. Lad byggeindstillingerne stå tomme. De læses fra `netlify.toml`.
4. Tilføj miljøvariabler under projektets **Environment variables**:

   | Navn | Værdi |
   |---|---|
   | `SUPABASE_URL` | fra trin 2 |
   | `SUPABASE_PUBLISHABLE_KEY` | fra trin 2 |
   | `SUPABASE_SECRET_KEY` | fra trin 2 |
   | `FOOTBALL_DATA_TOKEN` | fra trin 1 |
   | `VAPID_SUBJECT` | `mailto:` efterfulgt af din e-mail, for eksempel `mailto:jorn@eksempel.dk` |

5. Tryk **Deploy**. Når det er færdigt, får du en adresse som `tipsligaen.netlify.app`. Du kan ændre navnet under projektets indstillinger.

## 5. Slå påmindelser til

1. Åbn `https://DIN-ADRESSE.netlify.app/api/vapid-keys` i browseren. Siden viser to linjer: `VAPID_PUBLIC_KEY` og `VAPID_PRIVATE_KEY`.
2. Tilføj begge som miljøvariabler i Netlify.
3. Udgiv igen under **Deploys** med **Trigger deploy**, så ændringerne træder i kraft. Derefter svarer siden fra punkt 1 ikke længere med nøgler.

## 6. Første gang i appen

1. Åbn appen, tryk **Opret bruger**, og meld dig til med invitationskoden. Den første, der melder sig til, bliver administrator.
2. Gå til **Mere** og tryk **Hent kampe nu**. Derefter opdateres kampe og resultater automatisk hvert 15. minut.
3. Send adressen og invitationskoden til de andre spillere.

### Påmindelser på telefonen

- **iPhone:** Åbn appen i Safari, tryk **Del** og vælg **Føj til hjemmeskærm**. Åbn Tipsligaen fra hjemmeskærmen, gå til **Mere** og tryk **Slå påmindelser til**. Påmindelser virker kun fra hjemmeskærmen.
- **Android og computer:** Gå til **Mere** og tryk **Slå påmindelser til**.

Påmindelsen sendes én gang pr. kamp, når der er under 90 minutter til kampstart, og kun hvis tippet mangler.

---

## Daglig drift

- **Resultater** kommer automatisk med lidt forsinkelse efter slutfløjt, fordi gratisplanen hos football-data.org har forsinkede data.
- **Manuelt resultat:** Gå til **Mere** og slå "Vis felter til manuelle resultater" til. Under **Kampe** kan du så indtaste et slutresultat. Et manuelt resultat overskrives ikke af den automatiske opdatering, før du trykker **Brug automatisk resultat**.
- **Glemt adgangskode:** Kør dette i Supabase SQL Editor med spillerens e-mail og en ny kode:
  ```sql
  update auth.users
  set encrypted_password = extensions.crypt('NyKode123', extensions.gen_salt('bf'))
  where email = 'spiller@eksempel.dk';
  ```
- **Fjern en spiller:** Slet brugeren under **Authentication** i Supabase. Spillerens tips slettes også.

## Fejlsøgning

- **"Appen kunne ikke starte":** Tjek stavningen af miljøvariablerne i Netlify og udgiv igen.
- **Ingen kampe:** Tryk **Hent kampe nu** under **Mere**. Viser beskeden en fejl fra football-data.org, så tjek `FOOTBALL_DATA_TOKEN`.
- **Logs:** Netlify viser fejl fra de automatiske funktioner under projektets **Logs**, i afsnittet **Functions**.
- Automatiske funktioner kører kun på den udgivne version af siden, ikke på testversioner.

## Sådan hænger det sammen

| Fil | Funktion |
|---|---|
| `public/` | Selve appen (HTML, CSS, JavaScript, ikoner og service worker til påmindelser) |
| `netlify/functions/sync-results.mjs` | Henter kampe og resultater hvert 15. minut |
| `netlify/functions/reminders.mjs` | Sender påmindelser hvert 5. minut, hvis der mangler tips |
| `netlify/functions/sync-now.mjs` | Knappen "Hent kampe nu" |
| `netlify/functions/config.mjs` | Giver appen de offentlige nøgler |
| `netlify/functions/vapid-keys.mjs` | Engangshjælp til nøglerne for påmindelser |
| `supabase/schema.sql` | Tabeller, adgangsregler og pointberegning |

Reglerne håndhæves i databasen: Tips kan kun gemmes og ændres før kampstart, og de andres tips er skjult indtil kampstart. Det gælder også, hvis nogen prøver at gå uden om appen.
