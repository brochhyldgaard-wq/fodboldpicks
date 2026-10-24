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
const BALL_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#fff" stroke="#111" stroke-width="3"/><path d="M32 20l11 8-4 13H25l-4-13z" fill="#111"/><path d="M32 2v18M43 28l17-6M39 41l10 15M25 41L15 56M21 28L4 22" stroke="#111" stroke-width="3"/><path d="M27 3l5 4 5-4M58 17l-1 7 5 3M54 54l-6-1-3 6M10 54l6-1 3 6M6 17l1 7-5 3" fill="#111"/></svg>';
function ball(cls = "ball") { const s = document.createElement("span"); s.className = cls; s.innerHTML = BALL_SVG; return s; }
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

// ---------- citater ----------
function hashStr(x) { let n = 0; for (const c of String(x)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n; }
function quote(cat, key) {
  const list = (window.QUOTES && window.QUOTES[cat]) || [];
  if (!list.length) return null;
  return list[key == null ? Math.floor(Math.random() * list.length) : hashStr(cat + ":" + key) % list.length];
}
// Citatkort: vises i 5 sekunder, når det kommer i syne, og bliver derefter til en lille "Citat"-knap
const SEEN_KEY = "tl-seen-quotes";
let seenQuotes;
try { seenQuotes = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { seenQuotes = new Set(); }
function markSeen(key) {
  seenQuotes.add(key);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenQuotes].slice(-300))); } catch (e) {}
}
const QUOTE_MS = 5000;   // så længe et citat vises
const QUOTE_GAP = 3000;  // pause, før næste citat må vises
// Kun ét citat ad gangen: de andre venter i kø, til de er synlige, og pausen er gået
const QQ = { active: null, lastClose: 0, waiting: new Set(), timer: null };
function qSchedule() {
  clearTimeout(QQ.timer);
  if (QQ.active && !QQ.active.isConnected) { QQ.active = null; QQ.lastClose = Date.now(); }
  if (QQ.active) return;
  const wait = QQ.lastClose + QUOTE_GAP - Date.now();
  if (wait > 0) { QQ.timer = setTimeout(qSchedule, wait + 20); return; }
  let next = null;
  for (const w of [...QQ.waiting]) {
    if (!w.isConnected) { QQ.waiting.delete(w); continue; }
    if (w._visible && (!next || w.getBoundingClientRect().top < next.getBoundingClientRect().top)) next = w;
  }
  if (next) { QQ.waiting.delete(next); next._open(); }  // øverste synlige citat først
}
const quoteObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) e.target._visible = e.isIntersecting && e.intersectionRatio >= 0.6;
  qSchedule();
}, { threshold: [0, 0.6] }) : null;

function quoteEl(q, variant, key) {
  if (!q) return null;
  key = key || q.t;
  const mic = h("span", { class: "mic", "aria-hidden": "true" });
  mic.innerHTML = '<svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="13" rx="4" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  const fig = h("figure", { class: "quote", title: "Tryk for at skjule" },
    h("blockquote", { text: q.t }),
    h("figcaption", { class: "strap" }, h("span", { class: "tag" }, mic, "Citat"), h("span", { class: "name", text: q.a })),
    h("span", { class: "qtimer", "aria-hidden": "true" }));
  const pill = h("button", { class: "qpill", type: "button", "aria-label": `Vis citat af ${q.a}` }, mic.cloneNode(true), "Citat");
  const wrap = h("div", { class: "qwrap closed " + (variant || ""), "data-qkey": key }, fig, pill);
  let t = null;
  wrap._open = () => {
    if (QQ.active && QQ.active !== wrap) QQ.active._close(true);
    QQ.active = wrap; markSeen(key);
    wrap.classList.remove("closed", "closing", "running"); void wrap.offsetWidth; wrap.classList.add("running");
    clearTimeout(t); t = setTimeout(() => wrap._close(), QUOTE_MS);
  };
  wrap._close = (instant) => {
    clearTimeout(t);
    if (QQ.active === wrap) { QQ.active = null; QQ.lastClose = Date.now(); }
    const done = () => { wrap.classList.remove("closing", "running"); wrap.classList.add("closed"); };
    if (wrap.classList.contains("closed")) return;
    if (instant || reduceMotion) done(); else { wrap.classList.add("closing"); setTimeout(done, 350); }
    qSchedule();
  };
  pill.addEventListener("click", () => { QQ.waiting.delete(wrap); wrap._open(); });
  fig.addEventListener("click", () => wrap._close());
  if (!seenQuotes.has(key)) {
    QQ.waiting.add(wrap);
    if (quoteObserver) requestAnimationFrame(() => quoteObserver.observe(wrap));
    else { wrap._visible = true; setTimeout(qSchedule, 0); }
  }
  return wrap;
}
// Genbrug et citat, der allerede står på siden, så det ikke springer frem igen ved opdatering
function setQuote(container, q, variant, key) {
  if (!container) return;
  if (!q) { container.innerHTML = ""; container.dataset.qkey = ""; return; }
  if (container.dataset.qkey === key && container.firstChild) return;
  container.innerHTML = ""; container.dataset.qkey = key;
  container.append(quoteEl(q, variant, key));
}

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
  subscribeComments();
  subscribeTalk();
}

async function loadAll() {
  const id = uid();
  const [pl, ma, mt, rs, rst] = await Promise.all([
    S.sb.from("players").select("*").order("joined_at"),
    S.sb.from("matches").select("*").order("kickoff").limit(1000),
    S.sb.from("tips").select("match_id, home, away").eq("user_id", id).limit(1000),
    S.sb.from("round_scores").select("*").limit(1000),
    S.sb.from("round_status").select("*"),
  ]);
  for (const r of [pl, ma, mt, rs, rst]) if (r.error) throw r.error;
  S.players = pl.data; S.matches = ma.data; S.roundScores = rs.data; S.roundStatus = rst.data;
  const [st, sc] = await Promise.all([
    S.sb.from("pl_standings").select("*").order("position"),
    S.sb.from("pl_scorers").select("*").order("rank"),
  ]);
  S.plTable = st.error ? null : st.data; S.plScorers = sc.error ? [] : sc.data;
  S.myTips = new Map(mt.data.map((t) => [t.match_id, { home: t.home, away: t.away }]));
  S.me = S.players.find((p) => p.user_id === id) || null;
}

async function loadRoundTips() {
  const ids = S.matches.filter((m) => m.round === S.round).map((m) => m.id);
  if (!ids.length) { S.roundTips = []; return; }
  const { data, error } = await S.sb.from("tips").select("user_id, match_id, home, away").in("match_id", ids).limit(1000);
  S.roundTips = error ? [] : data;
  await loadComments(ids);
}

async function refresh() {
  try { await loadAll(); await loadRoundTips(); } catch (e) { return; }
  if (S.view === "kampe") refreshRows(); else if (S.view === "stilling" && talkBusy()) { /* lad være med at gentegne, mens nogen skriver */ } else if (S.view !== "pl") render(); // PL-fanen gentegnes ikke, så åbne previews bliver stående
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
function renderAuth(mode = "login", msg = "", keep = {}) {
  $("#tabs").hidden = true;
  const main = $("#main"); main.innerHTML = "";
  // Ingen autokorrektur, ingen store forbogstaver: telefoner ændrer ellers i e-mail og adgangskode
  const noFix = { autocapitalize: "none", autocorrect: "off", spellcheck: "false" };
  const email = h("input", { type: "email", id: "email", autocomplete: "email", inputmode: "email", required: true, ...noFix });
  const pw = h("input", { type: "password", id: "pw", autocomplete: mode === "login" ? "current-password" : "new-password", minlength: "6", required: true, ...noFix });
  email.value = keep.email || "";
  pw.value = keep.password || "";
  const show = h("input", { type: "checkbox", id: "showpw", onchange: (e) => { pw.type = e.target.checked ? "text" : "password"; } });
  const submit = h("button", { class: "btn flood", type: "submit" }, mode === "login" ? "Log ind" : "Opret bruger");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault(); submit.disabled = true;
      const creds = { email: email.value.trim().toLowerCase(), password: pw.value.replace(/\s+$/, "") };
      const { data, error } = mode === "login" ? await S.sb.auth.signInWithPassword(creds) : await S.sb.auth.signUp(creds);
      submit.disabled = false;
      if (error) return renderAuth(mode, oversaet(error.message), { email: email.value, password: pw.value });
      if (mode === "signup" && !data.session) return renderAuth("login", "Brugeren er oprettet, men skal bekræftes via mail. Bed administratoren slå bekræftelse fra i Supabase.");
    },
  },
    h("div", { class: "field" }, h("label", { for: "email" }, "E-mail"), email),
    h("div", { class: "field" }, h("label", { for: "pw" }, mode === "login" ? "Adgangskode" : "Vælg en adgangskode (mindst 6 tegn)"), pw),
    h("label", { for: "showpw", class: "check", style: "margin:0 0 14px" }, show, h("span", { text: "Vis adgangskode" })),
    h("div", { class: "row" }, submit,
      h("button", { type: "button", class: "linkbtn", onclick: () => renderAuth(mode === "login" ? "signup" : "login", "", { email: email.value }) },
        mode === "login" ? "Ny her? Opret bruger" : "Har du en bruger? Log ind")));
  main.append(h("div", { class: "card" },
    h("h2", { text: mode === "login" ? "Log ind" : "Opret bruger" }),
    msg ? h("p", { class: "muted", role: "alert", text: msg }) : null,
    form));
  if (!S.loginQuote) S.loginQuote = quote("generelt");
  main.append(quoteEl(S.loginQuote, "q-free", "login:" + S.loginQuote.t + ":" + Date.now()));
}
function oversaet(m) {
  if (/Invalid login/i.test(m)) return "Forkert e-mail eller adgangskode. Slå \"Vis adgangskode\" til og tjek, at telefonen ikke har ændret noget.";
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
  else if (S.view === "pl") renderPL(main);
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
  main.append(h("section", { class: "scoreboard", "aria-label": "Rundetavle" },
    h("div", { class: "sb-top" },
      h("button", { class: "arrow", "aria-label": "Forrige runde", disabled: i <= 0, onclick: () => go(rs[i - 1]) }, "‹"),
      h("div", { class: "sb-title" },
        h("span", { class: "sb-label", text: "Runde" }),
        h("span", { class: "led big", text: String(S.round).padStart(2, "0") })),
      h("button", { class: "arrow", "aria-label": "Næste runde", disabled: i >= rs.length - 1, onclick: () => go(rs[i + 1]) }, "›")),
    h("div", { class: "sb-date", text: range }),
    h("div", { class: "sb-stats", id: "roundsum" }),
    h("div", { id: "roundquote" })));
  let lastDay = "";
  for (const m of ms) {
    const d = fmtDay(m.kickoff);
    if (d !== lastDay) { main.append(h("div", { class: "day" }, h("span", { text: d }))); lastDay = d; }
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
      h("div", { class: "circle", "aria-hidden": "true" }),
      h("div", { class: "team" }, crest(m.home_crest, m.home), h("span", { text: m.home })),
      h("div", { class: "tip" }, h("span", { class: "slut", "aria-hidden": "true" }, "Slut"), hw.el, h("span", { class: "colon", "aria-hidden": "true" }, ":"), aw.el,
        h("div", { class: "digits", "aria-label": "Dit tip" }, dh, h("span", { class: "colon", "aria-hidden": "true" }, ":"), da)),
      h("div", { class: "team" }, crest(m.away_crest, m.away), h("span", { text: m.away }))),
    h("div", { class: "final" }),
    h("div", { class: "mquote" }),
    h("div", { class: "others" }),
    commentBox({ key: m.id, match: m }),
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
  const done = isDone(m);
  card.classList.toggle("done", done);

  // hjul: opdater kun, hvis brugeren ikke lige har rørt dem
  const idle = Date.now() - Math.max(card._hw.touched, card._aw.touched) > 4000;
  if (!st && idle) { card._hw.set(mine ? mine.home : null); card._aw.set(mine ? mine.away : null); }
  card._hw.disable(st); card._aw.disable(st);
  // efter slutfløjt viser tavlen kampens resultat, ellers dit tip
  const shown = done ? { home: m.home_goals, away: m.away_goals } : mine;
  card.querySelector(".digits").setAttribute("aria-label", done ? `Slutresultat ${m.home_goals}–${m.away_goals}` : "Dit tip");
  for (const [d, v] of [[card._dh, shown?.home], [card._da, shown?.away]]) {
    d.textContent = v == null ? "–" : String(v);
    d.classList.toggle("empty", v == null);
  }

  // status
  const status = $(".status", card); status.innerHTML = "";
  const p = points(mine, m);
  if (isDone(m)) status.append(p === 100 ? h("span", { class: "pts p100" }, ball("ball sm"), "Ciffer! 100 p") : h("span", { class: "pts p" + p, text: p === 20 ? "Udfald 20 p" : "0 p" }));
  else if (OFF.includes(m.status)) status.append(h("span", { text: "Udsat" }));
  else if (isLive(m) && m.home_goals != null) status.append(h("span", { class: "live", text: `Live ${m.home_goals}–${m.away_goals}` }));
  else if (st && Date.now() - new Date(m.kickoff).getTime() > 150 * 60000) status.append(h("span", { text: "Afventer resultat" }));
  else if (st) status.append(h("span", { class: "live", text: "Kampen er i gang" }));
  else if (card._msg && Date.now() - card._msg.at < 3000) status.append(h("span", { class: card._msg.kind, text: card._msg.text }));
  else if (!mine) status.append(h("span", { text: "Mangler tip" }));
  else status.append(h("span", { class: "ok", text: "Tippet" }));

  const fin = $(".final", card); fin.innerHTML = "";
  if (done) fin.append(h("span", { class: "mytip" + (mine ? "" : " none") }, h("span", { class: "lbl", text: "Dit tip" }), h("b", { text: mine ? `${mine.home}–${mine.away}` : "intet tip" })));
  else if (st) fin.append(h("span", { class: "muted-light", text: "Dit tip er låst" }));
  setQuote($(".mquote", card), p === 100 ? quote("ciffertip", m.id) : null, "q-pitch", "ciffer:" + m.id);

  updateCommentBox($(".cbox", card));
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
  const cell = (label, val, warn) => h("div", { class: "sb-cell" + (warn ? " warn" : "") }, h("span", { class: "led", text: String(val) }), h("span", { class: "sb-label", text: label }));
  el.innerHTML = "";
  el.append(cell("Dine point", pts), cell("Mangler tip", missing, missing > 0), cell("Spillet", `${done.length}/${ms.length}`));
  const rq = $("#roundquote");
  if (missing > 0) setQuote(rq, quote("manglerTip", S.round), "q-board", "mangler:" + S.round);
  else if (done.length > 0 && pts === 0) setQuote(rq, quote("nulPoint", S.round), "q-board", "nul:" + S.round);
  else setQuote(rq, null);
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

function trophy() {
  const s = document.createElement("span");
  s.innerHTML = '<svg viewBox="0 0 64 64" width="56" height="56"><path d="M18 6h28v14c0 10-6 18-14 18S18 30 18 20z" fill="#f6d33c"/><path d="M18 10H8c0 10 4 15 11 16M46 10h10c0 10-4 15-11 16" fill="none" stroke="#f6d33c" stroke-width="4"/><rect x="28" y="38" width="8" height="10" fill="#d9b21f"/><rect x="18" y="48" width="28" height="8" rx="2" fill="#f6d33c"/><rect x="14" y="56" width="36" height="5" rx="2" fill="#d9b21f"/></svg>';
  return s;
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
      h("div", { class: "cup", "aria-hidden": "true" }, trophy()),
      h("div", {},
        w ? h("h2", { text: `Rundens vinder, runde ${lastDone}` }) : h("h2", { text: `Runde ${current} er i gang` }),
        w ? h("div", { class: "names", text: w.best > 0 ? w.names.join(" og ") : "Ingen vinder" }) : null,
        w && w.best > 0 ? h("p", { text: `${w.best} point` }) : null,
        c && c.best > 0 ? h("p", { class: "lead", text: `Fører runde ${current} lige nu: ${c.names.join(" og ")} med ${c.best} point` }) : null),
      w && w.best > 0 ? quoteEl(quote("rundensVinder", lastDone), "q-in-dark", "vinder:" + lastDone) : null));
  }

  // Sæsontabel
  const tb = h("tbody");
  let pos = 0, prev = null;
  table.forEach((r, i) => {
    if (!prev || r.points !== prev.points || r.exact !== prev.exact) pos = i + 1;
    prev = r;
    const top = pos === 1 && r.points > 0;
    const zone = top ? "z-champ" : (table.length >= 4 && i === table.length - 1 && r.points < table[0].points ? "z-releg" : "");
    tb.append(h("tr", { class: (top ? "top " : "") + zone + (r.user_id === uid() ? " me" : "") },
      h("td", { class: "pos" }, top ? h("span", { text: pos }) : String(pos)),
      h("td", { class: "name l", text: nick(r.user_id) }),
      h("td", { class: "c", text: r.wins }), h("td", { class: "c", text: r.outcome }), h("td", { class: "c", text: r.exact }),
      h("td", { class: "total", text: r.points })));
  });
  const lastRound = Math.max(0, ...S.roundScores.map((r) => r.round));
  main.append(h("div", { class: "card table-card league" },
    h("div", { class: "league-head" },
      h("h2", { text: "Sæsonstilling" }),
      lastRound ? h("span", { class: "sub", text: `Efter runde ${lastRound}` }) : null),
    h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {},
        h("th", {}, "#"), h("th", { class: "l" }, "Spiller"),
        h("th", { class: "two", title: "Vundne runder" }, "Runde-", h("br"), "sejre"), h("th", { class: "two", title: "Rigtigt udfald, 20 point" }, "Rigtigt", h("br"), "udfald"),
        h("th", { class: "two", title: "Rigtige ciffertips, 100 point" }, "Rigtige", h("br"), "cifre"), h("th", {}, "Point"))),
      tb)),
    table.length && table[0].points > 0 ? quoteEl(quote("forerLigaen", table[0].user_id + ":" + lastRound), "q-league", "leder:" + table[0].user_id + ":" + lastRound) : null,
    h("div", { class: "legend" },
      h("span", { class: "key champ" }, "Fører ligaen"),
      table.length >= 4 ? h("span", { class: "key releg" }, "Nedrykningsstreg") : null),
    h("p", { class: "muted", style: "margin-top:10px", text: "Ved pointlighed afgør flest rigtige cifre, derefter flest runde-sejre. Runde-sejre tælles, når alle rundens kampe er spillet." })));

  // Snak om stillingen
  const talk = h("div", { class: "card talk-card" }, h("div", { class: "league-head" }, h("h2", { text: "Snak om stillingen" }), h("span", { class: "sub", text: "For alle spillere" })));
  main.append(talk);
  const fill = () => { talk.querySelectorAll(".cbox").forEach((b) => b.remove()); talk.append(commentBox({ key: "topic:stilling", topic: "stilling", open: true })); };
  if (S.comments.has("topic:stilling")) fill();
  else loadTopic("stilling").then((ok) => { if (ok) fill(); else talk.remove(); });

  main.append(talkCard());
  renderProgress(main);

  // Top 10 runder
  const top10 = [...S.roundScores].filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.round - b.round).slice(0, 10);
  const card = h("div", { class: "card table-card minor" }, h("h2", { text: "Sæsonens 10 bedste spillerunder" }));
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
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", { class: "l" }, "Spiller"), h("th", {}, "Spillerunde"), h("th", {}, "Rigtige cifre"), h("th", {}, "Point"))),
      body)));
    if (top10.some((r) => !complete.has(r.round))) card.append(h("p", { class: "muted", style: "margin-top:10px", text: "* Spillerunden er ikke færdigspillet endnu." }));
  }
  main.append(card);
}

// ---------- Graf: udviklingen runde for runde ----------
const PCOL = ["#ffc928", "#4fc3f7", "#ff7a59", "#9ccc65", "#ce93d8", "#ffffff", "#26c6da", "#f48fb1", "#ffb74d", "#b0bec5"];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function progressData() {
  const rounds = [...new Set(S.roundScores.map((r) => r.round))].sort((a, b) => a - b);
  const ids = S.players.map((p) => p.user_id);
  const cum = new Map(ids.map((id) => [id, { p: 0, e: 0 }]));
  const series = new Map(ids.map((id) => [id, []]));
  for (const r of rounds) {
    for (const row of S.roundScores.filter((x) => x.round === r)) {
      const c = cum.get(row.user_id); if (c) { c.p += row.points; c.e += row.exact; }
    }
    const sorted = [...ids].sort((a, b) => cum.get(b).p - cum.get(a).p || cum.get(b).e - cum.get(a).e);
    let pos = 0, prev = null;
    sorted.forEach((id, i) => {
      const c = cum.get(id);
      if (!prev || c.p !== prev.p || c.e !== prev.e) pos = i + 1;
      prev = { p: c.p, e: c.e };
      series.get(id).push({ round: r, pos, pts: c.p });
    });
  }
  return { rounds, series, ids };
}

function renderProgress(main) {
  const { rounds, series, ids } = progressData();
  const card = h("div", { class: "card chart-card" }, h("h2", { text: "Udviklingen runde for runde" }));
  if (!rounds.length || !ids.length) {
    card.append(h("p", { class: "empty-dark", text: "Grafen tegnes, når den første runde har givet point." }));
    main.append(card); return;
  }
  const mode = S.chartMode || "pos";
  card.append(h("div", { class: "seg", role: "group", "aria-label": "Vis" },
    ...[["pos", "Placering"], ["pts", "Point"]].map(([k, l]) =>
      h("button", { class: k === mode ? "on" : "", "aria-pressed": k === mode ? "true" : "false", onclick: () => { S.chartMode = k; render(); } }, l))));

  const n = ids.length, W = 520, padL = 40, padR = 112, padT = 18, padB = 42;
  const H = mode === "pos" ? padT + padB + Math.max(n - 1, 1) * 44 : 300;
  const maxPts = Math.max(1, ...ids.map((id) => series.get(id).at(-1).pts));
  const step = Math.pow(10, Math.floor(Math.log10(maxPts))) * (maxPts / Math.pow(10, Math.floor(Math.log10(maxPts))) > 5 ? 2 : 1);
  const top = Math.ceil(maxPts / step) * step || 1;
  const X = (i) => rounds.length === 1 ? padL + (W - padL - padR) / 2 : padL + i * (W - padL - padR) / (rounds.length - 1);
  const Y = (v) => mode === "pos" ? padT + (n > 1 ? (v - 1) * (H - padT - padB) / (n - 1) : (H - padT - padB) / 2) : padT + (1 - v / top) * (H - padT - padB);
  const focus = S.chartFocus || null;
  let g = "";

  // gitter
  if (mode === "pos") {
    for (let p = 1; p <= n; p++) g += `<line x1="${padL}" x2="${W - padR + 8}" y1="${Y(p)}" y2="${Y(p)}" class="grid"/><text x="${padL - 14}" y="${Y(p) + 6}" class="ax" text-anchor="end">${p}</text>`;
  } else {
    for (let v = 0; v <= top; v += step) g += `<line x1="${padL}" x2="${W - padR + 8}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${padL - 10}" y="${Y(v) + 6}" class="ax" text-anchor="end">${v}</text>`;
  }
  const every = Math.ceil(rounds.length / 7);
  rounds.forEach((r, i) => { if (i % every === 0 || i === rounds.length - 1) g += `<text x="${X(i)}" y="${H - 12}" class="ax" text-anchor="middle">R${r}</text>`; });

  // linjer, mig og fokus tegnes sidst så de ligger øverst
  const order = [...ids].sort((a, b) => (a === focus || a === uid() ? 1 : 0) - (b === focus || b === uid() ? 1 : 0));
  const ends = [];
  for (const id of order) {
    const i = ids.indexOf(id), col = PCOL[i % PCOL.length], pts = series.get(id);
    const dim = focus && focus !== id;
    const wide = id === uid() || id === focus;
    const val = (d) => mode === "pos" ? d.pos : d.pts;
    const d = pts.map((p, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(val(p)).toFixed(1)}`).join(" ");
    g += `<g class="ln${dim ? " dim" : ""}">`;
    if (pts.length > 1) g += `<path d="${d}" stroke="${col}" stroke-width="${wide ? 5 : 3}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, k) => { g += `<circle cx="${X(k)}" cy="${Y(val(p))}" r="${wide ? 6 : 4.5}" fill="${col}" stroke="#0a120d" stroke-width="2"/>`; });
    g += `</g>`;
    const last = pts.at(-1);
    ends.push({ id, col, dim, y: Y(val(last)), label: mode === "pos" ? nick(id) : `${nick(id)} ${last.pts}` });
  }
  // navne i højre side, skubbet fra hinanden ved lighed
  ends.sort((a, b) => a.y - b.y);
  let lastY = -99;
  for (const e of ends) {
    const yy = Math.max(e.y, lastY + 22); lastY = yy;
    g += `<text x="${W - padR + 16}" y="${yy + 6}" class="nm${e.dim ? " dim" : ""}" fill="${e.col}">${esc(e.label)}</text>`;
  }
  const wrap = h("div", { class: "chart" });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode === "pos" ? "Placering" : "Point"} for hver spiller efter hver runde">${g}</svg>`;
  card.append(wrap);

  // forklaring: tryk for at fremhæve en spiller
  card.append(h("div", { class: "chart-legend" },
    ids.map((id, i) => h("button", { class: focus === id ? "on" : "", "aria-pressed": focus === id ? "true" : "false",
      onclick: () => { S.chartFocus = S.chartFocus === id ? null : id; render(); } },
      h("span", { class: "dot", style: `background:${PCOL[i % PCOL.length]}` }), nick(id)))));
  card.append(h("p", { class: "hint", text: "Tryk på et navn for at fremhæve spilleren." }));
  main.append(card);
}

// ---------- Kommentarer: talebobler til kampe og til stillingen ----------
// Hver tråd har en nøgle: kampens id, eller "topic:stilling" for sæsonstillingen.
S.comments = new Map();
const MAX_COMMENT = 140;
const keyOf = (c) => c.match_id || "topic:" + c.topic;
async function loadComments(ids) {
  if (!ids || !ids.length) return;
  const { data, error } = await S.sb.from("comments").select("*").in("match_id", ids).order("created_at").limit(1000);
  if (error) { S.commentsOff = true; return; } // tabellen findes ikke endnu
  S.commentsOff = false;
  for (const id of ids) S.comments.set(id, []);
  for (const c of data) S.comments.get(c.match_id).push(c);
}
async function loadTopic(topic) {
  const { data, error } = await S.sb.from("comments").select("*").eq("topic", topic).order("created_at", { ascending: false }).limit(200);
  if (error) return false; // emne-kolonnen findes ikke endnu
  S.comments.set("topic:" + topic, (data || []).reverse());
  return true;
}
const boxesFor = (key) => document.querySelectorAll(`.cbox[data-ckey="${CSS.escape(key)}"]`);
function addComment(c) {
  const key = keyOf(c);
  const list = S.comments.get(key) || [];
  if (list.some((x) => x.id === c.id)) return;
  list.push(c); list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  S.comments.set(key, list);
  boxesFor(key).forEach((box) => updateCommentBox(box, true));
}
function removeComment(id) {
  for (const [key, list] of S.comments) {
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) { list.splice(i, 1); boxesFor(key).forEach((box) => updateCommentBox(box, true)); }
  }
}
function subscribeComments() {
  if (S.commentChannel || S.commentsOff || !S.sb.channel) return;
  S.commentChannel = S.sb.channel("comments-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, (p) => addComment(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, (p) => p.old && removeComment(p.old.id))
    .subscribe();
}
function phaseOf(c, m) {
  const t = new Date(c.created_at).getTime(), k = new Date(m.kickoff).getTime();
  if (t < k) return ["Før", "ph-before"];
  if (t < k + 115 * 60000) return ["Live", "ph-live"]; // ca. 90 minutter plus pause og tillægstid
  return ["Efter", "ph-after"];
}
const bubbleIcon = () => { const s = document.createElement("span"); s.className = "bicon"; s.setAttribute("aria-hidden", "true"); s.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor"/></svg>'; return s; };

// target: { key, match } for en kamp eller { key, topic, open: true } for et emne
function commentBox(target) {
  const box = h("div", { class: "cbox" + (target.topic ? " topic" : ""), "data-ckey": target.key });
  box._key = target.key; box._m = target.match || null;
  const toggle = h("button", { class: "ctoggle", type: "button", "aria-expanded": "false" }, bubbleIcon(), h("span", { class: "ccount" }));
  const thread = h("div", { class: "cthread", hidden: true }, h("div", { class: "clist", role: "log", "aria-live": "polite" }));
  const setOpen = (open) => {
    thread.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); box.classList.toggle("open", open);
    if (open) renderThread(box);
  };
  toggle.addEventListener("click", () => {
    setOpen(thread.hidden);
    const inp = $(".cinput", box); if (!thread.hidden && inp && matchMedia("(pointer:fine)").matches) inp.focus();
  });
  if (S.me) {
    const inp = h("input", { class: "cinput", type: "text", maxlength: String(MAX_COMMENT), placeholder: target.topic ? "Skriv om stillingen" : "Skriv en kommentar", "aria-label": "Skriv en kommentar", enterkeyhint: "send" });
    const left = h("span", { class: "cleft", "aria-hidden": "true" });
    const send = h("button", { class: "csend", type: "submit", "aria-label": "Send" }, "Send");
    inp.addEventListener("input", () => { left.textContent = MAX_COMMENT - inp.value.length < 30 ? String(MAX_COMMENT - inp.value.length) : ""; });
    const form = h("form", { class: "cform", onsubmit: async (e) => {
      e.preventDefault();
      const body = inp.value.trim(); if (!body) return;
      send.disabled = true;
      const row = target.topic ? { topic: target.topic, user_id: uid(), body } : { match_id: target.match.id, user_id: uid(), body };
      const { data, error } = await S.sb.from("comments").insert(row).select().single();
      send.disabled = false;
      if (error) { toast(/Vent/.test(error.message) ? "Vent et øjeblik, før du skriver igen" : "Kommentaren blev ikke sendt"); return; }
      inp.value = ""; left.textContent = "";
      addComment(data);
      fetch("/api/comment-notify", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + S.session.access_token }, body: JSON.stringify({ comment_id: data.id }) }).catch(() => {});
    } }, inp, left, send);
    thread.append(form);
  }
  box.append(toggle, thread);
  if (target.open) setOpen(true);
  updateCommentBox(box);
  return box;
}
function updateCommentBox(box, fresh) {
  if (!box) return;
  box.hidden = !!S.commentsOff;
  const list = S.comments.get(box._key) || [];
  const n = list.length;
  const isTopic = box.classList.contains("topic");
  $(".ccount", box).textContent = n ? `${n} ${n === 1 ? "kommentar" : "kommentarer"}` : (isTopic ? "Ingen kommentarer endnu" : "Kommentér");
  box.classList.toggle("has", n > 0);
  const last = list[n - 1];
  if (fresh && last && last.user_id !== uid() && $(".cthread", box).hidden) {
    box.classList.remove("ping"); void box.offsetWidth; box.classList.add("ping"); // lille blink ved ny kommentar
  }
  if (!$(".cthread", box).hidden) renderThread(box);
}
function renderThread(box) {
  const el = $(".clist", box); const list = S.comments.get(box._key) || []; const m = box._m;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = "";
  if (!list.length) el.append(h("p", { class: "cempty", text: "Ingen kommentarer endnu. Skriv den første." }));
  const today = new Date().toDateString();
  for (const c of list) {
    const mine = c.user_id === uid();
    const ph = m ? phaseOf(c, m) : null;
    const d = new Date(c.created_at);
    const when = d.toDateString() === today ? fmtTime(d) : `${fmtShort(d)} ${fmtTime(d)}`;
    const canDel = mine || (S.me && S.me.is_admin);
    el.append(h("div", { class: "bubble" + (mine ? " mine" : "") },
      h("div", { class: "bmeta" }, mine ? null : h("b", { text: nick(c.user_id) }), ph ? h("span", { class: "ph " + ph[1], text: ph[0] }) : null, h("span", { class: "bt", text: when }),
        canDel ? h("button", { class: "bdel", type: "button", "aria-label": "Slet kommentar", onclick: async () => {
          if (!confirm("Slet kommentaren?")) return;
          const { error } = await S.sb.from("comments").delete().eq("id", c.id);
          if (error) toast("Kommentaren blev ikke slettet"); else removeComment(c.id);
        } }, "Slet") : null),
      h("p", { class: "btext", text: c.body })));
  }
  if (atBottom || !el._seen) { el.scrollTop = el.scrollHeight; el._seen = true; }
}

// ---------- Debat under sæsonstillingen (tråde forsvinder efter 5 dage) ----------
const TALK_MAX = 280, TALK_DAYS = 5;
S.talk = null; S.talkOpenReply = null;
async function loadTalk() {
  const { data, error } = await S.sb.from("talk").select("id, parent_id, user_id, body, created_at").order("created_at").limit(500);
  S.talkOff = !!error; S.talk = error ? [] : data;
}
function talkBusy() { return [...document.querySelectorAll(".talk input")].some((i) => i.value.trim() || i === document.activeElement); }
function subscribeTalk() {
  if (S.talkChannel || !S.sb.channel) return;
  S.talkChannel = S.sb.channel("talk-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "talk" }, (p) => { if (S.talk && !S.talk.some((x) => x.id === p.new.id)) { S.talk.push(p.new); renderTalkList(); } })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "talk" }, (p) => { if (S.talk && p.old) { S.talk = S.talk.filter((x) => x.id !== p.old.id && x.parent_id !== p.old.id); renderTalkList(); } })
    .subscribe();
}
function expiresText(root) {
  const left = new Date(root.created_at).getTime() + TALK_DAYS * 864e5 - Date.now();
  if (left <= 0) return "Udløber nu";
  const hrs = Math.ceil(left / 36e5);
  if (hrs < 24) return `Forsvinder om ${hrs} ${hrs === 1 ? "time" : "timer"}`;
  const d = Math.ceil(left / 864e5);
  return `Forsvinder om ${d} ${d === 1 ? "dag" : "dage"}`;
}
function talkWhen(iso) {
  const d = new Date(iso), today = new Date().toDateString();
  return d.toDateString() === today ? fmtTime(d) : `${fmtShort(d)} ${fmtTime(d)}`;
}
async function postTalk(body, parentId, btn) {
  btn.disabled = true;
  const { data, error } = await S.sb.from("talk").insert({ user_id: uid(), body, parent_id: parentId || null }).select().single();
  btn.disabled = false;
  if (error) { toast(/Vent/.test(error.message) ? "Vent et øjeblik, før du skriver igen" : /udløbet|findes ikke/.test(error.message) ? "Tråden er udløbet" : "Indlægget blev ikke sendt"); return false; }
  if (!S.talk.some((x) => x.id === data.id)) S.talk.push(data);
  renderTalkList(false);
  return true;
}
function talkForm(placeholder, onSend, cls = "") {
  const inp = h("input", { type: "text", class: "tinput", maxlength: String(TALK_MAX), placeholder, "aria-label": placeholder, enterkeyhint: "send" });
  const btn = h("button", { class: "csend", type: "submit" }, "Send");
  const left = h("span", { class: "cleft", "aria-hidden": "true" });
  inp.addEventListener("input", () => { left.textContent = TALK_MAX - inp.value.length < 40 ? String(TALK_MAX - inp.value.length) : ""; });
  return h("form", { class: "tform " + cls, onsubmit: async (e) => {
    e.preventDefault(); const v = inp.value.trim(); if (!v) return;
    if (await onSend(v, btn)) { inp.value = ""; left.textContent = ""; }
  } }, inp, left, btn);
}
function talkBubble(c, isRoot) {
  const mine = c.user_id === uid();
  const canDel = mine || (S.me && S.me.is_admin);
  return h("div", { class: "bubble" + (mine ? " mine" : "") + (isRoot ? " troot" : " treply") },
    h("div", { class: "bmeta" }, h("b", { text: mine ? "Dig" : nick(c.user_id) }), h("span", { class: "bt", text: talkWhen(c.created_at) }),
      canDel ? h("button", { class: "bdel", type: "button", "aria-label": "Slet", onclick: async () => {
        if (!confirm(isRoot ? "Slet hele tråden?" : "Slet svaret?")) return;
        const { error } = await S.sb.from("talk").delete().eq("id", c.id);
        if (error) toast("Det blev ikke slettet");
        else { S.talk = S.talk.filter((x) => x.id !== c.id && x.parent_id !== c.id); renderTalkList(); }
      } }, "Slet") : null),
    h("p", { class: "btext", text: c.body }));
}
function renderTalkList(keepDraft = true) {
  const el = document.getElementById("talklist"); if (!el || !S.talk) return;
  const openInp = el.querySelector(".treplyform input");
  const draft = keepDraft && openInp ? openInp.value : "";   // bevar et påbegyndt svar
  el.innerHTML = "";
  const alive = (r) => new Date(r.created_at).getTime() > Date.now() - TALK_DAYS * 864e5;
  const roots = S.talk.filter((x) => !x.parent_id && alive(x));
  const replies = (id) => S.talk.filter((x) => x.parent_id === id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const lastAct = (r) => Math.max(new Date(r.created_at).getTime(), ...replies(r.id).map((x) => new Date(x.created_at).getTime()));
  roots.sort((a, b) => lastAct(b) - lastAct(a)); // tråden med seneste aktivitet øverst
  if (!roots.length) { el.append(h("p", { class: "cempty", text: "Ingen tråde lige nu. Start debatten om stillingen." })); return; }
  for (const r of roots) {
    const reps = replies(r.id);
    const t = h("div", { class: "tthread" },
      talkBubble(r, true),
      reps.length ? h("div", { class: "treplies" }, reps.map((x) => talkBubble(x, false))) : null);
    const foot = h("div", { class: "tfoot" }, h("span", { class: "texp", text: expiresText(r) }));
    if (S.me) foot.append(h("button", { class: "treplybtn", type: "button", onclick: () => { S.talkOpenReply = S.talkOpenReply === r.id ? null : r.id; renderTalkList(); } },
      S.talkOpenReply === r.id ? "Luk" : `Svar${reps.length ? ` (${reps.length})` : ""}`));
    t.append(foot);
    if (S.talkOpenReply === r.id) {
      const f = talkForm("Skriv et svar", (v, btn) => postTalk(v, r.id, btn), "treplyform");
      t.append(f);
      requestAnimationFrame(() => { const i = f.querySelector("input"); if (draft) i.value = draft; if (matchMedia("(pointer:fine)").matches) i.focus(); });
    }
    el.append(t);
  }
}
function talkCard() {
  const card = h("div", { class: "card talk" },
    h("div", { class: "league-head" }, h("h2", { text: "Snak om stillingen" }), h("span", { class: "sub", text: `Tråde forsvinder efter ${TALK_DAYS} dage` })));
  const list = h("div", { id: "talklist" }, h("p", { class: "cempty", text: "Henter..." }));
  if (S.me) card.append(talkForm("Start en ny tråd", (v, btn) => postTalk(v, null, btn), "tnew"));
  card.append(list);
  (S.talk ? Promise.resolve() : loadTalk()).then(() => {
    if (S.talkOff) { card.hidden = true; return; } // debatten er ikke sat op i databasen endnu
    renderTalkList();
  });
  return card;
}

// ---------- Premier League: tabel, næste runde med preview og topscorere ----------
function teamForm(team, n = 5) {
  return S.matches.filter((m) => isDone(m) && (m.home === team || m.away === team))
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)).slice(-n)
    .map((m) => { const my = m.home === team ? m.home_goals : m.away_goals, th = m.home === team ? m.away_goals : m.home_goals; return my > th ? "V" : my < th ? "T" : "U"; });
}
const formEl = (f) => h("span", { class: "form" }, f.length ? f.map((r) => h("span", { class: "fr f-" + r, title: { V: "Sejr", U: "Uafgjort", T: "Nederlag" }[r], text: r })) : h("span", { class: "muted-dark", text: "Ingen kampe endnu" }));
const tcrest = (url, name, size = 22) => url ? h("img", { src: url, alt: "", width: String(size), height: String(size), loading: "lazy", class: "tcrest" }) : h("span", { class: "tcrest blank", text: name.slice(0, 1) });
function nextRound() {
  const now = Date.now();
  const up = S.matches.filter((m) => !OFF.includes(m.status) && !isDone(m) && new Date(m.kickoff).getTime() > now).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return up.length ? up[0].round : null;
}

async function renderPL(main) {
  // Tabel
  const t = S.plTable;
  const tableCard = h("div", { class: "card table-card pl-card" }, h("div", { class: "league-head" }, h("h2", { text: "Premier League" }), h("span", { class: "sub", text: "Stillingen" })));
  if (!t || !t.length) {
    tableCard.append(h("p", { class: "muted-dark", text: t === null
      ? "Tabellen mangler i databasen. Administratoren skal køre premier-league.sql i Supabase."
      : "Tabellen hentes automatisk hver time. Administratoren kan hente den nu under Mere." }));
  } else {
    const n = t.length;
    const body = h("tbody", {}, t.map((r) => h("tr", { class: r.position > n - 3 ? "z-releg-pl" : "" },
      h("td", { class: "pos", text: r.position }),
      h("td", { class: "club l" }, h("span", { class: "tcell" }, tcrest(r.crest, r.team), h("span", { text: r.team }))),
      h("td", { text: r.played }), h("td", { text: r.won }), h("td", { text: r.draw }), h("td", { text: r.lost }),
      h("td", { text: (r.goal_diff > 0 ? "+" : "") + r.goal_diff }),
      h("td", { class: "total", text: r.points }))));
    tableCard.append(h("div", { class: "tablewrap" }, h("table", { class: "pl" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", { class: "l" }, "Hold"), h("th", { title: "Kampe" }, "K"), h("th", { title: "Vundne" }, "V"), h("th", { title: "Uafgjorte" }, "U"), h("th", { title: "Tabte" }, "T"), h("th", { title: "Målforskel" }, "+/-"), h("th", {}, "P"))),
      body)));
    tableCard.append(h("div", { class: "legend" }, h("span", { class: "key releg" }, "Nedrykning")));
  }
  main.append(tableCard);

  // Næste runde med preview
  const r = nextRound();
  const rc = h("div", { class: "card preview-card" });
  main.append(rc);
  if (r == null) { rc.append(h("h2", { text: "Næste runde" }), h("p", { class: "muted-dark", text: "Sæsonen er færdigspillet." })); }
  else {
    const ms = S.matches.filter((m) => m.round === r && !OFF.includes(m.status) && new Date(m.kickoff).getTime() > Date.now()).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
    rc.append(h("div", { class: "league-head" }, h("h2", { text: `Næste runde` }), h("span", { class: "sub", text: `Runde ${r}` })));
    const pos = new Map((S.plTable || []).map((x) => [x.team, x]));
    let lastDay = "";
    for (const m of ms) {
      const d = fmtDay(m.kickoff);
      if (d !== lastDay) { rc.append(h("p", { class: "pday", text: d })); lastDay = d; }
      const tipped = S.myTips.has(m.id);
      const panel = h("div", { class: "pv", hidden: true });
      const btn = h("button", { class: "pvbtn", "aria-expanded": "false", onclick: () => {
        const open = panel.hidden; panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); btn.classList.toggle("on", open);
      } }, "Preview");
      const row = h("div", { class: "pmatch" },
        h("div", { class: "prow" },
          h("span", { class: "ptime", text: fmtTime(m.kickoff) }),
          h("span", { class: "pteams" }, h("span", { class: "pt" }, tcrest(m.home_crest, m.home, 20), h("b", { text: m.home })), h("span", { class: "pt" }, tcrest(m.away_crest, m.away, 20), h("b", { text: m.away }))),
          h("span", { class: "ptip " + (tipped ? "ok" : "miss"), text: tipped ? "Tippet" : "Mangler tip" })),
        h("div", { class: "prow2" }, btn),
        panel);
      // preview-indhold
      const side = (team) => {
        const p = pos.get(team);
        return h("div", { class: "pvside" },
          h("p", { class: "pvteam", text: team }),
          h("p", { class: "pvpos", text: p ? `${p.position}. plads, ${p.points} point` : "Placering ukendt" }),
          h("p", { class: "pvform", text: "Seneste 5 kampe" }),
          formEl(teamForm(team)));
      };
      panel.append(h("div", { class: "pvgrid" }, side(m.home), side(m.away)));
      rc.append(row);
    }
  }

  // Topscorere, hvis de er tilgængelige
  if (S.plScorers && S.plScorers.length) {
    main.append(h("div", { class: "card table-card minor" }, h("h2", { text: "Topscorere" }),
      h("div", { class: "tablewrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", { class: "l" }, "Spiller"), h("th", { class: "l" }, "Hold"), h("th", {}, "Mål"))),
        h("tbody", {}, S.plScorers.map((x) => h("tr", {},
          h("td", { class: "pos", text: x.rank }), h("td", { class: "name l", text: x.player }), h("td", { class: "l", text: x.team || "" }), h("td", { class: "total", text: x.goals }))))))));
  }
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

  const today = new Date().toISOString().slice(0, 10);
  main.append(h("div", { class: "card quote-card" }, h("h3", { text: "Dagens citat" }), quoteEl(quote("generelt", today), "q-paper", "dagens:" + today)));

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
      h("button", { class: "btn ghost", onclick: () => S.sb.auth.signOut() }, "Log ud")),
    "notify_comments" in S.me ? h("label", { class: "check", for: "notifyc" },
      h("input", { type: "checkbox", id: "notifyc", checked: S.me.notify_comments !== false, onchange: async (e) => {
        const { error } = await S.sb.from("players").update({ notify_comments: e.target.checked }).eq("user_id", uid());
        toast(error ? "Indstillingen blev ikke gemt" : e.target.checked ? "Du får besked om nye kommentarer" : "Ingen besked om kommentarer");
        if (!error) S.me.notify_comments = e.target.checked;
      } }),
      h("span", { text: "Påmindelse, når nogen kommenterer en kamp, jeg har tippet" })) : null));

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
        toast(r.ok ? `${j.count} kampe hentet${j.extra ? `, tabel med ${j.extra.standings} hold` : ""}${j.extraError ? ". Premier League-data: " + j.extraError : ""}${j.fallback && j.fallback.filled ? `. ${j.fallback.filled} resultater fra reservekilden` : ""}${j.fallbackError ? ". Reservekilde: " + j.fallbackError : ""}` : j.error || "Kampene kunne ikke hentes");
        if (r.ok) { S.round = null; await loadAll(); S.round = defaultRound(); await loadRoundTips(); }
      } }, "Hent kampe nu")),
    h("label", { for: "admtoggle", class: "check" }, toggle, h("span", { text: "Vis felter til manuelle resultater under Kampe" })),
    usersSection());
}

// Brugere og logins: administratoren kan se e-mails og give en ny adgangskode
function usersSection() {
  const box = h("div", { class: "users" }, h("h3", { text: "Brugere og logins" }), h("p", { class: "muted", text: "Henter brugere..." }));
  const fmt = (d) => d ? new Date(d).toLocaleDateString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldrig";
  S.sb.rpc("admin_list_users").then(({ data, error }) => {
    box.querySelectorAll("p, ul").forEach((n) => n.remove());
    if (error) {
      box.append(h("p", { class: "muted", text: /admin_list_users/.test(error.message || "") || error.code === "PGRST202"
        ? "Funktionen mangler i databasen. Kør filen admin-funktioner.sql i Supabase SQL Editor."
        : "Brugerne kunne ikke hentes: " + error.message }));
      return;
    }
    box.append(h("p", { class: "muted", text: "Hjælp en spiller, der ikke kan logge ind: tjek e-mailen, og giv en ny adgangskode, som du sender til spilleren." }));
    box.append(h("ul", { class: "userlist" }, (data || []).map((u) => h("li", {},
      h("div", { class: "u-main" },
        h("b", { text: u.nick || "Ikke tilmeldt endnu" }), u.is_admin ? h("span", { class: "tag", text: "Administrator" }) : null,
        h("span", { class: "u-mail", text: u.email }),
        h("span", { class: "u-meta", text: `Oprettet ${fmt(u.created_at)}. Seneste login ${fmt(u.last_sign_in_at)}.` })),
      h("button", { class: "btn ghost small", onclick: async () => {
        const pw = prompt(`Ny adgangskode til ${u.email} (mindst 6 tegn):`);
        if (pw == null) return;
        const { error: e2 } = await S.sb.rpc("admin_set_password", { p_user: u.user_id, p_password: pw.trim() });
        toast(e2 ? (e2.message || "Adgangskoden blev ikke ændret").replace(/^.*?:\s*/, "") : `Ny adgangskode gemt. Send den til ${u.nick || u.email}.`);
      } }, "Ny adgangskode")))));
  });
  return box;
}

init();
