/* Tipsligaen – Premier League-tipsspil */
"use strict";

const ROW = 44;        // højde på et tal i hjulet (px), skal matche --row i CSS
const MAX_GOALS = 12;  // højeste tal på hjulet
const DONE = ["FINISHED", "AWARDED"];
const OFF = ["POSTPONED", "CANCELLED", "SUSPENDED"];
const LIVE = ["IN_PLAY", "PAUSED"];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const S = {
  sb: null, cfg: null, session: null, me: null,
  players: [], matches: [], myTips: new Map(), roundTips: [],
  roundScores: [], roundStatus: [],
  view: "kampe", round: null, admin: false, inviteCode: null,
};

// ---------- hjælpere ----------
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const isDone = (m) => DONE.includes(m.status) && m.home_goals != null && m.away_goals != null;
const isLive = (m) => LIVE.includes(m.status);
const started = (m) => Date.now() >= new Date(m.kickoff).getTime();
function points(t, m) {
  if (!t || !isDone(m)) return null;
  if (t.home === m.home_goals && t.away === m.away_goals) return 100;
  if (sign(t.home - t.away) === sign(m.home_goals - m.away_goals)) return 20;
  return 0;
}
const fmtDay = (d) => { const s = new Date(d).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }); return s[0].toUpperCase() + s.slice(1); };
const fmtTime = (d) => new Date(d).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
const fmtShort = (d) => new Date(d).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
const nick = (uid) => S.players.find((p) => p.user_id === uid)?.nick || "Spiller";
const uid = () => S.session?.user?.id;
const rounds = () => [...new Set(S.matches.map((m) => m.round))].sort((a, b) => a - b);

let toastTimer;
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status", text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}
function fatal(msg) {
  $("#tabs").hidden = true;
  const m = $("#main"); m.innerHTML = "";
  m.append(h("div", { class: "card error" }, h("h2", { text: "Appen kunne ikke starte" }), h("p", { text: msg })));
}

// ---------- opstart ----------
async function init() {
  try {
    const r = await fetch("/api/config");
    S.cfg = await r.json();
  } catch (e) {
    return fatal("Opsætningen kunne ikke hentes. Tjek at appen er udgivet på Netlify med funktionerne.");
  }
  if (!S.cfg.supabaseUrl || !S.cfg.supabaseKey) return fatal("SUPABASE_URL eller SUPABASE_PUBLISHABLE_KEY mangler i Netlifys miljøvariabler.");
  S.sb = supabase.createClient(S.cfg.supabaseUrl, S.cfg.supabaseKey);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  const { data } = await S.sb.auth.getSession();
  S.session = data.session;
  S.sb.auth.onAuthStateChange((_ev, session) => {
    const changed = session?.user?.id !== S.session?.user?.id;
    S.session = session;
    if (changed) start();
  });
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; render(); }));
  setInterval(() => { if (S.me && document.visibilityState === "visible") refresh(); }, 60000);
  setInterval(() => refreshRows(), 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.me) refresh(); });
  start();
}

async function start() {
  if (!S.session) return renderAuth();
  try { await loadAll(); } catch (e) { return fatal("Data kunne ikke hentes: " + (e.message || e)); }
  if (!S.me) return renderJoin();
  if (S.round == null) S.round = defaultRound();
  await loadRoundTips();
  render();
}

async function loadAll() {
  const id = uid();
  const [pl, ma, mt, rs, rst] = await Promise.all([
    S.sb.from("players").select("user_id, nick, is_admin, joined_at").order("joined_at"),
    S.sb.from("matches").select("*").order("kickoff").limit(1000),
    S.sb.from("tips").select("match_id, home, away").eq("user_id", id).limit(1000),
    S.sb.from("round_scores").select("*").limit(1000),
    S.sb.from("round_status").select("*"),
  ]);
  for (const r of [pl, ma, mt, rs, rst]) if (r.error) throw r.error;
  S.players = pl.data; S.matches = ma.data; S.roundScores = rs.data; S.roundStatus = rst.data;
  S.myTips = new Map(mt.data.map((t) => [t.match_id, { home: t.home, away: t.away }]));
  S.me = S.players.find((p) => p.user_id === id) || null;
}

async function loadRoundTips() {
  const ids = S.matches.filter((m) => m.round === S.round).map((m) => m.id);
  if (!ids.length) { S.roundTips = []; return; }
  const { data, error } = await S.sb.from("tips").select("user_id, match_id, home, away").in("match_id", ids).limit(1000);
  S.roundTips = error ? [] : data;
}

async function refresh() {
  try { await loadAll(); await loadRoundTips(); } catch (e) { return; }
  if (S.view === "kampe") refreshRows(); else render();
}

function defaultRound() {
  const now = Date.now();
  const open = S.matches
    .filter((m) => !isDone(m) && !OFF.includes(m.status) && new Date(m.kickoff).getTime() > now - 3 * 3600e3)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const rs = rounds();
  return open.length ? open[0].round : rs[rs.length - 1] ?? 1;
}

// ---------- login ----------
function renderAuth(mode = "login", msg = "") {
  $("#tabs").hidden = true;
  const main = $("#main"); main.innerHTML = "";
  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true });
  const pw = h("input", { type: "password", id: "pw", autocomplete: mode === "login" ? "current-password" : "new-password", minlength: "6", required: true });
  const submit = h("button", { class: "btn flood", type: "submit" }, mode === "login" ? "Log ind" : "Opret bruger");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault(); submit.disabled = true;
      const creds = { email: email.value.trim(), password: pw.value };
      const { data, error } = mode === "login" ? await S.sb.auth.signInWithPassword(creds) : await S.sb.auth.signUp(creds);
      submit.disabled = false;
      if (error) return renderAuth(mode, oversaet(error.message));
      if (mode === "signup" && !data.session) return renderAuth("login", "Brugeren er oprettet, men skal bekræftes via mail. Bed administratoren slå bekræftelse fra i Supabase.");
    },
  },
    h("div", { class: "field" }, h("label", { for: "email" }, "E-mail"), email),
    h("div", { class: "field" }, h("label", { for: "pw" }, mode === "login" ? "Adgangskode" : "Vælg en adgangskode (mindst 6 tegn)"), pw),
    h("div", { class: "row" }, submit,
      h("button", { type: "button", class: "linkbtn", onclick: () => renderAuth(mode === "login" ? "signup" : "login") },
        mode === "login" ? "Ny her? Opret bruger" : "Har du en bruger? Log ind")));
  main.append(h("div", { class: "card" },
    h("h2", { text: mode === "login" ? "Log ind" : "Opret bruger" }),
    msg ? h("p", { class: "muted", role: "alert", text: msg }) : null,
    form));
}
function oversaet(m) {
  if (/Invalid login/i.test(m)) return "Forkert e-mail eller adgangskode.";
  if (/already registered/i.test(m)) return "Der findes allerede en bruger med den e-mail. Log ind i stedet.";
  if (/at least 6/i.test(m)) return "Adgangskoden skal være mindst 6 tegn.";
  return m;
}

// ---------- tilmelding ----------
function renderJoin(msg = "") {
  $("#tabs").hidden = true;
  const main = $("#main"); main.innerHTML = "";
  const full = S.players.length >= 10;
  const nickIn = h("input", { type: "text", id: "nick", maxlength: "24", required: true, placeholder: "Dit navn i tabellen" });
  const code = h("input", { type: "text", id: "code", autocomplete: "off", required: true, placeholder: "Fra den, der inviterede dig" });
  const btn = h("button", { class: "btn flood", type: "submit" }, "Meld dig til");
  main.append(h("div", { class: "card" },
    h("h2", { text: full ? "Turneringen er fuld" : "Meld dig til" }),
    h("p", { class: "muted", text: full ? "Der er allerede 10 spillere med. Du kan ikke melde dig til." : `${S.players.length} af 10 pladser er taget.` }),
    msg ? h("p", { role: "alert", text: msg }) : null,
    full ? null : h("form", {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true;
        const { error } = await S.sb.rpc("join_league", { p_nick: nickIn.value.trim(), p_code: code.value.trim() });
        btn.disabled = false;
        if (error) return renderJoin(error.message.replace(/^.*?:\s*/, ""));
        S.view = "mere"; // vis påmindelser og regler først
        start();
      },
    },
      h("div", { class: "field" }, h("label", { for: "nick" }, "Navn"), nickIn),
      h("div", { class: "field" }, h("label", { for: "code" }, "Invitationskode"), code),
      btn),
    h("p", {}, h("button", { class: "linkbtn", onclick: () => S.sb.auth.signOut() }, "Log ud"))));
}

// ---------- hovedvisning ----------
function render() {
  $("#tabs").hidden = false;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === S.view ? "page" : "false"));
  const main = $("#main"); main.innerHTML = "";
  if (S.view === "kampe") renderRound(main);
  else if (S.view === "stilling") renderStandings(main);
  else renderMore(main);
}

// ---------- Kampe ----------
function renderRound(main) {
  const rs = rounds();
  if (!rs.length) {
    main.append(h("div", { class: "card notice" }, h("h2", { text: "Ingen kampe endnu" }),
      h("p", { text: S.me.is_admin ? "Gå til Regler og mere og tryk Hent kampe nu." : "Kampprogrammet hentes automatisk. Prøv igen om lidt." })));
    return;
  }
  const i = rs.indexOf(S.round);
  const ms = S.matches.filter((m) => m.round === S.round).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const first = ms[0]?.kickoff, last = ms[ms.length - 1]?.kickoff;
  const range = first ? (fmtShort(first) === fmtShort(last) ? fmtDay(first) : `${fmtShort(first)} til ${fmtShort(last)}`) : "";
  const go = async (r) => { S.round = r; await loadRoundTips(); render(); };
  main.append(h("div", { class: "board" },
    h("button", { class: "arrow", "aria-label": "Forrige runde", disabled: i <= 0, onclick: () => go(rs[i - 1]) }, "‹"),
    h("h2", {}, `Runde ${S.round}`, h("small", { text: range })),
    h("button", { class: "arrow", "aria-label": "Næste runde", disabled: i >= rs.length - 1, onclick: () => go(rs[i + 1]) }, "›")));
  main.append(h("p", { class: "roundsum", id: "roundsum" }));
  let lastDay = "";
  for (const m of ms) {
    const d = fmtDay(m.kickoff);
    if (d !== lastDay) { main.append(h("div", { class: "day", text: d })); lastDay = d; }
    main.append(matchCard(m));
  }
  refreshRows();
}

function crest(url, name) {
  return url ? h("img", { src: url, alt: "", loading: "lazy", width: "40", height: "40" }) : h("div", { class: "crest", "aria-hidden": "true", text: name.slice(0, 2) });
}

function matchCard(m) {
  const saveTimer = { t: null };
  const onChange = () => {
    clearTimeout(saveTimer.t);
    saveTimer.t = setTimeout(() => saveTip(m, card), 450);
  };
  const hw = wheel(`Mål til ${m.home}`, onChange);
  const aw = wheel(`Mål til ${m.away}`, onChange);
  const dh = h("div", { class: "digit" }), da = h("div", { class: "digit" });
  const card = h("article", { class: "match", "data-id": m.id },
    h("div", { class: "mtop" }, h("span", { class: "time" }), h("span", { class: "status" })),
    h("div", { class: "mmid" },
      h("div", { class: "team" }, crest(m.home_crest, m.home), h("span", { text: m.home })),
      h("div", { class: "tip" }, hw.el, h("span", { class: "colon", "aria-hidden": "true" }, ":"), aw.el,
        h("div", { class: "digits", "aria-label": "Dit tip" }, dh, h("span", { class: "colon", "aria-hidden": "true" }, ":"), da)),
      h("div", { class: "team" }, crest(m.away_crest, m.away), h("span", { text: m.away }))),
    h("div", { class: "final" }),
    h("div", { class: "others" }),
    S.admin && S.me.is_admin ? adminPanel(m) : null);
  card._m = m; card._hw = hw; card._aw = aw; card._dh = dh; card._da = da; card._msg = null;
  return card;
}

function wheel(label, onChange) {
  const vals = [null, ...Array.from({ length: MAX_GOALS + 1 }, (_, i) => i)];
  let idx = 0, programmatic = false, settle = null;
  const items = vals.map((v, i) => h("div", { class: "wheel-item", "data-i": i, onclick: () => setIdx(i, true) }, v == null ? "–" : String(v)));
  const sc = h("div", { class: "wheel", tabindex: "0", role: "spinbutton", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(MAX_GOALS) }, items);
  const el = h("div", { class: "wheel-wrap" }, sc);
  const mark = (i) => {
    items.forEach((it, j) => it.classList.toggle("on", j === i));
    const v = vals[i];
    if (v == null) { sc.removeAttribute("aria-valuenow"); sc.setAttribute("aria-valuetext", "intet tip"); }
    else { sc.setAttribute("aria-valuenow", String(v)); sc.setAttribute("aria-valuetext", String(v)); }
  };
  function commit() {
    const i = Math.max(0, Math.min(vals.length - 1, Math.round(sc.scrollTop / ROW)));
    const was = programmatic; programmatic = false;
    if (i !== idx) { idx = i; mark(i); if (!was) { api.touched = Date.now(); onChange(); } }
  }
  function setIdx(i, user) {
    i = Math.max(0, Math.min(vals.length - 1, i));
    if (user) {
      sc.scrollTo({ top: i * ROW, behavior: reduceMotion ? "auto" : "smooth" });
      if (i !== idx) { idx = i; mark(i); api.touched = Date.now(); onChange(); }
    }
  }
  sc.addEventListener("scroll", () => {
    mark(Math.max(0, Math.min(vals.length - 1, Math.round(sc.scrollTop / ROW))));
    clearTimeout(settle); settle = setTimeout(commit, 140);
  }, { passive: true });
  sc.addEventListener("keydown", (e) => {
    const map = { ArrowUp: idx - 1, ArrowDown: idx + 1, Home: 0, End: vals.length - 1, Delete: 0, Backspace: 0 };
    if (e.key in map) { e.preventDefault(); setIdx(map[e.key], true); }
    else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setIdx(Number(e.key) + 1, true); }
  });
  const api = {
    el, touched: 0,
    get value() { return vals[idx]; },
    set(v) { // programmatisk, gemmer ikke
      const i = v == null ? 0 : Math.min(v, MAX_GOALS) + 1;
      if (i === idx && Math.abs(sc.scrollTop - i * ROW) < 2) return;
      idx = i; mark(i);
      if (Math.abs(sc.scrollTop - i * ROW) >= 2) { programmatic = true; sc.scrollTop = i * ROW; }
    },
    disable(on) { sc.setAttribute("aria-disabled", on ? "true" : "false"); sc.tabIndex = on ? -1 : 0; },
  };
  mark(0);
  return api;
}

async function saveTip(m, card) {
  if (started(m)) { setMsg(card, "Kampen er gået i gang", "err"); return refreshRows(); }
  const hv = card._hw.value, av = card._aw.value;
  if ((hv == null) !== (av == null)) { setMsg(card, "Vælg begge tal", "err"); return; }
  const id = uid();
  let error;
  if (hv == null) {
    ({ error } = await S.sb.from("tips").delete().eq("user_id", id).eq("match_id", m.id));
    if (!error) S.myTips.delete(m.id);
  } else {
    ({ error } = await S.sb.from("tips").upsert({ user_id: id, match_id: m.id, home: hv, away: av, updated_at: new Date().toISOString() }, { onConflict: "user_id,match_id" }));
    if (!error) S.myTips.set(m.id, { home: hv, away: av });
  }
  if (error) setMsg(card, started(m) ? "Kampen er gået i gang" : "Ikke gemt. Prøv igen.", "err");
  else setMsg(card, hv == null ? "Tip slettet" : "Gemt", "ok");
  updateRoundSum();
}
function setMsg(card, text, kind) {
  card._msg = { text, kind, at: Date.now() };
  refreshCard(card);
}

function refreshRows() {
  if (S.view !== "kampe") return;
  document.querySelectorAll(".match").forEach(refreshCard);
  updateRoundSum();
}

function refreshCard(card) {
  const m = S.matches.find((x) => x.id === card._m.id) || card._m;
  card._m = m;
  const st = started(m), mine = S.myTips.get(m.id) || null;
  $(".time", card).textContent = fmtTime(m.kickoff);
  card.classList.toggle("locked", st);

  // hjul: opdater kun, hvis brugeren ikke lige har rørt dem
  const idle = Date.now() - Math.max(card._hw.touched, card._aw.touched) > 4000;
  if (!st && idle) { card._hw.set(mine ? mine.home : null); card._aw.set(mine ? mine.away : null); }
  card._hw.disable(st); card._aw.disable(st);
  for (const [d, v] of [[card._dh, mine?.home], [card._da, mine?.away]]) {
    d.textContent = v == null ? "–" : String(v);
    d.classList.toggle("empty", v == null);
  }

  // status
  const status = $(".status", card); status.innerHTML = "";
  const p = points(mine, m);
  if (isDone(m)) status.append(h("span", { class: "pts p" + p, text: `${p} p` }));
  else if (OFF.includes(m.status)) status.append(h("span", { text: "Udsat" }));
  else if (isLive(m) || (st && !isDone(m))) status.append(h("span", { class: "live", text: isLive(m) && m.home_goals != null ? `Live ${m.home_goals}–${m.away_goals}` : "I gang" }));
  else if (card._msg && Date.now() - card._msg.at < 3000) status.append(h("span", { class: card._msg.kind, text: card._msg.text }));
  else if (!mine) status.append(h("span", { text: "Mangler tip" }));
  else status.append(h("span", { class: "ok", text: "Tippet" }));

  $(".final", card).textContent = isDone(m) ? `Slutresultat ${m.home_goals}–${m.away_goals}` : st && !isDone(m) ? "Dit tip er låst" : "";

  // andres tips fra kampstart
  const others = $(".others", card); others.innerHTML = "";
  others.hidden = !st;
  if (st) {
    for (const pl of S.players) {
      const t = S.roundTips.find((x) => x.user_id === pl.user_id && x.match_id === m.id);
      const pp = points(t, m);
      others.append(h("span", { class: "chip" + (pp != null ? " p" + pp : "") + (pl.user_id === uid() ? " me" : "") },
        pl.nick, h("b", { text: t ? `${t.home}–${t.away}` : "intet tip" }), pp != null ? h("i", { text: `${pp} p` }) : null));
    }
  }
}

function updateRoundSum() {
  const el = $("#roundsum"); if (!el) return;
  const ms = S.matches.filter((m) => m.round === S.round);
  const done = ms.filter(isDone);
  const missing = ms.filter((m) => !started(m) && !OFF.includes(m.status) && !S.myTips.has(m.id)).length;
  const pts = done.reduce((s, m) => s + (points(S.myTips.get(m.id), m) || 0), 0);
  const parts = [];
  if (done.length) parts.push(`Dine point i runden: ${pts}`);
  if (missing) parts.push(`${missing} ${missing === 1 ? "kamp mangler" : "kampe mangler"} dit tip`);
  el.textContent = parts.join(". ");
}

function adminPanel(m) {
  const rh = h("input", { type: "number", min: "0", max: "30", inputmode: "numeric", "aria-label": "Hjemmemål", value: m.home_goals ?? "" });
  const ra = h("input", { type: "number", min: "0", max: "30", inputmode: "numeric", "aria-label": "Udemål", value: m.away_goals ?? "" });
  return h("div", { class: "adm" }, "Resultat", rh, "–", ra,
    h("button", { class: "btn", onclick: async () => {
      const a = parseInt(rh.value, 10), b = parseInt(ra.value, 10);
      if (Number.isNaN(a) || Number.isNaN(b)) return toast("Skriv begge tal");
      const { error } = await S.sb.from("matches").update({ home_goals: a, away_goals: b, status: "FINISHED", manual: true }).eq("id", m.id);
      toast(error ? "Resultatet blev ikke gemt" : "Resultat gemt");
      refresh();
    } }, "Gem slutresultat"),
    m.manual ? h("button", { class: "btn ghost", onclick: async () => {
      const { error } = await S.sb.from("matches").update({ manual: false }).eq("id", m.id);
      toast(error ? "Kunne ikke ændres" : "Resultatet hentes automatisk igen ved næste opdatering");
      refresh();
    } }, "Brug automatisk resultat") : null);
}

// ---------- Stilling ----------
function computeStandings() {
  const complete = new Set(S.roundStatus.filter((r) => r.finished > 0 && r.finished + r.postponed >= r.total).map((r) => r.round));
  const byRound = new Map();
  for (const r of S.roundScores) { if (!byRound.has(r.round)) byRound.set(r.round, []); byRound.get(r.round).push(r); }
  const winners = new Map(); // runde -> [user_id]
  for (const [round, rows] of byRound) {
    if (!complete.has(round)) continue;
    const best = Math.max(...rows.map((r) => r.points));
    if (best > 0) winners.set(round, rows.filter((r) => r.points === best).map((r) => r.user_id));
  }
  const table = S.players.map((p) => {
    const mine = S.roundScores.filter((r) => r.user_id === p.user_id);
    return {
      user_id: p.user_id,
      points: mine.reduce((s, r) => s + r.points, 0),
      exact: mine.reduce((s, r) => s + r.exact, 0),
      outcome: mine.reduce((s, r) => s + r.outcome, 0),
      wins: [...winners.values()].filter((w) => w.includes(p.user_id)).length,
    };
  }).sort((a, b) => b.points - a.points || b.exact - a.exact || b.wins - a.wins || nick(a.user_id).localeCompare(nick(b.user_id), "da"));
  return { complete, byRound, winners, table };
}

function renderStandings(main) {
  const { complete, byRound, table } = computeStandings();

  // Rundens vinder: seneste færdigspillede runde, plus hvem der fører den igangværende
  const leaders = (r) => {
    const rows = byRound.get(r) || [];
    const best = rows.length ? Math.max(...rows.map((x) => x.points)) : 0;
    return { best, names: rows.filter((x) => x.points === best).map((x) => nick(x.user_id)) };
  };
  const scored = [...byRound.keys()].sort((a, b) => b - a);
  const lastDone = scored.find((r) => complete.has(r));
  const current = scored.find((r) => !complete.has(r) && (lastDone == null || r > lastDone));
  if (lastDone != null || current != null) {
    const w = lastDone != null ? leaders(lastDone) : null;
    const c = current != null ? leaders(current) : null;
    main.append(h("div", { class: "card winner" },
      h("div", { class: "cup", "aria-hidden": "true" }, "🏆"),
      h("div", {},
        w ? h("h2", { text: `Rundens vinder, runde ${lastDone}` }) : h("h2", { text: `Runde ${current} er i gang` }),
        w ? h("div", { class: "names", text: w.best > 0 ? w.names.join(" og ") : "Ingen vinder" }) : null,
        w && w.best > 0 ? h("p", { text: `${w.best} point` }) : null,
        c && c.best > 0 ? h("p", { class: "lead", text: `Fører runde ${current} lige nu: ${c.names.join(" og ")} med ${c.best} point` }) : null)));
  }

  // Sæsontabel
  const tb = h("tbody");
  let pos = 0, prev = null;
  table.forEach((r, i) => {
    if (!prev || r.points !== prev.points || r.exact !== prev.exact) pos = i + 1;
    prev = r;
    const top = pos === 1 && r.points > 0;
    tb.append(h("tr", { class: (top ? "top " : "") + (r.user_id === uid() ? "me" : "") },
      h("td", { class: "pos" }, top ? h("span", { text: pos }) : String(pos)),
      h("td", { class: "name l", text: nick(r.user_id) }),
      h("td", { text: r.wins }), h("td", { text: r.exact }), h("td", { text: r.outcome }),
      h("td", { class: "total", text: r.points })));
  });
  main.append(h("div", { class: "card" },
    h("h2", { text: "Sæsonstilling" }),
    h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {},
        h("th", {}, "#"), h("th", { class: "l" }, "Spiller"),
        h("th", { title: "Vundne runder" }, "Sejre"), h("th", { title: "Rigtige ciffertips (100 p)" }, "Ciffer"),
        h("th", { title: "Rigtigt udfald (20 p)" }, "Udfald"), h("th", {}, "Point"))),
      tb)),
    h("p", { class: "muted", style: "margin-top:10px", text: "Ved pointlighed afgør flest ciffertips. Rundesejre tælles, når alle rundens kampe er spillet." })));

  // Top 10 runder
  const top10 = [...S.roundScores].filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.round - b.round).slice(0, 10);
  const card = h("div", { class: "card" }, h("h2", { text: "Sæsonens 10 bedste runder" }));
  if (!top10.length) card.append(h("p", { class: "empty", text: "Listen fyldes, når de første kampe er færdigspillet." }));
  else {
    const body = h("tbody");
    top10.forEach((r, i) => body.append(h("tr", { class: r.user_id === uid() ? "me" : "" },
      h("td", { class: "pos", text: i + 1 }),
      h("td", { class: "name l", text: nick(r.user_id) }),
      h("td", { text: `${r.round}${complete.has(r.round) ? "" : "*"}` }),
      h("td", { text: r.exact }),
      h("td", { class: "total", text: r.points }))));
    card.append(h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", { class: "l" }, "Spiller"), h("th", {}, "Runde"), h("th", {}, "Ciffer"), h("th", {}, "Point"))),
      body)));
    if (top10.some((r) => !complete.has(r.round))) card.append(h("p", { class: "muted", style: "margin-top:10px", text: "* Runden er ikke færdigspillet endnu." }));
  }
  main.append(card);
}

// ---------- Regler og mere ----------
function renderMore(main) {
  main.append(h("div", { class: "card" },
    h("h2", { text: "Sådan spiller du" }),
    h("p", { text: "Rul hjulene til dit bud på resultatet. Tippet gemmes automatisk, og du kan ændre det frem til kampstart. Når kampen fløjtes i gang, er det låst." }),
    h("p", { text: "Fra kampstart kan du se, hvad de andre har tippet. Når kampen er slut, ser alle hinandens point." }),
    h("h3", { text: "Point" }),
    h("p", { text: "Rigtigt ciffertip giver 100 point. Rigtigt udfald (hjemmesejr, uafgjort eller udesejr) giver 20 point. Forkert tip, intet tip eller en kamp, der ikke spilles, giver 0 point." }),
    h("h3", { text: "Turneringen" }),
    h("p", { text: "Højst 10 spillere. Tabellen tæller hele sæsonen. Rundens vinder er den med flest point i en færdigspillet runde. Resultater hentes automatisk fra football-data.org og kommer lidt efter slutfløjt." })));

  main.append(pushCard());

  const nickIn = h("input", { type: "text", id: "newnick", maxlength: "24", value: S.me.nick });
  main.append(h("div", { class: "card" },
    h("h2", { text: "Din profil" }),
    h("div", { class: "field" }, h("label", { for: "newnick" }, "Navn i tabellen"), nickIn),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: async () => {
        const v = nickIn.value.trim(); if (!v) return;
        const { error } = await S.sb.from("players").update({ nick: v }).eq("user_id", uid());
        toast(error ? "Navnet blev ikke gemt" : "Navn gemt"); if (!error) refresh();
      } }, "Gem navn"),
      h("button", { class: "btn ghost", onclick: () => S.sb.auth.signOut() }, "Log ud"))));

  if (S.me.is_admin) main.append(adminCard());
}

function pushCard() {
  const card = h("div", { class: "card notice" }, h("h2", { text: "Påmindelser" }),
    h("p", { text: "Få besked på telefonen, hvis du mangler tips 90 minutter før kampstart." }));
  const body = h("div"); card.append(body);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  (async () => {
    if (!S.cfg.vapidPublicKey) return body.append(h("p", { class: "muted", text: "Påmindelser er ikke sat op endnu. Administratoren skal tilføje VAPID-nøglerne på Netlify." }));
    if (ios && !standalone) return body.append(h("p", { text: "På iPhone skal appen først ligge på hjemmeskærmen: tryk Del og vælg Føj til hjemmeskærm. Åbn derefter Tipsligaen derfra og slå påmindelser til her." }));
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return body.append(h("p", { class: "muted", text: "Din browser understøtter ikke påmindelser." }));
    if (Notification.permission === "denied") return body.append(h("p", { text: "Du har blokeret notifikationer for Tipsligaen. Slå dem til i browserens eller telefonens indstillinger." }));
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      body.append(h("p", { class: "ok", text: "Påmindelser er slået til på denne enhed." }),
        h("button", { class: "btn ghost", onclick: async () => {
          await S.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          await sub.unsubscribe(); toast("Påmindelser slået fra"); render();
        } }, "Slå påmindelser fra"));
    } else {
      body.append(h("button", { class: "btn flood", onclick: enablePush }, "Slå påmindelser til"));
    }
  })();
  return card;
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifikationer blev ikke tilladt"); return render(); }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.cfg.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await S.sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: uid(), p256dh: j.keys.p256dh, auth: j.keys.auth });
    toast(error ? "Påmindelser kunne ikke gemmes" : "Påmindelser er slået til");
  } catch (e) {
    toast("Påmindelser kunne ikke slås til");
  }
  render();
}
function b64ToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function adminCard() {
  const codeP = h("p", { text: "Henter invitationskode..." });
  S.sb.rpc("get_invite_code").then(({ data }) => { codeP.textContent = data ? `Invitationskode: ${data}` : "Invitationskoden kunne ikke hentes."; });
  const toggle = h("input", { type: "checkbox", id: "admtoggle", checked: S.admin, onchange: (e) => { S.admin = e.target.checked; toast(S.admin ? "Resultatfelter vises under Kampe" : "Resultatfelter skjult"); } });
  return h("div", { class: "card" },
    h("h2", { text: "Administrator" }),
    codeP,
    h("p", { class: "muted", text: `Send linket til appen og koden til de andre. ${S.players.length} af 10 pladser er taget.` }),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: async (e) => {
        e.target.disabled = true;
        const r = await fetch("/api/sync", { method: "POST", headers: { authorization: "Bearer " + S.session.access_token } });
        const j = await r.json().catch(() => ({}));
        e.target.disabled = false;
        toast(r.ok ? `${j.count} kampe hentet` : j.error || "Kampene kunne ikke hentes");
        if (r.ok) { S.round = null; await loadAll(); S.round = defaultRound(); await loadRoundTips(); }
      } }, "Hent kampe nu")),
    h("label", { for: "admtoggle", class: "check" }, toggle, h("span", { text: "Vis felter til manuelle resultater under Kampe" })));
}

init();
