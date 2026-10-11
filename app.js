(function () {
'use strict';
var CFG = window.APP_CONFIG || {};
var configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) && !/INSERISCI/.test(String(CFG.SUPABASE_URL) + String(CFG.SUPABASE_ANON_KEY));
var sb = null;
var DEFAULTS = ['Squat', 'Panca piana', 'Stacco da terra', 'Military press', 'Trazioni alla sbarra', 'Rematore con bilanciere', 'Pressa orizzontale', 'Affondi', 'Lat machine', 'Curl con manubri', 'French press', 'Plank', 'Hip thrust', 'Croci ai cavi', 'Alzate laterali', 'Leg curl', 'Leg extension', 'Pushdown ai cavi', 'Crunch', 'Calf in piedi', 'Distensioni con manubri su panca inclinata'];

var $ = function (s, r) { return (r || document).querySelector(s); };
var app = $('#app');
var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var uid = function (p) { return p + Math.random().toString(36).slice(2, 9); };
var pad = function (n) { return String(n).padStart(2, '0'); };
var today = function () { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var fmtDate = function (iso) { var p = String(iso || '').split('-').map(Number); if (p.length < 3 || !p[0]) return ''; return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }); };
var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : ''; };
var fmtN = function (n) { return String(n).replace('.', ','); };
var plateVar = function (kg) { var n = num(kg); if (n === '') return ''; return n >= 25 ? '--p25' : n >= 20 ? '--p20' : n >= 15 ? '--p15' : n >= 10 ? '--p10' : '--p5'; };
var byName = function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'it'); };

var S = {
  phase: 'loading', mode: 'auth', authTab: 'login', role: null, user: null, view: 'oggi', tab: 'scheda', cid: null,
  clients: [], clientsLoaded: false, recent: [], templates: [], tplSel: '', tplDoc: null, libNames: [], libLoaded: false,
  plan: null, planLoaded: false, planDirty: false, planRev: 0, logs: [], logsLoaded: false, clientDoc: null,
  dayId: null, dayPicked: false, autoDone: false, draft: null, draftKey: '', confirm: null, stale: false, loadTok: 0
};
var timers = {}, queues = {};

/* ---------- utilita' ---------- */
function debounce(key, fn, ms) { if (timers[key]) clearTimeout(timers[key].t); timers[key] = { fn: fn, t: setTimeout(function () { var f = timers[key].fn; delete timers[key]; f(); }, ms) }; }
function flush() { Object.keys(timers).forEach(function (k) { var e = timers[k]; clearTimeout(e.t); delete timers[k]; e.fn(); }); }
function enqueue(key, fn) { var p = (queues[key] || Promise.resolve()).then(fn); queues[key] = p.catch(function () {}); return p; }
function setStatus(t, kind) { var el = $('#status'); if (el) { el.textContent = t; el.dataset.kind = kind || ''; } }
function toast(msg, kind) { var el = $('#toast'); if (!el) return; el.textContent = msg; el.dataset.kind = kind || ''; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, kind === 'err' ? 6000 : 2500); }
function errText(e) { return (e && (e.message || e.code)) || 'errore sconosciuto'; }
function onErr(e) { console.error(e); setStatus('Errore: ' + errText(e), 'err'); toast('Errore: ' + errText(e), 'err'); }
async function q(p) { var r = await p; if (r.error) throw r.error; return r.data; }
function typing() { var a = document.activeElement; return !!(a && app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)); }
function softRender() { if (typing()) { S.stale = true; return; } render(); }
function normPlan(days) { var p = clone(days || []); p.forEach(function (d) { d.exercises = d.exercises || []; }); return p; }
function newIds(d) { d.id = uid('d'); (d.exercises || []).forEach(function (e) { e.id = uid('e'); }); }
function mapClient(r) { return { id: r.id, name: r.name, code: r.invite_code, linked: !!r.user_id }; }
function mapLog(r) { return { id: r.id, clientId: r.client_id, dayId: r.day_id, dayName: r.day_name, date: r.date, sets: r.sets || {}, names: r.names || {}, bodyWeight: r.body_weight, note: r.note, ts: Date.parse(r.updated_at) || 0 }; }
function sortLogs(arr) { return arr.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || ((b.ts || 0) - (a.ts || 0)); }); }

/* ---------- accesso ---------- */
async function afterLogin(user) {
  S.user = user;
  var tr = await q(sb.from('trainers').select('user_id').eq('user_id', user.id).maybeSingle());
  if (tr) { S.role = 'trainer'; S.mode = 'home'; await loadHome(); return; }
  var cl = await q(sb.from('clients').select('id,name').eq('user_id', user.id).maybeSingle());
  S.role = 'client';
  if (cl) { S.mode = 'client'; S.view = 'oggi'; resetSession(cl.id); await loadSession(cl.id, true); return; }
  S.mode = 'claim';
}
function authErr(e) {
  var m = errText(e);
  if (/Invalid login credentials/i.test(m)) return 'Nome utente o password non corretti.';
  if (/already registered/i.test(m)) return 'Questo nome utente è già preso. Scegline un altro oppure usa "Accedi".';
  if (/Password should be/i.test(m)) return 'La password deve avere almeno 6 caratteri.';
  if (/rate limit/i.test(m)) return 'Troppi tentativi. Riprova tra qualche minuto.';
  return m;
}
// Se scrivono un nome utente (senza @) lo trasformo in un indirizzo interno: nessuna email vera richiesta.
function toEmail(v) {
  v = v.trim().toLowerCase();
  if (v.indexOf('@') > -1) return v;
  return v.replace(/[^a-z0-9._-]/g, '') + '@example.com';
}
async function doAuth() {
  var email = toEmail($('#email').value), pw = $('#password').value, msg = $('#authmsg');
  msg.style.color = 'var(--muted)'; msg.textContent = 'Un attimo…';
  try {
    if (S.authTab === 'signup') {
      var r = await sb.auth.signUp({ email: email, password: pw });
      if (r.error) throw r.error;
      if (!r.data.session) { msg.textContent = 'Account creato. Controlla la tua email per confermarlo, poi accedi.'; return; }
      await afterLogin(r.data.session.user);
    } else {
      var r2 = await sb.auth.signInWithPassword({ email: email, password: pw });
      if (r2.error) throw r2.error;
      await afterLogin(r2.data.user);
    }
    render();
  } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = authErr(e); }
}
async function doClaim() {
  var code = $('#code').value.trim(), msg = $('#claimmsg');
  if (!code) return;
  msg.style.color = 'var(--muted)'; msg.textContent = 'Controllo…';
  try {
    var id = await q(sb.rpc('claim_client', { p_code: code }));
    S.role = 'client'; S.mode = 'client'; S.view = 'oggi';
    resetSession(id); await loadSession(id, true); render();
  } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = errText(e); }
}
async function doLogout() {
  flush();
  try { await sb.auth.signOut(); } catch (e) {}
  S.loadTok++;
  Object.assign(S, { user: null, role: null, mode: 'auth', authTab: 'login', cid: null, clients: [], clientsLoaded: false, recent: [], templates: [], tplDoc: null, libNames: [], libLoaded: false, plan: null, planLoaded: false, logs: [], logsLoaded: false, clientDoc: null, draft: null, draftKey: '', confirm: null });
  render();
}

/* ---------- caricamento dati ---------- */
async function loadHome(quiet) {
  try {
    var res = await Promise.all([
      q(sb.from('clients').select('id,name,invite_code,user_id').order('name')),
      q(sb.from('logs').select('id,client_id,day_name,date,sets,updated_at').order('updated_at', { ascending: false }).limit(150)),
      q(sb.from('templates').select('id,name').order('name')),
      q(sb.from('library').select('name'))
    ]);
    S.clients = res[0].map(mapClient).sort(byName);
    S.recent = res[1].map(mapLog);
    S.templates = res[2].map(function (t) { return { id: t.id, name: t.name }; }).sort(byName);
    S.libNames = res[3].map(function (r) { return r.name; });
    S.libLoaded = true; S.clientsLoaded = true;
    if (S.mode === 'home' || S.mode === 'edit') softRender();
  } catch (e) { onErr(e); }
}
function resetSession(cid) {
  Object.assign(S, { cid: cid, plan: null, planLoaded: false, planDirty: false, planRev: 0, logs: [], logsLoaded: false, draft: null, draftKey: '', clientDoc: null, tplDoc: null, dayId: null, dayPicked: false, autoDone: (S.mode === 'edit' || S.mode === 'tedit'), confirm: null, stale: false });
}
async function loadSession(cid, quiet) {
  if (!quiet) { resetSession(cid); render(); }
  var tok = ++S.loadTok;
  try {
    var r = await Promise.all([
      q(sb.from('clients').select('id,name,invite_code,user_id').eq('id', cid).maybeSingle()),
      q(sb.from('plans').select('days').eq('client_id', cid).maybeSingle()),
      q(sb.from('logs').select('*').eq('client_id', cid).order('date', { ascending: false }).limit(200))
    ]);
    if (tok !== S.loadTok || S.cid !== cid) return;
    if (!r[0]) {
      if (S.mode === 'client') { toast('La tua scheda non è più disponibile.', 'err'); await doLogout(); }
      return;
    }
    S.clientDoc = mapClient(r[0]);
    if (!S.planDirty) { S.plan = normPlan(r[1] && r[1].days); }
    S.planLoaded = true;
    if (!S.dayId || !S.plan.some(function (d) { return d.id === S.dayId; })) S.dayId = S.plan[0] ? S.plan[0].id : null;
    S.logs = sortLogs(r[2].map(mapLog)); S.logsLoaded = true;
    autoDay();
    if (quiet && S.mode !== 'client' && S.mode !== 'edit') return;
    softRender();
  } catch (e) { onErr(e); }
}
async function loadTemplate(tid) {
  resetSession(tid); render();
  var tok = ++S.loadTok;
  try {
    var t = await q(sb.from('templates').select('id,name,days').eq('id', tid).maybeSingle());
    if (tok !== S.loadTok || S.cid !== tid) return;
    if (!t) { toast('Modello non trovato.', 'err'); goHome(); return; }
    S.tplDoc = { id: t.id, name: t.name };
    S.plan = normPlan(t.days); S.planLoaded = true; S.logsLoaded = true;
    S.dayId = S.plan[0] ? S.plan[0].id : null;
    render();
  } catch (e) { onErr(e); }
}
function autoDay() {
  if (S.autoDone || !S.planLoaded || !S.logsLoaded) return;
  S.autoDone = true;
  if (S.dayPicked || !S.plan.length) return;
  var last = S.logs[0]; if (!last) return;
  var i = S.plan.findIndex(function (d) { return d.id === last.dayId; }); if (i < 0) return;
  S.dayId = last.date === today() ? S.plan[i].id : S.plan[(i + 1) % S.plan.length].id;
}
function goHome() { flush(); S.loadTok++; S.mode = 'home'; S.cid = null; S.confirm = null; render(); loadHome(true); }
function openClient(id, tab) { flush(); S.mode = 'edit'; S.tab = tab || 'scheda'; loadSession(id); }

/* ---------- esercizi suggeriti ---------- */
function suggestions() { var seen = {}, out = []; DEFAULTS.concat(S.libNames).forEach(function (n) { var k = String(n).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(n); } }); return out.sort(function (a, b) { return a.localeCompare(b, 'it'); }); }
function updateDatalist() { var el = $('#exlist'); if (el) el.innerHTML = suggestions().map(function (n) { return '<option value="' + esc(n) + '">'; }).join(''); }
function learnName(name) {
  name = String(name || '').trim(); if (!name || !S.libLoaded) return;
  if (suggestions().some(function (n) { return n.toLowerCase() === name.toLowerCase(); })) return;
  S.libNames = S.libNames.concat([name]); updateDatalist();
  enqueue('lib', function () { return q(sb.from('library').upsert({ name: name }, { onConflict: 'name', ignoreDuplicates: true })); }).catch(onErr);
}

/* ---------- viste ---------- */
function brand() {
  return '<div class="brand"><img class="logo" src="logo.png" alt="DS" width="36" height="36"></div>';
}
function clientName() { var c = S.clients.find(function (x) { return x.id === S.cid; }); return (S.clientDoc && S.clientDoc.name) || (c && c.name) || 'Cliente'; }
function planDay() { return (S.plan || []).find(function (d) { return d.id === S.dayId; }) || null; }

function loadingView() { return '<div class="wrap"><div class="top">' + brand() + '</div><p class="muted">Carico…</p></div>'; }
function setupView() {
  return '<div class="wrap narrow"><div class="top">' + brand() + '</div><div class="stack"><h1>Manca la configurazione</h1><p class="muted">Apri il file <b>config.js</b> e inserisci l\'indirizzo del progetto Supabase e la chiave pubblica (anon). Poi ricarica la pagina.</p><pre class="cfg">SUPABASE_URL: \'https://xxxx.supabase.co\'\nSUPABASE_ANON_KEY: \'eyJ...\'</pre></div></div>';
}
function nolibView() { return '<div class="wrap narrow"><div class="top">' + brand() + '</div><div class="empty"><h2>Collegamento non riuscito</h2><p class="muted">Non riesco a caricare i componenti dell\'app. Controlla la connessione e riprova.</p></div></div>'; }
function authView() {
  var su = S.authTab === 'signup';
  return '<div class="wrap narrow"><div class="top">' + brand() + '</div><div class="stack"><h1>' + (su ? 'Nuovo account' : 'Accedi') + '</h1>' +
    '<div class="seg" role="tablist"><button role="tab" data-act="authtab" data-t="login" aria-selected="' + (!su) + '">Accedi</button><button role="tab" data-act="authtab" data-t="signup" aria-selected="' + su + '">Nuovo account</button></div>' +
    '<form id="authform" class="stack-s"><label class="f" for="email">Nome utente<input id="email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" minlength="3" required></label>' +
    '<label class="f" for="password">Password<input id="password" type="password" autocomplete="' + (su ? 'new-password' : 'current-password') + '" minlength="6" required></label>' +
    '<button class="btn primary" type="submit">' + (su ? 'Crea account' : 'Entra') + '</button><p class="msg" id="authmsg" role="status"></p></form>' +
    (su ? '<p class="muted small">Dopo aver creato l\'account ti chiederò il codice personale che ti ha dato l\'allenatore.</p>' : '') + '</div></div>';
}
function claimView() {
  return '<div class="wrap narrow"><div class="top">' + brand() + '<button class="btn link" data-act="logout">Esci</button></div><div class="stack"><h1>Il tuo codice</h1>' +
    '<p class="muted">Inserisci il codice personale che ti ha dato l\'allenatore. Serve solo la prima volta.</p>' +
    '<form id="claimform" class="stack-s"><label class="f" for="code">Codice<input id="code" autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="Es. K7M2QX"></label><button class="btn primary" type="submit">Collega</button><p class="msg" id="claimmsg" role="status"></p></form></div></div>';
}

function homeView() {
  var cmap = {}; S.clients.forEach(function (c) { cmap[c.id] = c; });
  var rec = S.recent.filter(function (r) { return cmap[r.clientId]; }).slice(0, 6).map(function (r) {
    return '<li><button class="act-row" data-act="open" data-id="' + esc(r.clientId) + '" data-tab="progressi"><span><b>' + esc(cmap[r.clientId].name) + '</b> · ' + esc(r.dayName || '') + '</span><span class="muted small">' + esc(fmtDate(r.date)) + ' · ' + Object.keys(r.sets || {}).length + ' esercizi</span></button></li>';
  }).join('');
  var rows = S.clients.map(function (c) {
    var last = S.recent.find(function (r) { return r.clientId === c.id; });
    return '<li class="crow"><button class="crow-main" data-act="open" data-id="' + esc(c.id) + '"><span class="cname">' + esc(c.name) + '</span><span class="muted small">' + (last ? 'Ultimo allenamento: ' + esc(fmtDate(last.date)) : (c.linked ? 'Nessun allenamento ancora' : 'Non è ancora entrato')) + '</span></button><span class="code" title="Codice di accesso">' + esc(c.code) + '</span></li>';
  }).join('');
  var list = !S.clientsLoaded ? '<p class="muted">Carico i clienti…</p>' : (S.clients.length ? '<ul class="stack-s">' + rows + '</ul>' : '<div class="empty"><h2>Nessun cliente</h2><p class="muted">Scrivi il nome del primo cliente qui sopra. Riceverà un codice personale da usare per entrare nella sua scheda.</p></div>');
  return '<div class="wrap"><div class="top">' + brand() + '<button class="btn link" data-act="logout">Esci</button></div><div class="stack">' +
    '<h1>Clienti</h1>' +
    '<form id="addclient" class="row" style="flex-wrap:nowrap"><input id="newname" placeholder="Nome e cognome" autocomplete="off" aria-label="Nome del nuovo cliente"><button class="btn primary" type="submit" style="flex:none">Aggiungi</button></form>' +
    '<p id="status" role="status"></p>' + list + tplSection() +
    (rec ? '<h2 style="margin-top:10px">Ultimi allenamenti</h2><ul class="stack-s">' + rec + '</ul>' : '') +
    '</div></div>';
}

function editView() {
  var c = S.clientDoc || S.clients.find(function (x) { return x.id === S.cid; }) || {};
  var tabs = '<div class="seg" role="tablist"><button role="tab" data-act="tab" data-t="scheda" aria-selected="' + (S.tab === 'scheda') + '">Scheda</button><button role="tab" data-act="tab" data-t="progressi" aria-selected="' + (S.tab === 'progressi') + '">Progressi</button></div>';
  var delBtn = S.confirm === 'client' ? '<button class="btn sm danger" data-act="delclient">Conferma eliminazione</button><button class="btn sm" data-act="cancel">Annulla</button>' : '<button class="btn sm" data-act="askdelclient">Elimina cliente</button>';
  return '<div class="wrap"><div class="top"><button class="btn link" data-act="back">← Clienti</button>' + brand() + '</div><div class="stack">' +
    '<div class="stack-s"><h1>' + esc(c.name || 'Cliente') + '</h1><div class="codebox"><span class="muted small">Codice di accesso</span><b>' + esc(c.code || '') + '</b><button class="btn sm" data-act="copy" data-code="' + esc(c.code || '') + '">Copia</button><span class="tag' + (c.linked ? ' on' : '') + '">' + (c.linked ? 'Collegato' : 'Non ancora entrato') + '</span></div>' +
    '<div class="row"><button class="btn sm primary" data-act="preview">Anteprima cliente</button>' + delBtn + '</div></div>' +
    tabs + '<p id="status" role="status"></p>' +
    (S.tab === 'scheda' ? tplTools() + planEditor() : historyView()) + '</div></div>';
}

function planEditor() {
  if (!S.planLoaded) return '<p class="muted">Carico la scheda…</p>';
  var chips = S.plan.map(function (d, i) { return '<button class="chip" data-act="day" data-id="' + esc(d.id) + '" data-chip="' + i + '" aria-pressed="' + (d.id === S.dayId) + '">' + esc(d.name || ('Giorno ' + (i + 1))) + '</button>'; }).join('') + '<button class="chip add" data-act="addday">+ Giorno</button>';
  var day = planDay(), body = '';
  if (!day) { body = '<div class="empty"><h2>Nessun giorno</h2><p class="muted">Aggiungi il primo giorno di allenamento per cominciare a inserire gli esercizi.</p></div>'; }
  else {
    var ex = day.exercises.map(function (e, i) { return exEditor(e, i, day.exercises.length); }).join('');
    var delDay = S.confirm === 'day' ? '<button class="btn sm danger" data-act="delday">Conferma eliminazione</button><button class="btn sm" data-act="cancel">Annulla</button>' : '<button class="btn sm" data-act="askdelday">Elimina giorno</button>';
    body = '<label class="f" for="dayname">Nome del giorno<input id="dayname" data-f="dayname" value="' + esc(day.name) + '"></label>' +
      (day.exercises.length ? '<ul class="stack">' + ex + '</ul>' : '<div class="empty"><p class="muted">Questo giorno non ha ancora esercizi.</p></div>') +
      '<div class="row"><button class="btn primary" data-act="addex">+ Esercizio</button>' + delDay + '</div>';
  }
  return '<div class="stack"><div class="chips" role="group" aria-label="Giorni di allenamento">' + chips + '</div>' + body + '</div>';
}
function exEditor(e, i, n) {
  return '<li class="card exe" data-ei="' + i + '"><div class="exe-head"><span class="idx">' + (i + 1) + '</span><input data-f="name" list="exlist" placeholder="Nome esercizio" aria-label="Nome esercizio" value="' + esc(e.name) + '"></div>' +
    '<div class="grid4"><label class="f">Serie<input data-f="sets" inputmode="numeric" value="' + esc(e.sets) + '"></label>' +
    '<label class="f">Ripetizioni<input data-f="reps" placeholder="8-10" value="' + esc(e.reps) + '"></label>' +
    '<label class="f">Carico (kg)<input data-f="kg" inputmode="decimal" value="' + esc(e.kg) + '"></label>' +
    '<label class="f">Recupero (s)<input data-f="rest" inputmode="numeric" value="' + esc(e.rest) + '"></label></div>' +
    '<label class="f">Note per il cliente<input data-f="note" placeholder="Es. discesa lenta, fermo al petto" value="' + esc(e.note) + '"></label>' +
    '<div class="exe-actions"><button class="btn sm" data-act="up"' + (i === 0 ? ' disabled' : '') + '>↑ Su</button><button class="btn sm" data-act="down"' + (i === n - 1 ? ' disabled' : '') + '>↓ Giù</button><button class="btn sm danger" data-act="delex">Elimina</button></div></li>';
}

function tplSection() {
  var rows = S.templates.map(function (t) { return '<li class="crow"><button class="crow-main" data-act="opentpl" data-id="' + esc(t.id) + '"><span class="cname">' + esc(t.name || 'Modello') + '</span><span class="muted small">Modifica la scheda modello</span></button></li>'; }).join('');
  return '<h2 style="margin-top:10px">Schede modello</h2><p class="muted small">Prepara la scheda una volta sola, poi applicala ai clienti che la seguono.</p>' +
    '<form id="addtpl" class="row" style="flex-wrap:nowrap"><input id="newtpl" placeholder="Nome, es. Ipertrofia 12 settimane" autocomplete="off" aria-label="Nome del nuovo modello"><button class="btn" type="submit" style="flex:none">Crea</button></form>' + (rows ? '<ul class="stack-s">' + rows + '</ul>' : '');
}
function tplTools() {
  if (!S.planLoaded) return '';
  var sel = S.tplSel && S.templates.some(function (t) { return t.id === S.tplSel; }) ? S.tplSel : (S.templates[0] ? S.templates[0].id : '');
  var opts = S.templates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name || 'Modello') + '</option>'; }).join('');
  var apply;
  if (!S.templates.length) apply = '<p class="muted small">Non hai ancora modelli. Creane uno dalla home, oppure salva qui sotto la scheda di questo cliente come modello.</p>';
  else if (S.confirm === 'apply') apply = '<p class="small">La scheda attuale di questo cliente verrà sostituita dal modello scelto.</p><div class="row"><button class="btn sm primary" data-act="doapply">Conferma</button><button class="btn sm" data-act="cancel">Annulla</button></div>';
  else apply = '<div class="row" style="flex-wrap:nowrap"><select id="tplsel" data-g="tplsel" aria-label="Modello da applicare">' + opts + '</select><button class="btn" data-act="askapply" style="flex:none">Applica</button></div>';
  return '<div class="card stack-s"><h2>Modelli</h2>' + apply + '<form id="savetpl" class="row" style="flex-wrap:nowrap"><input id="savetplname" placeholder="Salva questa scheda come modello" autocomplete="off" aria-label="Nome del modello"><button class="btn" type="submit" style="flex:none">Salva</button></form></div>';
}
function tplView() {
  var t = S.tplDoc || S.templates.find(function (x) { return x.id === S.cid; }) || {};
  var del = S.confirm === 'tpl' ? '<button class="btn sm danger" data-act="deltpl">Conferma eliminazione</button><button class="btn sm" data-act="cancel">Annulla</button>' : '<button class="btn sm" data-act="asktpldel">Elimina modello</button>';
  return '<div class="wrap"><div class="top"><button class="btn link" data-act="back">← Indietro</button>' + brand() + '</div><div class="stack"><h1>Scheda modello</h1>' +
    '<label class="f" for="tplname">Nome del modello<input id="tplname" data-f="tplname" value="' + esc(t.name || '') + '"></label><div class="row">' + del + '</div>' +
    '<p class="muted small">Le modifiche non cambiano le schede già assegnate ai clienti.</p><p id="status" role="status"></p>' + planEditor() + '</div></div>';
}

function fmtSets(arr) { return (arr || []).filter(function (s) { return s.kg !== '' || s.reps !== ''; }).map(function (s) { return (s.kg === '' || s.kg == null ? '–' : fmtN(s.kg)) + '×' + (s.reps === '' || s.reps == null ? '–' : s.reps); }).join(' · '); }
function lastLog(dayId) { return S.logs.find(function (l) { return l.dayId === dayId && l.date < today(); }); }
function defaultSets(ex, last) {
  var n = Math.max(1, parseInt(ex.sets, 10) || 1), prev = last && last.sets && last.sets[ex.id], out = [];
  for (var i = 0; i < n; i++) {
    var p = prev && prev.length ? prev[Math.min(i, prev.length - 1)] : null;
    out.push(p ? { kg: p.kg, reps: p.reps, done: false } : { kg: ex.kg !== '' && ex.kg != null ? num(ex.kg) : '', reps: parseInt(ex.reps, 10) || '', done: false });
  }
  return out;
}
function ensureDraft(day) {
  var key = S.cid + '|' + day.id + '|' + today();
  if (S.draft && S.draftKey === key) return;
  var ex = S.logs.find(function (l) { return l.dayId === day.id && l.date === today(); }), last = lastLog(day.id), sets = {};
  day.exercises.forEach(function (e) { var got = ex && ex.sets && ex.sets[e.id]; sets[e.id] = got ? clone(got) : defaultSets(e, last); });
  S.draft = { sets: sets, bodyWeight: ex && ex.bodyWeight != null ? String(ex.bodyWeight) : '', note: ex && ex.note ? ex.note : '' };
  S.draftKey = key;
}

function clientView() {
  var prev = S.mode === 'preview';
  var head = prev ? '<div class="banner"><span><b>Anteprima di ' + esc(clientName()) + '.</b> Nulla viene salvato.</span><button class="btn sm" data-act="endpreview">Torna alla scheda</button></div>'
    : '<div class="top">' + brand() + '<button class="btn link" data-act="logout">Esci</button></div>';
  var seg = '<div class="seg" role="tablist"><button role="tab" data-act="view" data-v="oggi" aria-selected="' + (S.view === 'oggi') + '">Allenamento</button><button role="tab" data-act="view" data-v="storico" aria-selected="' + (S.view === 'storico') + '">Storico</button></div>';
  return '<div class="wrap">' + head + '<div class="stack"><div class="stack-s"><h1>Ciao ' + esc(String(clientName()).split(' ')[0]) + '</h1><p class="muted">' + esc(fmtDate(today())) + '</p></div>' + seg + '<p id="status" role="status"></p>' + (S.view === 'oggi' ? workoutView() : historyView()) + '</div></div>';
}
function workoutView() {
  if (!S.planLoaded || !S.logsLoaded) return '<p class="muted">Carico la scheda…</p>';
  if (!S.plan.length || !S.plan.some(function (d) { return d.exercises.length; })) return '<div class="empty"><h2>Scheda in preparazione</h2><p class="muted">Il tuo allenatore non ha ancora inserito gli esercizi. Riprova più tardi.</p></div>';
  var day = planDay();
  var chips = S.plan.map(function (d, i) { return '<button class="chip" data-act="cday" data-id="' + esc(d.id) + '" aria-pressed="' + (d.id === S.dayId) + '">' + esc(d.name || ('Giorno ' + (i + 1))) + '</button>'; }).join('');
  if (!day) return '';
  if (!day.exercises.length) return '<div class="chips">' + chips + '</div><div class="empty"><p class="muted">Questo giorno è ancora vuoto.</p></div>';
  ensureDraft(day);
  var D = S.draft, last = lastLog(day.id);
  var cards = day.exercises.map(function (e) {
    if (!D.sets[e.id]) D.sets[e.id] = defaultSets(e, last);
    var sets = D.sets[e.id], pv = plateVar(e.kg);
    var tgt = [esc(e.sets || '?') + ' × ' + esc(e.reps || '?')];
    if (e.kg !== '' && e.kg != null) tgt.push((pv ? '<span class="dot" style="color:var(' + pv + ');background:var(' + pv + ')"></span> ' : '') + esc(e.kg) + ' kg');
    if (e.rest) tgt.push('rec ' + esc(e.rest) + '″');
    var lp = last && last.sets && last.sets[e.id];
    var hint = lp && fmtSets(lp) ? '<p class="hint">Ultima volta (' + esc(fmtDate(last.date)) + '): ' + esc(fmtSets(lp)) + '</p>' : '';
    var rows = sets.map(function (s, i) {
      return '<div class="srow' + (s.done ? ' is-done' : '') + '" data-ex="' + esc(e.id) + '" data-i="' + i + '"><span class="sn">' + (i + 1) + '</span><input data-k="kg" inputmode="decimal" aria-label="Kg serie ' + (i + 1) + '" value="' + esc(s.kg) + '"><span class="x">×</span><input data-k="reps" inputmode="numeric" aria-label="Ripetizioni serie ' + (i + 1) + '" value="' + esc(s.reps) + '"><button class="done" data-act="done" aria-pressed="' + (!!s.done) + '" aria-label="Serie ' + (i + 1) + ' completata"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></div>';
    }).join('');
    return '<li class="card ex" data-exid="' + esc(e.id) + '"><h3>' + esc(e.name || 'Esercizio') + '</h3><div class="target">' + tgt.join(' <span class="muted">·</span> ') + '</div>' + (e.note ? '<p class="note-ex">' + esc(e.note) + '</p>' : '') + hint +
      '<div class="stack-s"><div class="shead"><span></span><span>Kg</span><span></span><span>Rip.</span><span></span></div>' + rows + '</div><div><button class="btn sm" data-act="addset">+ Serie</button></div></li>';
  }).join('');
  return '<div class="chips" role="group" aria-label="Giorni di allenamento">' + chips + '</div><ul class="stack">' + cards + '</ul>' +
    '<div class="card stack-s"><label class="f" for="bw">Peso corporeo (kg)<input id="bw" data-g="bw" inputmode="decimal" value="' + esc(D.bodyWeight) + '"></label>' +
    '<label class="f" for="note">Note sull\'allenamento<textarea id="note" data-g="note" placeholder="Come ti sei sentito, dolori, sensazioni">' + esc(D.note) + '</textarea></label></div>';
}

function spark(pts) {
  var W = 320, H = 84, P = 8, vals = pts.map(function (p) { return p.v; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || 1;
  var x = function (i) { return P + (W - 2 * P) * (pts.length === 1 ? 0 : i / (pts.length - 1)); }, y = function (v) { return H - P - (H - 2 * P) * ((v - mn) / span); };
  var line = pts.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ');
  var lx = x(pts.length - 1), ly = y(pts[pts.length - 1].v);
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Andamento del peso corporeo"><line class="gl" x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '"/><polyline class="ln" points="' + line + '"/><circle class="pt" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4"/></svg>';
}
function historyView() {
  if (!S.logsLoaded) return '<p class="muted">Carico lo storico…</p>';
  if (!S.logs.length) return '<div class="empty"><h2>Ancora niente</h2><p class="muted">Gli allenamenti salvati compariranno qui, con carichi e ripetizioni di ogni seduta.</p></div>';
  var byDate = {}; S.logs.forEach(function (l) { if (l.bodyWeight != null && l.bodyWeight !== '' && (!byDate[l.date] || (l.ts || 0) > (byDate[l.date].ts || 0))) byDate[l.date] = l; });
  var pts = Object.keys(byDate).sort().map(function (d) { return { d: d, v: Number(byDate[d].bodyWeight) }; }).filter(function (p) { return isFinite(p.v); });
  var bw = pts.length >= 2 ? '<div class="card stack-s"><h2>Peso corporeo</h2>' + spark(pts) + '<p class="muted small">Da ' + fmtN(pts[0].v) + ' kg (' + esc(fmtDate(pts[0].d)) + ') a ' + fmtN(pts[pts.length - 1].v) + ' kg (' + esc(fmtDate(pts[pts.length - 1].d)) + ')</p></div>' : '';
  var sess = S.logs.slice(0, 30).map(function (l) {
    var ids = Object.keys(l.sets || {}), names = l.names || {};
    var dl = ids.map(function (id) { var t = fmtSets(l.sets[id]); return t ? '<dt>' + esc(names[id] || 'Esercizio') + '</dt><dd>' + esc(t) + '</dd>' : ''; }).join('');
    return '<li class="card sess"><div class="row between"><h3>' + esc(fmtDate(l.date)) + '</h3><span class="muted">' + esc(l.dayName || '') + '</span></div>' + (dl ? '<dl>' + dl + '</dl>' : '') +
      (l.bodyWeight != null && l.bodyWeight !== '' ? '<p class="small muted">Peso: ' + fmtN(l.bodyWeight) + ' kg</p>' : '') + (l.note ? '<p class="small">' + esc(l.note) + '</p>' : '') + '</li>';
  }).join('');
  return '<div class="stack">' + bw + '<ul class="stack">' + sess + '</ul></div>';
}

function render() {
  S.stale = false;
  var y = window.scrollY, h;
  if (S.phase === 'loading') h = loadingView();
  else if (S.phase === 'setup') h = setupView();
  else if (S.phase === 'nolib') h = nolibView();
  else if (S.mode === 'home') h = homeView();
  else if (S.mode === 'edit') h = editView();
  else if (S.mode === 'tedit') h = tplView();
  else if (S.mode === 'client' || S.mode === 'preview') h = clientView();
  else if (S.mode === 'claim') h = claimView();
  else h = authView();
  app.innerHTML = h;
  updateDatalist();
  window.scrollTo(0, y);
}

/* ---------- salvataggi ---------- */
function touchPlan() { S.planRev++; S.planDirty = true; setStatus('Modifiche in sospeso…'); debounce('plan', savePlan, 700); }
function savePlan() {
  var cid = S.cid, rev = S.planRev, data = clone(S.plan || []), isT = S.mode === 'tedit';
  if (!cid || S.mode === 'preview') return;
  setStatus('Salvataggio…');
  enqueue('plan:' + cid, function () {
    return isT ? q(sb.from('templates').update({ days: data }).eq('id', cid))
               : q(sb.from('plans').upsert({ client_id: cid, days: data, updated_at: new Date().toISOString() }));
  }).then(function () { if (S.cid === cid && S.planRev === rev) S.planDirty = false; setStatus('Salvato', 'ok'); }).catch(onErr);
}
function saveDraftSoon() { if (S.mode === 'preview') return; setStatus('Modifiche in sospeso…'); debounce('log', doSaveDraft, 800); }
function mergeLog(p) {
  var item = { id: '', clientId: p.client_id, dayId: p.day_id, dayName: p.day_name, date: p.date, sets: p.sets, names: p.names, bodyWeight: p.body_weight, note: p.note, ts: Date.parse(p.updated_at) || Date.now() };
  var i = S.logs.findIndex(function (l) { return l.dayId === item.dayId && l.date === item.date; });
  if (i >= 0) { item.id = S.logs[i].id; S.logs[i] = item; } else S.logs.unshift(item);
  sortLogs(S.logs);
}
function doSaveDraft() {
  var D = S.draft, day = planDay();
  if (!D || !day || S.mode !== 'client') return;
  var sets = {}, names = {};
  day.exercises.forEach(function (e) { names[e.id] = e.name || 'Esercizio'; sets[e.id] = (D.sets[e.id] || []).map(function (s) { return { kg: num(s.kg), reps: num(s.reps), done: !!s.done }; }); });
  var bw = num(D.bodyWeight);
  var payload = { client_id: S.cid, day_id: day.id, day_name: day.name || '', date: today(), sets: sets, names: names, body_weight: bw === '' ? null : bw, note: D.note || '', updated_at: new Date().toISOString() };
  setStatus('Salvataggio…');
  enqueue('log:' + S.cid + day.id, function () { return q(sb.from('logs').upsert(payload, { onConflict: 'client_id,day_id,date' })); })
    .then(function () { mergeLog(payload); setStatus('Salvato', 'ok'); }).catch(onErr);
}

/* ---------- azioni ---------- */
function makeCode() { var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = ''; for (var i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; return c; }
async function addClient(name) {
  name = name.trim(); if (!name) return;
  setStatus('Creo il cliente…');
  try {
    var row = null, tries = 0;
    while (!row) {
      var r = await sb.from('clients').insert({ name: name, invite_code: makeCode() }).select('id').single();
      if (!r.error) { row = r.data; break; }
      if (r.error.code === '23505' && ++tries < 5) continue;
      throw r.error;
    }
    await q(sb.from('plans').insert({ client_id: row.id, days: [{ id: uid('d'), name: 'Giorno A', exercises: [] }] }));
    await loadHome(true);
    openClient(row.id);
  } catch (e) { onErr(e); }
}
async function deleteClient(id) {
  flush(); S.confirm = null; S.mode = 'home'; S.cid = null; S.loadTok++; render();
  try { await q(sb.from('clients').delete().eq('id', id)); } catch (e) { onErr(e); }
  loadHome(true);
}
async function addTemplate(name) {
  name = name.trim(); if (!name) return;
  setStatus('Creo il modello…');
  try {
    var t = await q(sb.from('templates').insert({ name: name, days: [{ id: uid('d'), name: 'Giorno A', exercises: [] }] }).select('id').single());
    flush(); S.mode = 'tedit'; S.confirm = null; loadTemplate(t.id);
  } catch (e) { onErr(e); }
}
async function deleteTemplate(id) {
  flush(); S.confirm = null; S.mode = 'home'; S.cid = null; S.loadTok++; render();
  try { await q(sb.from('templates').delete().eq('id', id)); } catch (e) { onErr(e); }
  loadHome(true);
}
async function applyTemplate() {
  var pick = S.tplSel && S.templates.some(function (t) { return t.id === S.tplSel; }) ? S.tplSel : (S.templates[0] ? S.templates[0].id : '');
  S.confirm = null; if (!pick) { render(); return; }
  setStatus('Applico il modello…');
  try {
    var t = await q(sb.from('templates').select('days').eq('id', pick).maybeSingle());
    var days = normPlan(t && t.days);
    if (!days.length) throw { message: 'il modello è vuoto' };
    days.forEach(newIds);
    S.plan = days; S.dayId = days[0].id; touchPlan(); render();
  } catch (e) { onErr(e); }
}
async function saveAsTemplate(name) {
  if (!name || !S.plan) return;
  var days = clone(S.plan); days.forEach(newIds);
  setStatus('Salvo il modello…');
  try {
    await q(sb.from('templates').insert({ name: name, days: days }));
    var inp = $('#savetplname'); if (inp) inp.value = '';
    setStatus('Modello "' + name + '" salvato', 'ok');
    loadHome(true);
  } catch (e) { onErr(e); }
}

app.addEventListener('click', function (ev) {
  var el = ev.target.closest('[data-act]'); if (!el) return;
  var a = el.dataset.act, day = planDay();
  switch (a) {
    case 'authtab': S.authTab = el.dataset.t; render(); break;
    case 'logout': doLogout(); break;
    case 'open': openClient(el.dataset.id, el.dataset.tab); break;
    case 'back': goHome(); break;
    case 'tab': S.tab = el.dataset.t; render(); break;
    case 'view': S.view = el.dataset.v; render(); break;
    case 'day': S.dayId = el.dataset.id; S.confirm = null; render(); break;
    case 'cday': flush(); S.dayId = el.dataset.id; S.dayPicked = true; S.draft = null; render(); break;
    case 'addday': S.plan.push({ id: uid('d'), name: 'Giorno ' + String.fromCharCode(65 + Math.min(S.plan.length, 25)), exercises: [] }); S.dayId = S.plan[S.plan.length - 1].id; touchPlan(); render(); break;
    case 'askdelday': S.confirm = 'day'; render(); break;
    case 'askdelclient': S.confirm = 'client'; render(); break;
    case 'asktpldel': S.confirm = 'tpl'; render(); break;
    case 'askapply': S.confirm = 'apply'; render(); break;
    case 'cancel': S.confirm = null; render(); break;
    case 'delday': S.plan = S.plan.filter(function (d) { return d.id !== S.dayId; }); S.dayId = S.plan[0] ? S.plan[0].id : null; S.confirm = null; touchPlan(); render(); break;
    case 'delclient': deleteClient(S.cid); break;
    case 'deltpl': deleteTemplate(S.cid); break;
    case 'opentpl': flush(); S.mode = 'tedit'; S.confirm = null; loadTemplate(el.dataset.id); break;
    case 'doapply': applyTemplate(); break;
    case 'addex':
      if (!day) break; day.exercises.push({ id: uid('e'), name: '', sets: '3', reps: '10', kg: '', rest: '90', note: '' }); touchPlan(); render();
      var ins = app.querySelectorAll('[data-f="name"]'); if (ins.length) ins[ins.length - 1].focus(); break;
    case 'up': case 'down':
      if (!day) break; var i = +el.closest('[data-ei]').dataset.ei, j = a === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= day.exercises.length) break; var t = day.exercises[i]; day.exercises[i] = day.exercises[j]; day.exercises[j] = t; touchPlan(); render(); break;
    case 'delex': if (!day) break; day.exercises.splice(+el.closest('[data-ei]').dataset.ei, 1); touchPlan(); render(); break;
    case 'copy':
      var code = el.dataset.code;
      var ok = function () { el.textContent = 'Copiato'; setTimeout(function () { el.textContent = 'Copia'; }, 1500); };
      try { navigator.clipboard.writeText(code).then(ok).catch(function () {}); } catch (e) {}
      break;
    case 'preview': flush(); S.mode = 'preview'; S.view = 'oggi'; S.autoDone = false; S.dayPicked = false; S.draft = null; S.draftKey = ''; autoDay(); render(); break;
    case 'endpreview': S.mode = 'edit'; S.draft = null; S.draftKey = ''; render(); break;
    case 'done':
      var row = el.closest('.srow'), sets = S.draft && S.draft.sets[row.dataset.ex]; if (!sets) break;
      var s = sets[+row.dataset.i]; s.done = !s.done; row.classList.toggle('is-done', s.done); el.setAttribute('aria-pressed', String(s.done)); saveDraftSoon(); break;
    case 'addset':
      var card = el.closest('[data-exid]'), arr = S.draft && S.draft.sets[card.dataset.exid]; if (!arr) break;
      var l = arr[arr.length - 1] || { kg: '', reps: '' }; arr.push({ kg: l.kg, reps: l.reps, done: false }); saveDraftSoon(); render(); break;
  }
});
app.addEventListener('input', function (ev) {
  var t = ev.target, day = planDay();
  if (t.dataset.f === 'tplname') {
    var tcid = S.cid, tv = t.value;
    debounce('tplname', function () { setStatus('Salvataggio…'); enqueue('tpl:' + tcid, function () { return q(sb.from('templates').update({ name: tv }).eq('id', tcid)); }).then(function () { if (S.tplDoc && S.tplDoc.id === tcid) S.tplDoc.name = tv; setStatus('Salvato', 'ok'); }).catch(onErr); }, 700);
    return;
  }
  if (t.dataset.f) {
    if (!day) return;
    if (t.dataset.f === 'dayname') { day.name = t.value; var i = S.plan.indexOf(day), chip = app.querySelector('[data-chip="' + i + '"]'); if (chip) chip.textContent = t.value || ('Giorno ' + (i + 1)); touchPlan(); return; }
    var card = t.closest('[data-ei]'); if (!card) return; day.exercises[+card.dataset.ei][t.dataset.f] = t.value; touchPlan(); return;
  }
  if (t.dataset.k && S.draft) {
    var row = t.closest('.srow'), sets = S.draft.sets[row.dataset.ex]; if (!sets) return; sets[+row.dataset.i][t.dataset.k] = t.value; saveDraftSoon(); return;
  }
  if (t.dataset.g === 'bw' && S.draft) { S.draft.bodyWeight = t.value; saveDraftSoon(); }
  if (t.dataset.g === 'note' && S.draft) { S.draft.note = t.value; saveDraftSoon(); }
});
app.addEventListener('change', function (ev) { var t = ev.target; if (t.dataset.f === 'name') learnName(t.value); if (t.dataset.g === 'tplsel') S.tplSel = t.value; });
app.addEventListener('submit', function (ev) {
  ev.preventDefault();
  var id = ev.target.id;
  if (id === 'authform') doAuth();
  else if (id === 'claimform') doClaim();
  else if (id === 'addclient') addClient($('#newname').value);
  else if (id === 'addtpl') addTemplate($('#newtpl').value);
  else if (id === 'savetpl') saveAsTemplate($('#savetplname').value.trim());
});
app.addEventListener('focusout', function () { if (S.stale) setTimeout(function () { if (S.stale && !typing()) render(); }, 200); });

document.addEventListener('visibilitychange', function () {
  if (document.hidden) { flush(); return; }
  if (!sb || !S.user || Object.keys(timers).length || typing()) return;
  if (S.mode === 'home') loadHome(true);
  else if ((S.mode === 'client' || S.mode === 'edit') && S.cid && !S.planDirty) loadSession(S.cid, true);
});
window.addEventListener('pagehide', flush);

/* ---------- avvio ---------- */
async function boot() {
  if (!configured) { S.phase = 'setup'; render(); return; }
  if (!window.supabase) { S.phase = 'nolib'; render(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S.user) { S.user = null; S.mode = 'auth'; render(); } });
  S.phase = 'ready';
  try {
    var r = await sb.auth.getSession();
    if (r.data && r.data.session) await afterLogin(r.data.session.user); else S.mode = 'auth';
  } catch (e) { S.mode = 'auth'; onErr(e); }
  render();
}
render();
boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
})();
