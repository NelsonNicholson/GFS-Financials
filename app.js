/* GFS Financials Dashboard — all data comes from Sage Intacct via fetch_fin.py (encrypted data.enc.json). */
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LS_KEY = "gfsFin.pw", EDITS_KEY = "gfsFin.edits", THEME_KEY = "gfsFin.theme", AR_PW_KEY = "arAging.pw";
const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MNL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = { get(k, ses) { try { return (ses ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, ses) { try { (ses ? sessionStorage : localStorage).setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} } };

/* ---------- formatting */
const r2 = v => Math.round((v || 0) * 100) / 100;
const f$ = (v, dec = 0) => { if (v == null || isNaN(v)) return "–"; const a = Math.abs(v), s = a.toLocaleString("en-US", {minimumFractionDigits: dec, maximumFractionDigits: dec});
  return Math.round(v * 10 ** dec) < 0 ? `($${s})` : `$${s}`; };
const fN = v => (v == null || isNaN(v)) ? "–" : (Math.round(v) < 0 ? `(${Math.abs(Math.round(v)).toLocaleString("en-US")})` : Math.round(v).toLocaleString("en-US"));
const fK = v => { if (v == null || isNaN(v)) return "–"; const a = Math.abs(v), sg = v < 0 ? "-" : "";
  return a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${sg}$${(a / 1e3).toFixed(0)}K` : a >= 1e3 ? `${sg}$${(a / 1e3).toFixed(1)}K` : `${sg}$${a.toFixed(0)}`; };
const fP = (v, d = 1) => (v == null || !isFinite(v)) ? "–" : `${(v * 100).toFixed(d)}%`;
const pctOf = (a, b) => (b ? (a - b) / Math.abs(b) : null);
const ymLabel = (m, long) => { const [y, mo] = m.split("-"); return `${(long ? MNL : MN)[+mo - 1]} ${long ? y : y.slice(2)}`; };
const addM = (m, k) => { let [y, mo] = m.split("-").map(Number); mo += k; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; };
const yearMonths = y => MN.map((_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);

/* ---------- state */
let D = null;                 // decrypted snapshot
let M = null;                 // derived model
const st = { view: "summary", rep: null, pl: { layout: "soo", ent: "ALL", mode: "month", actM: null, budM: null, open: new Set(), zeros: false },
  cmp: { a: null, b: null, layout: "soo", ent: "ALL" }, sales: { div: "ALL", mode: "month", cm: true, q: "" }, edits: loadEdits() };
function loadEdits() { try { return JSON.parse(store.get(EDITS_KEY) || "{}"); } catch { return {}; } }
function saveEdits() { store.set(EDITS_KEY, JSON.stringify(st.edits)); }

/* ---------- unlock */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decryptEnv(env, password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter}, base, {name: "AES-GCM", length: 256}, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(env.iv)}, key, b64(env.ct))));
}
async function unlock(password, remember) {
  $("#err").textContent = ""; $("#unlockBtn").disabled = true; $("#unlockBtn").textContent = "Unlocking…";
  try {
    const res = await fetch("data.enc.json?t=" + Date.now(), {cache: "no-store"});
    if (!res.ok) throw new Error("file");
    let snap; try { snap = await decryptEnv(await res.json(), password); } catch { throw new Error("pw"); }
    if (remember) store.set(LS_KEY, password); else store.del(LS_KEY);
    store.set(LS_KEY, password, true);
    start(snap);
  } catch (e) {
    $("#err").textContent = e.message === "pw" ? "That passphrase didn't work." : "Couldn't load the data file. Try again in a minute.";
    store.del(LS_KEY);
  } finally { $("#unlockBtn").disabled = false; $("#unlockBtn").textContent = "Unlock"; }
}

/* ======================================================================= MODEL */
function buildModel(snap) {
  const S = snap.S || [], cfg = snap.cfg || {};
  const s = i => (i == null || i < 0) ? "" : (S[i] ?? "");
  const lines = (snap.gl || []).map(r => ({d: r[0], m: r[0].slice(0, 7), a: r[1], l: r[2] || "", v: r[3], e: s(r[4]), c: s(r[5]), vn: s(r[6]), memo: s(r[7]), j: s(r[8]), u: s(r[9]), je: s(r[10])}));
  const A = {}, months = new Set(), accts = new Set();
  for (const x of lines) {
    accts.add(x.a); months.add(x.m);
    ((A[x.a] ||= {})[x.l] ||= {})[x.m] = ((A[x.a][x.l] ||= {})[x.m] || 0) + x.v;
  }
  const B = {};
  for (const [a, l, m, v] of (snap.bud || [])) { accts.add(a); ((B[a] ||= {})[l || ""] ||= {})[m] = (((B[a] ||= {})[l || ""] ||= {})[m] || 0) + v; }
  Object.keys(cfg.accountNames || {}).forEach(a => accts.add(a));
  const names = Object.assign({}, cfg.accountNames || {}, snap.acctNames || {});
  const cwMap = cfg.cwCustomerDivision || {default: "G1", contains: {}};
  const sdiv = (l, c) => { if (l === "G1" || l === "G2") return l; for (const [k, d] of Object.entries(cwMap.contains || {})) if (c.toUpperCase().includes(k.toUpperCase())) return d; return cwMap.default || "G1"; };
  const sales = (snap.sales || []).map(r => { const c = s(r[2]); return {d: r[0], m: r[0].slice(0, 7), doc: s(r[1]), c, l: r[3], v: r[4], k: r[5], div: sdiv(r[3], c)}; });
  const mv = (snap.mv || []).map(r => ({d: r[0], m: r[0].slice(0, 7), a: r[1], l: r[2], v: r[3], cat: r[4], how: r[5], vn: s(r[6]), memo: s(r[7]), u: s(r[8]), key: r[9], e: s(r[10] ?? -1)}));
  const asOf = snap.asOf;
  const allMonths = [...months].sort();
  return {S, s, cfg, lines, A, B, names, accts: [...accts].filter(a => a >= "4000").sort(), months: allMonths, sales, mv, asOf};
}
const ENTS = {ALL: "Consolidated", G1: "G1", G2: "G2", CW: "CW"};
const kindOf = a => a.startsWith("4") ? "rev" : (a >= "6110" && a < "6200" && !a.startsWith("6120")) ? "adj" : a.startsWith("6120") ? "move" : "exp";
const natural = (a, raw) => (kindOf(a) === "rev" || kindOf(a) === "adj") ? -raw : raw;
function actRaw(a, ent, ms) {
  const byL = M.A[a]; if (!byL) return 0; let t = 0;
  for (const l in byL) { if (ent !== "ALL" && l !== ent) continue; const bm = byL[l]; for (const m of ms) t += bm[m] || 0; }
  return t;
}
function budNat(a, ent, ms) {
  const byL = M.B[a]; if (!byL) return 0; let t = 0;
  for (const l in byL) { if (ent !== "ALL" && l !== ent) continue; const bm = byL[l]; for (const m of ms) t += bm[m] || 0; }
  if (kindOf(a) === "adj" && !/^617/.test(a)) t = -t;   // adjustment expenses budgeted as positive -> income-positive view
  return t;
}
const accVal = (a, ent, ms, field) => field === "b" ? budNat(a, ent, ms) : natural(a, actRaw(a, ent, ms));

/* ---------- office compensation split (Statement of Operations) */
const cfgx = () => Object.assign({}, M.cfg, mergedEdits());
function mergedEdits() {
  const e = st.edits || {}, c = M.cfg; const o = {};
  if (e.moveManual) o.moveManual = Object.assign({}, c.moveManual || {}, e.moveManual);
  if (e.palletsOnHand) o.palletsOnHand = Object.assign({}, c.palletsOnHand || {}, e.palletsOnHand);
  if (e.priorYear) o.priorYear = Object.assign({}, c.priorYear || {}, e.priorYear);
  if (e.customerAliases) o.customerAliases = Object.assign({}, c.customerAliases || {}, e.customerAliases);
  if (e.capacity) o.capacity = Object.assign({}, c.capacity || {}, e.capacity);
  return o;
}
function empRole(id) { const e = (M.cfg.employees || {})[id]; return e ? e.role : ""; }
function ocLineRole(x) {           // which bucket a 6005-001/-006 line belongs to (months after the freeze)
  const reclass = (M.cfg.salaryReclassMemo || "Salary Reclass").toLowerCase();
  if (x.memo.toLowerCase().includes(reclass)) return "realloc";
  const r = empRole(x.e);
  if (r === "cc" || r === "whm") return r;
  if (x.a === "6005-001" && (r === "mgmt" || (!x.e && (x.j === (M.cfg.joeKernodle || {}).journal || /\bJK\b/.test(x.memo))))) return "mgmt";
  return "other";
}
const ocCache = {};
function officeComp(m) {
  if (ocCache[m]) return ocCache[m];
  const frozen = M.cfg.officeCompFrozenThrough || "";
  const hist = (M.cfg.officeCompHistory || {})[m];
  const total = natural("6005-001", actRaw("6005-001", "ALL", [m])) + natural("6005-006", actRaw("6005-006", "ALL", [m]));
  let r;
  if (m <= frozen && hist) {
    r = {cc: hist.cc, whm: hist.whm, mgmt: hist.mgmt, ovtax: r2(total - hist.cc - hist.whm - hist.mgmt), frozen: true};
  } else {
    let cc = 0, whm = 0, mg = 0;
    for (const x of M.lines) if (x.m === m && (x.a === "6005-001" || x.a === "6005-006")) {
      const k = ocLineRole(x); if (k === "cc") cc += x.v; else if (k === "whm") whm += x.v; else if (k === "mgmt") mg += x.v;
    }
    r = {cc: r2(cc), whm: r2(whm), mgmt: r2(mg), ovtax: r2(total - cc - whm - mg), frozen: false};
  }
  return (ocCache[m] = r);
}
function ocBudget(m) {
  const ob = (M.cfg.overheadWageBudget || {})[m] || {mgmt: 0, ovTax: 0};
  const tot = budNat("6005-001", "ALL", [m]) + budNat("6005-006", "ALL", [m]);
  return {ccwhm: tot - ob.mgmt - ob.ovTax, mgmt: ob.mgmt, ovtax: ob.ovTax};
}
function virtVal(k, ms, field) {
  let t = 0;
  for (const m of ms) {
    if (field === "b") { const b = ocBudget(m); t += k === "cc" ? b.ccwhm : k === "whm" ? 0 : b[k]; }
    else t += officeComp(m)[k];
  }
  return t;
}

/* ---------- layouts */
const accts = pred => M.accts.filter(pred);
const pre = (...p) => a => p.some(x => a.startsWith(x));
const sfx = a => +(a.split("-")[1] || 0);
function rowsOf(list) { return list.map(a => ({t: "acct", a, id: "a:" + a, label: `${a} - ${M.names[a] || ""}`})); }
function layoutDef(type, ent) {
  const L = [];
  const used = new Set();
  const grp = (id, label, rows, good) => { rows.forEach(r => r.t === "acct" && used.add(r.a)); L.push({k: "grp", id, label, rows, good}); };
  const sec = label => L.push({k: "sec", label});
  const tot = (id, label, parts, good, big) => L.push({k: "tot", id, label, parts, good, big});
  const pct = (label, num, den) => L.push({k: "pct", label, num, den});
  const gap = () => L.push({k: "gap"});
  sec("Revenue");
  grp("rv_st", "Storage Revenue", rowsOf(accts(pre("4005"))), 1);
  grp("rv_fu", "Fulfillment Revenue", rowsOf(accts(pre("4010"))), 1);
  grp("rv_ha", "Handling Revenue", rowsOf(accts(pre("4015"))), 1);
  grp("rv_fr", "Freight Revenue", rowsOf(accts(pre("4020"))), 1);
  grp("rv_ot", "Other Revenue", rowsOf(accts(a => a.startsWith("4") && !used.has(a))), 1);
  tot("rev", "Total Revenue", [["rv_st", 1], ["rv_fu", 1], ["rv_ha", 1], ["rv_fr", 1], ["rv_ot", 1]], 1, true);
  gap(); sec("Cost of Goods Sold");
  grp("cg_fr", "Freight Expense", rowsOf(accts(pre("5010", "5011", "5012", "5013"))), -1);
  grp("cg_lb", "Warehouse Labor", rowsOf(accts(pre("5035", "5040", "5045"))), -1);
  grp("cg_cm", "Commissions Expense", rowsOf(accts(pre("5025"))), -1);
  grp("cg_pm", "Production Materials", rowsOf(accts(pre("5020"))), -1);
  const oc5 = accts(a => a.startsWith("5") && !used.has(a)); if (oc5.length) grp("cg_ot", "Other COGS", rowsOf(oc5), -1);
  tot("cogs", "Total Cost of Goods Sold", [["cg_fr", 1], ["cg_lb", 1], ["cg_cm", 1], ["cg_pm", 1], ["cg_ot", 1]], -1);
  const soo = type === "soo";
  tot("gp", soo ? "Total Warehouse Operating Profit" : "Total Gross Profit", [["rev", 1], ["cogs", -1]], 1, true);
  pct(soo ? "Operating Margin" : "Gross Margin", "gp", "rev");
  gap();
  if (soo) {
    sec("Direct Operating Expense");
    grp("d_oc", "Customer Care & WH Manager Wages", [{t: "v", k: "cc", id: "v:cc", label: "Customer Care", nb: true}, {t: "v", k: "whm", id: "v:whm", label: "Warehouse Manager", nb: true}], -1);
    ["6005-001", "6005-006"].forEach(a => used.add(a));
    grp("d_wh", "Warehouse Operating Expense", rowsOf(accts(pre("6010"))), -1);
    grp("d_ad", "Administrative Expenses", rowsOf(accts(a => a.startsWith("6015") && sfx(a) >= 7)), -1);
    grp("d_oo", "Occupancy & Utility Expenses", rowsOf(accts(a => a.startsWith("6025") && a !== "6025-005")), -1);
    tot("dox", "Total Direct Operating Expense", [["d_oc", 1], ["d_wh", 1], ["d_ad", 1], ["d_oo", 1]], -1);
    tot("woi", "Warehouse Operating Income", [["gp", 1], ["dox", -1]], 1, true);
    pct("WH Operating Margin", "woi", "rev");
    gap(); sec("Allocated Overhead Expense");
    const ocRows = [{t: "v", k: "mgmt", id: "v:mgmt", label: "Management Wages"}];
    accts(a => a.startsWith("6005") && !["6005-001", "6005-006", "6005-007"].includes(a)).forEach(a => ocRows.push(...rowsOf([a])));
    ocRows.push({t: "v", k: "ovtax", id: "v:ovtax", label: "6005-006 - Taxes"});
    if (M.accts.includes("6005-007")) ocRows.push(...rowsOf(["6005-007"]));
    grp("o_oc", "Office Compensation", ocRows, -1);
    grp("o_ad", "Administrative Expenses", rowsOf(accts(a => a.startsWith("6015") && sfx(a) < 7)), -1);
    grp("o_pf", "Professional Fees", rowsOf(accts(pre("6020"))), -1);
    grp("o_oo", "Occupancy & Utility Expenses", rowsOf(accts(a => a === "6025-005")), -1);
    grp("o_it", "Computer Equipment & IT Expense", rowsOf(accts(pre("6030"))), -1);
    grp("o_bd", "Business Development Expenses", rowsOf(accts(pre("6035"))), -1);
    const un = accts(a => a >= "6000" && a < "6110" && !used.has(a)); if (un.length) grp("o_un", "Other / Unmapped Expense", rowsOf(un), -1);
    tot("opx", "Total Overhead Expense", [["o_oc", 1], ["o_ad", 1], ["o_pf", 1], ["o_oo", 1], ["o_it", 1], ["o_bd", 1], ["o_un", 1]], -1);
    tot("uni", "Unadjusted Net Income", [["woi", 1], ["opx", -1]], 1, true);
  } else {
    sec("Operating Expense");
    grp("x_oc", "Office Compensation", rowsOf(accts(pre("6005"))), -1);
    grp("x_wh", "Warehouse Operating Expense", rowsOf(accts(pre("6010"))), -1);
    grp("x_ad", "Administrative Expenses", rowsOf(accts(pre("6015"))), -1);
    grp("x_pf", "Professional Fees", rowsOf(accts(pre("6020"))), -1);
    grp("x_oo", "Occupancy & Utility Expenses", rowsOf(accts(pre("6025"))), -1);
    grp("x_it", "Computer Equipment & IT Expense", rowsOf(accts(pre("6030"))), -1);
    grp("x_bd", "Business Development Expenses", rowsOf(accts(pre("6035"))), -1);
    const un = accts(a => a >= "6000" && a < "6110" && !used.has(a)); if (un.length) grp("x_un", "Other / Unmapped Expense", rowsOf(un), -1);
    tot("opx", "Total Operating Expense", [["x_oc", 1], ["x_wh", 1], ["x_ad", 1], ["x_pf", 1], ["x_oo", 1], ["x_it", 1], ["x_bd", 1], ["x_un", 1]], -1);
    tot("uni", "Unadjusted Net Income", [["gp", 1], ["opx", -1]], 1, true);
  }
  pct("Unadjusted Net Margin", "uni", "rev");
  gap(); sec("Adjustments to Net Income");
  grp("adj", "Adjustments to Net Income", rowsOf(accts(a => kindOf(a) === "adj")), 1);
  tot("ani", "Total Adjusted Net Income", [["uni", 1], ["adj", 1]], 1, true);
  pct("Adjusted Net Margin", "ani", "rev");
  if (ent === "ALL") {
    gap();
    grp("mv", "G3 Move Operating Expense", rowsOf(accts(a => kindOf(a) === "move")), -1);
    tot("nim", "Net Income Adjusted for Move Expense", [["ani", 1], ["mv", -1]], 1, true);
  }
  return L;
}

/* compute every row/total for one column */
const colCache = new Map();
function computeCol(type, ent, ms, field) {
  const key = [type, ent, ms.join(","), field].join("|");
  if (colCache.has(key)) return colCache.get(key);
  const L = layoutDef(type, ent), V = {};
  for (const it of L) {
    if (it.k === "grp") {
      let t = 0;
      for (const r of it.rows) {
        let v = r.t === "acct" ? accVal(r.a, ent, ms, field) : virtVal(r.k, ms, field);
        V[r.id] = v; t += v;
      }
      V[it.id] = t;
    } else if (it.k === "tot") V[it.id] = it.parts.reduce((s, [id, sg]) => s + (V[id] || 0) * sg, 0);
  }
  colCache.set(key, V);
  return V;
}

/* ---------- GL line selection for drill-downs */
function linesFor(spec, ent, ms) {
  const mset = new Set(ms);
  const pick = x => mset.has(x.m) && (ent === "ALL" || x.l === ent);
  if (spec.t === "acct") return M.lines.filter(x => x.a === spec.a && pick(x));
  if (spec.t === "accts") { const s = new Set(spec.list); return M.lines.filter(x => s.has(x.a) && pick(x)); }
  if (spec.t === "v") return M.lines.filter(x => (x.a === "6005-001" || x.a === "6005-006") && pick(x) &&
    (officeComp(x.m).frozen || (spec.k === "ovtax" ? ["other", "realloc"].includes(ocLineRole(x)) : ocLineRole(x) === spec.k)));
  return [];
}
const cpKey = x => x.c || x.vn || (x.e ? empName(x.e) : "") || (x.memo ? x.memo.slice(0, 60) : "") || "Journal entry";
function empName(id) { const e = (M.cfg.employees || {})[id]; return e ? e.name : id; }
function drivers(spec, ent, msA, msB) {
  const agg = new Map();
  const add = (x, w) => { const k = cpKey(x); const o = agg.get(k) || {k, a: 0, b: 0}; const v = natural(x.a, x.v); if (w === "a") o.a += v; else o.b += v; agg.set(k, o); };
  linesFor(spec, ent, msA).forEach(x => add(x, "a"));
  if (msB) linesFor(spec, ent, msB).forEach(x => add(x, "b"));
  return [...agg.values()].map(o => ({...o, d: o.b - o.a}));
}

/* ======================================================================= CHARTS */
const tip = $("#tip");
function showTip(e, html) { tip.innerHTML = html; tip.classList.remove("hidden");
  const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14; tip.style.left = x + "px"; tip.style.top = y + "px"; }
const hideTip = () => tip.classList.add("hidden");
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
/* bars + lines on one axis. series: {name, values, color, type:'bar'|'line'|'dash'} */
function comboChart(el, {labels, series, height = 240, fmt = fK, onClick, stacked = false}) {
  const W = Math.max(320, Math.round(el.clientWidth || 640)), H = height, pl = 54, pr = 10, pt = 10, pb = 26;
  const bars = series.filter(s => s.type === "bar"), lines = series.filter(s => s.type !== "bar");
  let mx = 0, mn = 0;
  labels.forEach((_, i) => {
    if (stacked) { let p = 0, n = 0; bars.forEach(s => { const v = s.values[i] || 0; v > 0 ? p += v : n += v; }); mx = Math.max(mx, p); mn = Math.min(mn, n); }
    else bars.forEach(s => { const v = s.values[i] || 0; mx = Math.max(mx, v); mn = Math.min(mn, v); });
    lines.forEach(s => { const v = s.values[i]; if (v != null) { mx = Math.max(mx, v); mn = Math.min(mn, v); } });
  });
  const top = niceMax(mx * 1.05), bot = mn < 0 ? -niceMax(-mn * 1.05) : 0;
  const y = v => pt + (top - v) / (top - bot) * (H - pt - pb);
  const n = labels.length, cw = (W - pl - pr) / Math.max(n, 1);
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = bot + (top - bot) * k / 4; g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
  if (bot < 0) g += `<line class="zero" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>`;
  const bw = Math.min(28, (cw - 8) / (stacked ? 1 : Math.max(bars.length, 1)) - 2);
  labels.forEach((lb, i) => {
    const cx = pl + cw * i + cw / 2;
    if (n <= 14 || i % 2 === 0) g += `<text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`;
    let p = 0, q = 0;
    bars.forEach((s, j) => {
      const v = s.values[i] || 0; if (!v) return;
      let x0, y0, y1;
      if (stacked) { x0 = cx - bw / 2; if (v >= 0) { y0 = y(p + v); y1 = y(p); p += v; } else { y0 = y(q); y1 = y(q + v); q += v; } }
      else { x0 = cx - (bars.length * (bw + 2)) / 2 + j * (bw + 2); y0 = y(Math.max(v, 0)); y1 = y(Math.min(v, 0)); }
      const hgt = Math.max(1, y1 - y0 - (stacked ? 1 : 0)), r = Math.min(4, hgt / 2, bw / 2);
      g += v >= 0 ? `<path d="M${x0},${y0 + hgt} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y0 + hgt} Z" fill="${s.color}"/>`
        : `<path d="M${x0},${y0} V${y0 + hgt - r} Q${x0},${y0 + hgt} ${x0 + r},${y0 + hgt} H${x0 + bw - r} Q${x0 + bw},${y0 + hgt} ${x0 + bw},${y0 + hgt - r} V${y0} Z" fill="${s.color}"/>`;
    });
  });
  lines.forEach(s => {
    const pts = s.values.map((v, i) => v == null ? null : [pl + cw * i + cw / 2, y(v)]);
    let d = ""; pts.forEach((p, i) => { if (!p) return; d += (d && pts[i - 1] ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.type === "dash" ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(p => { if (p && s.type === "line") g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`; });
  });
  g += `<line id="xh" class="gl" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="stroke:var(--muted);opacity:0"/>`;
  labels.forEach((_, i) => g += `<rect data-i="${i}" x="${pl + cw * i}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent" style="cursor:${onClick ? "pointer" : "default"}"/>`);
  el.innerHTML = `<div class="legend">${series.map(s => `<span><i class="${s.type === "bar" ? "" : s.type === "dash" ? "dash" : "line"}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div><div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(", "))} by period">${g}</svg></div>`;
  const svg = $("svg", el), xh = $("#xh", el);
  $$("rect[data-i]", el).forEach(r => {
    const i = +r.dataset.i;
    r.addEventListener("mousemove", e => { const cx = pl + cw * i + cw / 2; xh.setAttribute("x1", cx); xh.setAttribute("x2", cx); xh.style.opacity = .35;
      showTip(e, `<b>${esc(labels[i])}</b>` + series.map(s => `<div class="r"><span><i class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${s.color};margin-right:5px"></i>${esc(s.name)}</span><span class="num">${s.values[i] == null ? "–" : f$(s.values[i])}</span></div>`).join("")); });
    r.addEventListener("mouseleave", () => { xh.style.opacity = 0; hideTip(); });
    if (onClick) r.addEventListener("click", () => onClick(i));
  });
  return svg;
}
function spark(vals, bvals, color = "var(--s1)") {
  const W = 200, H = 34, v = vals.filter(x => x != null), all = v.concat((bvals || []).filter(x => x != null));
  if (!v.length) return "";
  const mx = Math.max(...all), mn = Math.min(0, ...all), n = vals.length;
  const X = i => 2 + i * (W - 4) / Math.max(n - 1, 1), Y = x => H - 3 - (x - mn) / ((mx - mn) || 1) * (H - 6);
  const path = arr => arr.map((x, i) => x == null ? "" : `${i && arr[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-hidden="true">${bvals ? `<path d="${path(bvals)}" fill="none" stroke="var(--budget)" stroke-width="1.5" stroke-dasharray="4 3"/>` : ""}<path d="${path(vals)}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${X(n - 1)}" cy="${Y(vals[n - 1] ?? 0)}" r="3" fill="${color}"/></svg>`;
}
function waterfall(el, items, {height = 260} = {}) {
  const W = Math.max(320, Math.round(el.clientWidth || 640)), H = height, pl = 54, pr = 10, pt = 14, pb = 44;
  let run = 0, mx = 0, mn = 0; const geo = [];
  items.forEach(it => { if (it.type === "delta") { const a = run, b = run + it.v; geo.push([a, b]); run = b; } else { run = it.v; geo.push([0, it.v]); } mx = Math.max(mx, ...geo.at(-1)); mn = Math.min(mn, ...geo.at(-1)); });
  const top = niceMax(mx * 1.08), bot = mn < 0 ? -niceMax(-mn * 1.1) : 0;
  const y = v => pt + (top - v) / (top - bot) * (H - pt - pb), cw = (W - pl - pr) / items.length, bw = Math.min(46, cw - 10);
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = bot + (top - bot) * k / 4; g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fK(v)}</text>`; }
  items.forEach((it, i) => {
    const [a, b] = geo[i], x = pl + cw * i + (cw - bw) / 2, y0 = y(Math.max(a, b)), h = Math.max(1, Math.abs(y(a) - y(b)));
    const col = it.type !== "delta" ? "var(--navy)" : it.v >= 0 ? "var(--good)" : "var(--bad)";
    g += `<rect x="${x}" y="${y0}" width="${bw}" height="${h}" rx="3" fill="${col}" data-i="${i}" style="cursor:${it.onClick ? "pointer" : "default"}"/>`;
    if (i < items.length - 1) g += `<line x1="${x + bw}" x2="${x + cw}" y1="${y(b)}" y2="${y(b)}" stroke="var(--muted)" stroke-dasharray="2 2"/>`;
    g += `<text class="ax" x="${x + bw / 2}" y="${y0 - 4}" text-anchor="middle" style="fill:var(--text);font-weight:600">${it.type === "delta" ? (it.v >= 0 ? "+" : "−") + fK(Math.abs(it.v)).replace("-", "") : fK(it.v)}</text>`;
    const words = it.label.split(" "); let l1 = "", l2 = "";
    words.forEach(w => (l1.length + w.length < 13 && !l2) ? l1 += (l1 ? " " : "") + w : l2 += (l2 ? " " : "") + w);
    g += `<text class="ax" x="${x + bw / 2}" y="${H - pb + 14}" text-anchor="middle">${esc(l1)}</text><text class="ax" x="${x + bw / 2}" y="${H - pb + 27}" text-anchor="middle">${esc(l2)}</text>`;
  });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bridge from budget to actual">${g}</svg></div>`;
  $$("rect[data-i]", el).forEach(r => { const it = items[+r.dataset.i];
    r.addEventListener("mousemove", e => showTip(e, `<b>${esc(it.label)}</b><div class="r"><span>${it.type === "delta" ? "Impact" : "Amount"}</span><span class="num">${f$(it.v)}</span></div>${it.note ? `<div class="muted small">${esc(it.note)}</div>` : ""}`));
    r.addEventListener("mouseleave", hideTip); if (it.onClick) r.addEventListener("click", it.onClick); });
}
function hbars(items, {fmt = f$, color = "var(--s1)", onClick} = {}) {
  const mx = Math.max(1, ...items.map(i => Math.abs(i.v)));
  const html = items.map((it, k) => `<div class="hbar ${onClick ? "click" : ""}" data-k="${k}"><span class="nm" title="${esc(it.label)}">${esc(it.label)}</span><span class="tr"><span style="left:0;width:${Math.abs(it.v) / mx * 100}%;background:${it.color || (it.v < 0 ? "var(--bad)" : color)}"></span></span><span class="num">${fmt(it.v)}</span></div>`).join("");
  return {html, bind: el => onClick && $$(".hbar", el).forEach(b => b.addEventListener("click", () => onClick(items[+b.dataset.k])))};
}

/* ======================================================================= DRAWER */
let drawerRows = [];
function openDrawer(kicker, title, html, rows) {
  $("#dKicker").textContent = kicker; $("#dTitle").textContent = title; $("#dBody").innerHTML = html; drawerRows = rows || [];
  $("#dCsv").classList.toggle("hidden", !drawerRows.length);
  $("#drawer").classList.remove("hidden"); $("#scrim").classList.remove("hidden"); $("#dBody").scrollTop = 0;
}
function closeDrawer() { $("#drawer").classList.add("hidden"); $("#scrim").classList.add("hidden"); }
const sageUrl = u => u ? `https://www.intacct.com/ia/acct/ur.phtml?.r=${encodeURIComponent(u)}` : "";
function linesTable(ls, {sign = true} = {}) {
  const rows = ls.map(x => ({...x, nv: sign ? natural(x.a, x.v) : x.v}));
  drawerRows = rows.map(x => ({Date: x.d, Account: x.a, Division: x.l, Customer: x.c, Vendor: x.vn, Employee: x.e ? empName(x.e) : "", Memo: x.memo, Journal: x.j, Amount: r2(x.nv)}));
  $("#dCsv").classList.toggle("hidden", !rows.length);
  return `<div class="tscroll" style="max-height:none"><table class="lines" id="lt"><thead><tr><th data-s="d">Date</th><th data-s="a">Acct</th><th data-s="l">Div</th><th data-s="cp">Customer / Vendor / Employee</th><th>Memo</th><th data-s="j">Jrnl</th><th class="num" data-s="nv">Amount</th><th></th></tr></thead><tbody>${
    rows.map(x => `<tr><td>${esc(x.d)}</td><td>${esc(x.a)}</td><td>${esc(x.l)}</td><td>${esc(x.c || x.vn || (x.e ? empName(x.e) : ""))}</td><td class="memo">${esc(x.memo)}</td><td>${esc(x.j)}</td><td class="num">${f$(x.nv, 2)}</td><td>${x.u ? `<a href="${sageUrl(x.u)}" target="_blank" rel="noopener" title="Open in Sage Intacct">↗</a>` : ""}</td></tr>`).join("")
  }</tbody></table></div>`;
}
function bindSort(el, rows, render) { $$("th[data-s]", el).forEach(th => th.addEventListener("click", () => { const k = th.dataset.s; const dir = th.dataset.dir = th.dataset.dir === "asc" ? "desc" : "asc"; rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "asc" ? 1 : -1)); render(); })); }
function drill(spec, ent, ms, label, cmpMs) {
  const ls = linesFor(spec, ent, ms).sort((a, b) => a.d < b.d ? 1 : -1);
  const tot = ls.reduce((s, x) => s + natural(x.a, x.v), 0);
  const per = ms.length === 1 ? ymLabel(ms[0], true) : `${ymLabel(ms[0])} – ${ymLabel(ms.at(-1))}`;
  const dv = drivers(spec, ent, ms).sort((a, b) => Math.abs(b.a) - Math.abs(a.a)).slice(0, 10);
  const hb = hbars(dv.map(d => ({label: d.k, v: d.a})));
  let note = "";
  if (spec.t === "v" && ms.some(m => officeComp(m).frozen)) note = `<div class="banner info">Before the employee field was added to the GL (June 2026), this line's split is locked to the monthly package. The lines below are all office wage and tax lines for the period.</div>`;
  if (D.mode === "preview") note += `<div class="banner">Preview data: one line per account and division per month. The live Sage feed shows every journal line here.</div>`;
  const html = `${note}<div class="dstats"><div><b>${f$(tot)}</b><span>Total ${esc(per)}</span></div><div><b>${ls.length.toLocaleString()}</b><span>GL lines</span></div><div><b>${esc(ENTS[ent])}</b><span>Entity</span></div></div>
    ${dv.length > 1 ? `<div class="panel"><h3>Biggest contributors</h3><div class="hbars" style="margin-top:8px">${hb.html}</div></div>` : ""}
    <h3 style="font-size:15px;color:var(--navy);margin:8px 0">Journal lines</h3>${linesTable(ls)}`;
  openDrawer(`${ENTS[ent]} · ${per}`, label, html, drawerRows);
  const keep = drawerRows; drawerRows = keep;
}

/* ======================================================================= SHARED HELPERS */
const monthsThrough = m => yearMonths(m.slice(0, 4)).filter(x => x <= m);
const prevM = m => addM(m, -1);
function val(id, type, ent, ms, field) { return computeCol(type, ent, ms, field)[id] || 0; }
function deltaCls(d, good) { if (!d || Math.abs(d) < 0.5) return ""; return (d * good) > 0 ? "pos" : "neg"; }
function varHtml(a, b, good, asPct) { const d = a - b; const c = deltaCls(d, good); const p = pctOf(a, b);
  return asPct ? `<span class="${c}">${p == null ? "–" : (p > 0 ? "+" : "") + fP(p)}</span>` : `<span class="${c}">${d > 0 ? "+" : ""}${f$(d)}</span>`; }
function entsAvailable(y) { return ["ALL", "G1", "G2", "CW"].filter(e => e === "ALL" || M.lines.some(x => x.l === e && x.m.startsWith(y))); }

/* ======================================================================= VIEWS */
const views = {};
function render() {
  colCache.clear(); SIX = null; for (const k in ocCache) delete ocCache[k];
  $$("#nav button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === st.view));
  hideTip();
  (views[st.view] || views.summary)($("#view"));
}

/* ---------------------------------------------------------- SUMMARY */
views.summary = el => {
  const m = st.rep, y = m.slice(0, 4), ytd = monthsThrough(m), pm = prevM(m), T = "soo";
  const last12 = Array.from({length: 12}, (_, i) => addM(m, i - 11)).filter(x => x >= (M.months[0] || x));
  const K = [
    {id: "rev", label: "Revenue", good: 1},
    {id: "gp", label: "Warehouse Operating Profit", good: 1, mg: true},
    {id: "woi", label: "Warehouse Operating Income", good: 1, mg: true},
    {id: "uni", label: "Unadjusted Net Income", good: 1, mg: true},
    {id: "ani", label: "Adjusted Net Income", good: 1},
    {id: "mv", label: "G3 Move Expense (P&L)", good: -1},
  ];
  const py = (cfgx().priorYear || {})[addM(m, -12)];
  const tiles = K.map(k => {
    const a = val(k.id, T, "ALL", [m], "a"), b = val(k.id, T, "ALL", [m], "b"), p = val(k.id, T, "ALL", [pm], "a");
    const ya = val(k.id, T, "ALL", ytd, "a"), yb = val(k.id, T, "ALL", ytd, "b");
    const rev = val("rev", T, "ALL", [m], "a");
    const pyv = py && ({rev: py.revenue, gp: py.grossProfit, uni: py.unadjustedNI})[k.id];
    const sv = last12.map(x => val(k.id, T, "ALL", [x], "a")), sb = last12.map(x => val(k.id, T, "ALL", [x], "b"));
    return `<div class="card kpi" data-k="${k.id}"><div class="label">${esc(k.label)}</div><div class="value">${fK(a)}</div>
      <div class="rows"><span>vs budget ${fK(b)}: <b class="${deltaCls(a - b, k.good)}">${a - b >= 0 ? "+" : ""}${fK(a - b)}</b></span>
      <span>vs ${ymLabel(pm)}: <b class="${deltaCls(a - p, k.good)}">${a - p >= 0 ? "+" : ""}${fK(a - p)}</b>${k.mg ? ` · margin ${fP(rev ? a / rev : null)}` : ""}</span>
      <span>YTD ${fK(ya)} vs ${fK(yb)} <b class="${deltaCls(ya - yb, k.good)}">${ya - yb >= 0 ? "+" : ""}${fK(ya - yb)}</b></span>
      ${pyv != null ? `<span>vs ${ymLabel(addM(m, -12))}: <b class="${deltaCls(a - pyv, k.good)}">${a - pyv >= 0 ? "+" : ""}${fK(a - pyv)}</b></span>` : ""}</div>
      ${spark(sv, k.id === "mv" ? null : sb, k.good > 0 ? "var(--s1)" : "var(--s2)")}</div>`;
  }).join("");

  el.innerHTML = `<div class="viewhead"><div><h2>${ymLabel(m, true)} at a glance</h2><div class="desc">Consolidated Statement of Operations. Click any tile, bar or line for the detail behind it.</div></div></div>
    <div class="kpis">${tiles}</div>
    <div class="grid-wide">
      <div class="card panel"><h3>What moved this month</h3><p class="sub">Largest differences from budget in ${ymLabel(m, true)}, explained from the GL lines.</p><ul class="insights" id="sumIns"></ul></div>
      <div class="card panel"><h3>Budget to actual: Unadjusted Net Income</h3><p class="sub">${ymLabel(m, true)} · green helps, red hurts</p><div id="wf"></div></div>
    </div>
    <div class="grid2">
      <div class="card panel"><h3>Revenue by month</h3><p class="sub">Actual vs budget, ${y}. Click a month to open it on the P&L.</p><div id="chRev"></div></div>
      <div class="card panel"><h3>Profit trend</h3><p class="sub">Warehouse Operating Income and Unadjusted Net Income vs budget</p><div id="chNi"></div></div>
    </div>
    <div class="card panel"><h3>Divisions · ${ymLabel(m, true)}</h3><p class="sub">Standard P&L by division (G3 Move is consolidated only). Click a card to open that division's P&L.</p><div class="divcards" id="divs"></div></div>
    <div class="grid2">
      <div class="card panel"><h3>Warehouse labor</h3><p class="sub">Labor we carry vs labor billed back to customers</p><div id="labor"></div></div>
      <div class="card panel"><h3>Overtime control</h3><p class="sub">Overtime as a share of regular wages · 8% is a normal month</p><div id="ot"></div></div>
    </div>
    <div class="grid2">
      <div class="card panel"><h3>Freight markup & financial injuries</h3><p class="sub">Adjusted markup excludes shipping errors and carrier service charges</p><div id="frt"></div></div>
      <div class="card panel"><h3>Customer movers</h3><p class="sub">Biggest changes in invoiced sales, ${ymLabel(m)} vs ${ymLabel(pm)}</p><div id="movers"></div></div>
    </div>
    <div class="grid2">
      <div class="card panel"><h3>Capacity tracker</h3><p class="sub">End-of-month pallets on hand vs capacity</p><div id="cap"></div></div>
      <div class="card panel"><h3>Accounts receivable</h3><p class="sub">Live from the AR dashboard</p><div id="arSum"></div></div>
    </div>`;
  $$(".kpi", el).forEach(t => t.addEventListener("click", () => { st.view = "pl"; st.pl.layout = "soo"; st.pl.ent = "ALL"; st.pl.mode = "month"; st.pl.actM = st.pl.budM = m; render(); }));

  // insights vs budget (category level, as budgets are set by category)
  const L = layoutDef(T, "ALL");
  const cand = L.filter(i => i.k === "grp" && i.id !== "mv").map(g => {
    const a = val(g.id, T, "ALL", [m], "a"), b = val(g.id, T, "ALL", [m], "b");
    return {g, a, b, d: (a - b) * g.good};
  }).filter(c => Math.abs(c.d) >= 1000).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 7);
  const ins = cand.map(c => {
    const accs = c.g.rows.map(r => ({r, v: r.t === "acct" ? accVal(r.a, "ALL", [m], "a") : virtVal(r.k, [m], "a"), p: r.t === "acct" ? accVal(r.a, "ALL", [pm], "a") : virtVal(r.k, [pm], "a")}))
      .filter(x => Math.abs(x.v) > 0.5 || Math.abs(x.p) > 0.5).sort((x, y) => Math.abs(y.v - y.p) - Math.abs(x.v - x.p));
    const top = accs.slice(0, 2).map(x => `${x.r.label.replace(/^\d{4}(-\d{3})? - /, "")} ${fK(x.v)} (${x.v - x.p >= 0 ? "+" : ""}${fK(x.v - x.p)} vs ${ymLabel(pm)})`);
    const spec = {t: "accts", list: c.g.rows.filter(r => r.t === "acct").map(r => r.a)};
    const dv = c.g.rows.some(r => r.t === "v") ? [] : drivers(spec, "ALL", [pm], [m]).filter(d => !/package/i.test(d.k)).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 3)
      .filter(d => Math.abs(d.d) >= 500).map(d => `${d.k} ${d.d > 0 ? "+" : ""}${fK(d.d)}`);
    return {good: c.d > 0, c, html: `<b>${esc(c.g.label)}</b> ${fK(c.a)} vs ${fK(c.b)} budget (${c.a - c.b > 0 ? "+" : ""}${fK(c.a - c.b)})<div class="why">${esc(top.join(" · "))}${dv.length ? `<br>Biggest changes vs ${ymLabel(pm)}: ${esc(dv.join(" · "))}` : ""}</div>`};
  });
  const ul = $("#sumIns", el);
  ul.innerHTML = ins.map((x, i) => `<li class="click" data-i="${i}"><span class="ic ${x.good ? "good" : "bad"}">${x.good ? "▲" : "▼"}</span><div class="tx">${x.html}</div></li>`).join("") || `<li><div class="tx muted">Nothing material vs budget.</div></li>`;
  $$("li[data-i]", ul).forEach(li => li.addEventListener("click", () => { const g = ins[+li.dataset.i].c.g; const v = g.rows.filter(r => r.t === "v");
    if (v.length) drillGroupVirtual(v, g.rows.filter(r => r.t === "acct").map(r => r.a), "ALL", [m], g.label); else drill({t: "accts", list: g.rows.map(r => r.a)}, "ALL", [m], g.label); }));

  // waterfall
  const W = computeCol(T, "ALL", [m], "a"), WB = computeCol(T, "ALL", [m], "b");
  const step = (id, lab, sgn) => ({label: lab, v: (W[id] - WB[id]) * sgn, type: "delta"});
  waterfall($("#wf", el), [{label: "Budget", v: WB.uni, type: "start"}, step("rev", "Revenue", 1), step("cogs", "COGS", -1), step("dox", "Direct opex", -1), step("opx", "Overhead", -1), {label: "Actual", v: W.uni, type: "end"}]);

  // revenue chart
  const ym = yearMonths(y), ms = ym.filter(x => x <= m);
  comboChart($("#chRev", el), {labels: ym.map(x => MN[+x.slice(5) - 1]), series: [
    {name: "Actual", type: "bar", color: "var(--s1)", values: ym.map(x => x <= m ? val("rev", T, "ALL", [x], "a") : null)},
    {name: "Budget", type: "dash", color: "var(--budget)", values: ym.map(x => val("rev", T, "ALL", [x], "b"))}],
    onClick: i => { if (ym[i] <= m) { st.view = "pl"; st.pl.mode = "month"; st.pl.actM = st.pl.budM = ym[i]; render(); } }});
  comboChart($("#chNi", el), {labels: ms.map(x => MN[+x.slice(5) - 1]), series: [
    {name: "WH Operating Income", type: "line", color: "var(--s1)", values: ms.map(x => val("woi", T, "ALL", [x], "a"))},
    {name: "Unadjusted NI", type: "line", color: "var(--s2)", values: ms.map(x => val("uni", T, "ALL", [x], "a"))},
    {name: "Unadjusted NI budget", type: "dash", color: "var(--budget)", values: ms.map(x => val("uni", T, "ALL", [x], "b"))}]});

  // division cards
  $("#divs", el).innerHTML = entsAvailable(y).filter(e => e !== "ALL").filter(e => e !== "CW" || val("rev", "std", "CW", [m], "a") || val("rev", "std", "CW", [m], "b")).map(e => {
    const r = val("rev", "std", e, [m], "a"), rb = val("rev", "std", e, [m], "b"), gp = val("gp", "std", e, [m], "a"), ni = val("uni", "std", e, [m], "a"), nib = val("uni", "std", e, [m], "b");
    return `<div class="card divcard" data-e="${e}" style="cursor:pointer"><h4><span>${e}${e === "G2" ? " · Texas Cartage" : e === "CW" ? " · City Warehouse" : ""}</span><span class="chip">${fP(r ? ni / r : null)} net</span></h4>
      <div class="r"><span>Revenue</span><span class="num">${f$(r)} <span class="${deltaCls(r - rb, 1)} small">${r - rb >= 0 ? "+" : ""}${fK(r - rb)}</span></span></div>
      <div class="r"><span>Gross profit</span><span class="num">${f$(gp)} <span class="muted small">${fP(r ? gp / r : null)}</span></span></div>
      <div class="r"><span>Unadjusted NI</span><span class="num">${f$(ni)} <span class="${deltaCls(ni - nib, 1)} small">${ni - nib >= 0 ? "+" : ""}${fK(ni - nib)}</span></span></div></div>`;
  }).join("") || `<div class="muted">No division activity.</div>`;
  $$("#divs .divcard", el).forEach(c => c.addEventListener("click", () => { st.view = "pl"; st.pl.layout = "std"; st.pl.ent = c.dataset.e; st.pl.mode = "month"; st.pl.actM = st.pl.budM = m; render(); }));

  // labor
  const lab = (e, ms2, f) => ["5035", "5040", "5045"].reduce((s, p) => s + accts(pre(p)).reduce((t, a) => t + accVal(a, e, ms2, f), 0), 0);
  const pass = (e, ms2) => ["5035-006", "5045-003"].reduce((s, a) => s + accVal(a, e, ms2, "a"), 0);
  const divs = entsAvailable(y).filter(e => e !== "ALL");
  let lh = `<div class="tscroll" style="max-height:none"><table class="data"><thead><tr><th>${ymLabel(m)}</th>${divs.map(d => `<th class="num">${d}</th>`).join("")}<th class="num">Total</th><th class="num">Budget</th></tr></thead><tbody>`;
  const rowL = (label, f, bud) => `<tr><td>${label}</td>${divs.map(d => `<td class="num">${f$(f(d))}</td>`).join("")}<td class="num"><b>${f$(f("ALL"))}</b></td><td class="num">${bud == null ? "" : f$(bud)}</td></tr>`;
  lh += rowL("Labor we carry", d => lab(d, [m], "a") - pass(d, [m]), lab("ALL", [m], "b"));
  lh += rowL("Labor charged to clients", d => pass(d, [m]), null);
  lh += rowL("Total warehouse labor", d => lab(d, [m], "a"), lab("ALL", [m], "b"));
  const plRev = accVal("4010-005", "ALL", [m], "a"), plExp = pass("ALL", [m]);
  lh += `</tbody></table></div><div class="dstats" style="margin-top:12px"><div><b>${f$(plRev)}</b><span>Passthrough labor billed</span></div><div><b>${fP(plExp ? (plRev - plExp) / plExp : null)}</b><span>Passthrough markup</span></div><div><b class="${deltaCls(lab("ALL", ytd, "a") - lab("ALL", ytd, "b"), -1)}">${fK(lab("ALL", ytd, "a") - lab("ALL", ytd, "b"))}</b><span>YTD labor vs budget</span></div></div>`;
  $("#labor", el).innerHTML = lh;

  // overtime
  const otp = (e, ms2) => { const reg = ["5035-001", "5040-001", "5045-001"].reduce((s, a) => s + accVal(a, e, ms2, "a"), 0), ot = ["5035-002", "5040-002", "5045-002"].reduce((s, a) => s + accVal(a, e, ms2, "a"), 0); return reg ? ot / reg : null; };
  const otEl = $("#ot", el);
  comboChart(otEl, {labels: ms.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), series: [
    ...["G1", "G2"].filter(d => divs.includes(d)).map((d, i) => ({name: d, type: "line", color: i ? "var(--s2)" : "var(--s1)", values: ms.map(x => otp(d, [x]))})),
    {name: "8% norm", type: "dash", color: "var(--budget)", values: ms.map(() => 0.08)}]});
  // fix tooltip formatting for percent chart
  $$("rect[data-i]", otEl).forEach(r => { const i = +r.dataset.i; r.addEventListener("mousemove", e => showTip(e, `<b>${ymLabel(ms[i], true)}</b>` + ["G1", "G2"].filter(d => divs.includes(d)).map(d => `<div class="r"><span>${d}</span><span class="num">${fP(otp(d, [ms[i]]))}</span></div>`).join("") + `<div class="r"><span>Consolidated</span><span class="num">${fP(otp("ALL", [ms[i]]))}</span></div>`)); });

  // freight
  const frt = (e, ms2) => {
    const rev = accts(pre("4020")).reduce((s, a) => s + accVal(a, e, ms2, "a"), 0);
    const exp = accts(pre("5010", "5011", "5012", "5013")).reduce((s, a) => s + accVal(a, e, ms2, "a"), 0);
    const ef = accts(a => /^501[0-3]-00[23]$/.test(a)).reduce((s, a) => s + accVal(a, e, ms2, "a"), 0);
    const inj = accts(a => /^501[0-3]-003$/.test(a)).reduce((s, a) => s + accVal(a, e, ms2, "a"), 0);
    const tadj = ms2.reduce((s, mm) => s + (((cfgx().freightTimingAdj || {})[mm] || {})[e] || 0), 0);
    const adjExp = exp - ef + tadj;
    return {rev, exp, inj, mk: exp ? (rev - exp) / exp : null, amk: adjExp ? (rev - adjExp) / adjExp : null};
  };
  $("#frt", el).innerHTML = `<div class="tscroll" style="max-height:none"><table class="data"><thead><tr><th></th><th class="num">Freight revenue</th><th class="num">Freight cost</th><th class="num">Markup</th><th class="num">Adjusted</th><th class="num">Shipping errors</th></tr></thead><tbody>${
    divs.filter(d => d !== "CW").map(d => [d, frt(d, [m]), frt(d, ytd)]).map(([d, a, b]) => `<tr><td><b>${d}</b> ${ymLabel(m)}</td><td class="num">${f$(a.rev)}</td><td class="num">${f$(a.exp)}</td><td class="num">${fP(a.mk)}</td><td class="num"><b>${fP(a.amk)}</b></td><td class="num">${f$(a.inj)}</td></tr><tr><td class="muted">${d} YTD</td><td class="num muted">${f$(b.rev)}</td><td class="num muted">${f$(b.exp)}</td><td class="num muted">${fP(b.mk)}</td><td class="num muted">${fP(b.amk)}</td><td class="num muted">${f$(b.inj)}</td></tr>`).join("")
  }</tbody></table></div>`;

  // movers
  const sm = salesBy(m, "ALL", st.sales.cm), sp = salesBy(pm, "ALL", st.sales.cm);
  const keys = new Set([...sm.keys(), ...sp.keys()]);
  const mv = [...keys].map(k => ({label: k, v: (sm.get(k) || 0) - (sp.get(k) || 0)})).sort((a, b) => b.v - a.v);
  const ups = mv.filter(x => x.v > 0).slice(0, 5), dns = mv.filter(x => x.v < 0).slice(-5).reverse();
  const hu = hbars(ups.map(x => ({...x, color: "var(--good)"})), {fmt: v => "+" + fK(v), onClick: it => customerDrawer(it.label)}),
        hd = hbars(dns.map(x => ({...x, color: "var(--bad)"})), {fmt: v => fK(v), onClick: it => customerDrawer(it.label)});
  $("#movers", el).innerHTML = `<div class="small muted" style="margin-bottom:6px">Up</div><div class="hbars" id="mvU">${hu.html || '<span class="muted">–</span>'}</div><div class="small muted" style="margin:12px 0 6px">Down</div><div class="hbars" id="mvD">${hd.html || '<span class="muted">–</span>'}</div>`;
  hu.bind($("#mvU", el)); hd.bind($("#mvD", el));

  // capacity
  const cap = cfgx().capacity || {}, poh = (cfgx().palletsOnHand || {})[m];
  $("#cap", el).innerHTML = !poh ? `<div class="muted">No pallet counts entered for ${ymLabel(m, true)}. Add them under <a href="#" id="toAdm">⚙ Inputs</a> (pallet counts aren't in Sage).</div>` :
    `<div class="hbars">${Object.keys(cap).filter(d => (cap[d].rack || 0) + (cap[d].bulk || 0) > 0).map(d => { const c = (cap[d].rack || 0) + (cap[d].bulk || 0), o = ((poh[d] || {}).rack || 0) + ((poh[d] || {}).bulk || 0), p = c ? o / c : 0;
      return `<div class="hbar"><span class="nm">${d} · ${fN(o)} of ${fN(c)}</span><span class="tr"><span style="width:${Math.min(100, p * 100)}%;background:${p > .9 ? "var(--bad)" : p > .8 ? "var(--warn)" : "var(--s1)"}"></span></span><span class="num">${fP(p, 0)}</span></div>`; }).join("")}</div>`;
  const ta = $("#toAdm", el); if (ta) ta.addEventListener("click", e => { e.preventDefault(); st.view = "admin"; render(); });
  arSummary($("#arSum", el));
};

/* ---------------------------------------------------------- P&L */
views.pl = el => {
  const p = st.pl, m = st.rep, y = m.slice(0, 4);
  p.actM ||= m; p.budM ||= m;
  if (p.layout === "soo") p.ent = "ALL";
  const ents = entsAvailable(p.actM.slice(0, 4));
  if (!ents.includes(p.ent)) p.ent = "ALL";
  const T = p.layout, ent = p.ent;
  const mOpts = sel => M.months.filter(x => x <= M.asOf.slice(0, 7)).concat(yearMonths(y).filter(x => !M.months.includes(x))).filter((v, i, a) => a.indexOf(v) === i).sort()
    .map(x => `<option value="${x}" ${x === sel ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  let cols;
  const ytd = monthsThrough(m);
  if (p.mode === "month") cols = [{h: `${ymLabel(p.actM)} Actual`, ms: [p.actM], f: "a", click: true}, {h: `${ymLabel(p.budM)} Budget`, ms: [p.budM], f: "b"}, {h: "Variance", v: [0, 1]}, {h: "Var %", vp: [0, 1]}];
  else if (p.mode === "ytd") cols = [{h: `YTD Actual`, ms: ytd, f: "a", click: true}, {h: `YTD Budget`, ms: ytd, f: "b"}, {h: "Variance", v: [0, 1]}, {h: "Var %", vp: [0, 1]}, {h: `FY ${y} Budget`, ms: yearMonths(y), f: "b", cls: "ytd"}];
  else cols = ytd.map(x => ({h: MN[+x.slice(5) - 1], ms: [x], f: "a", click: true})).concat([{h: "YTD Actual", ms: ytd, f: "a", click: true, cls: "ytd"}, {h: "YTD Budget", ms: ytd, f: "b"}, {h: "Variance", v: [ytd.length, ytd.length + 1]}]);
  const title = `${T === "soo" ? "Statement of Operations" : "Profit & Loss"} · ${ENTS[ent]}`;
  const sub = p.mode === "month" ? `${ymLabel(p.actM, true)} actual vs ${ymLabel(p.budM, true)} budget` : p.mode === "ytd" ? `Year to date through ${ymLabel(m, true)} vs budget` : `Month over month, ${ymLabel(ytd[0], true)} – ${ymLabel(m, true)}, with year-to-date vs budget`;
  el.innerHTML = `<div class="viewhead"><div><h2>${esc(title)}</h2><div class="desc">${esc(sub)}${T === "soo" ? " · Customer Care and Warehouse Manager wages sit in Direct Operating Expense; the rest of office pay is overhead." : ""}</div></div>
    <div class="ctrls">
      <div class="seg" id="lay"><button data-v="soo" aria-pressed="${T === "soo"}">Statement of Operations</button><button data-v="std" aria-pressed="${T === "std"}">Standard P&L</button></div>
      ${T === "std" ? `<div class="seg" id="ent">${ents.map(e => `<button data-v="${e}" aria-pressed="${e === ent}">${ENTS[e]}</button>`).join("")}</div>` : ""}
      <div class="seg" id="mode"><button data-v="month" aria-pressed="${p.mode === "month"}">Month vs Budget</button><button data-v="mom" aria-pressed="${p.mode === "mom"}">Month over Month</button><button data-v="ytd" aria-pressed="${p.mode === "ytd"}">YTD vs Budget</button></div>
      ${p.mode === "month" ? `<label>Actual month<select id="am">${mOpts(p.actM)}</select></label><label>Budget month<select id="bm">${mOpts(p.budM)}</select></label>` : ""}
      <button class="btn" id="exp">Expand all</button><button class="btn" id="col">Collapse all</button>
      <label class="small muted" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="zeros" ${p.zeros ? "checked" : ""}> Show zero rows</label>
      <button class="btn" id="csv">CSV</button><button class="btn" onclick="print()">Print</button>
    </div></div>
    <div class="fs-wrap"><table class="fs" id="fs"></table></div>
    <p class="small muted" style="margin-top:8px">Click a group name to expand it. Click any actual amount to see the journal lines behind it.${T === "soo" ? " The Statement of Operations is consolidated." : ""}</p>`;
  const L = layoutDef(T, ent);
  const data = cols.map(c => c.ms ? computeCol(T, ent, c.ms, c.f) : null);
  const cell = (c, i, id, good, pctRow) => {
    if (c.v) { const a = data[c.v[0]][id] || 0, b = data[c.v[1]][id] || 0; return `<td class="num">${varHtml(a, b, good)}</td>`; }
    if (c.vp) { const a = data[c.vp[0]][id] || 0, b = data[c.vp[1]][id] || 0; return `<td class="num">${varHtml(a, b, good, true)}</td>`; }
    return `<td class="num ${c.cls || ""} ${c.click ? "c" : ""}" data-col="${i}" data-id="${id}">${fN(data[i][id])}</td>`;
  };
  const isZero = id => data.every(d => !d || Math.abs(d[id] || 0) < 0.5);
  let h = `<thead><tr><th>${esc(ENTS[ent])}</th>${cols.map(c => `<th class="${c.cls || ""}">${esc(c.h)}</th>`).join("")}</tr></thead><tbody>`;
  const csv = [["Line", ...cols.map(c => c.h)]];
  const csvRow = (label, id) => csv.push([label, ...cols.map((c, i) => c.ms ? r2(data[i][id] || 0) : c.v ? r2((data[c.v[0]][id] || 0) - (data[c.v[1]][id] || 0)) : "")]);
  for (const it of L) {
    if (it.k === "sec") h += `<tr class="sec"><td colspan="${cols.length + 1}">${esc(it.label)}</td></tr>`;
    else if (it.k === "gap") h += `<tr class="spacer"><td colspan="${cols.length + 1}"></td></tr>`;
    else if (it.k === "grp") {
      if (!p.zeros && isZero(it.id) && it.rows.every(r => isZero(r.id))) continue;
      const open = p.open.has(it.id) || it.rows.length === 1 && false;
      h += `<tr class="grp ${open ? "open" : ""}" data-g="${it.id}"><td>${esc(it.label)}</td>${cols.map((c, i) => cell(c, i, it.id, it.good)).join("")}</tr>`;
      csvRow(it.label, it.id);
      for (const r of it.rows) {
        if (!p.zeros && isZero(r.id)) continue;
        csvRow("   " + r.label, r.id);
        if (!open) continue;
        const nob = r.nb || r.t === "acct";   // budgets compare at the category level, as in the package
        h += `<tr class="acct" data-r="${r.id}" data-g2="${it.id}"><td title="${esc(r.label)}">${esc(r.label)}</td>${cols.map((c, i) => (nob && c.ms && c.f === "b") ? `<td class="num muted">–</td>` : (nob && (c.v || c.vp)) ? `<td class="num"></td>` : cell(c, i, r.id, it.good)).join("")}</tr>`;
      }
    } else if (it.k === "tot") { h += `<tr class="tot ${it.big ? "big" : ""}"><td>${esc(it.label)}</td>${cols.map((c, i) => cell(c, i, it.id, it.good).replace(" c\"", "\"")).join("")}</tr>`; csvRow(it.label, it.id); }
    else if (it.k === "pct") h += `<tr class="pct"><td>${esc(it.label)}</td>${cols.map((c, i) => c.ms ? `<td class="num">${fP(data[i][it.den] ? data[i][it.num] / data[i][it.den] : null)}</td>` : c.v ? `<td class="num">${(() => { const a = data[c.v[0]], b = data[c.v[1]]; const pa = a[it.den] ? a[it.num] / a[it.den] : 0, pb = b[it.den] ? b[it.num] / b[it.den] : 0; return `<span class="${deltaCls(pa - pb, 1)}">${((pa - pb) * 100).toFixed(1)} pts</span>`; })()}</td>` : `<td></td>`).join("")}</tr>`;
  }
  $("#fs", el).innerHTML = h + "</tbody>";
  // interactions
  $$("tr.grp td:first-child", el).forEach(td => td.addEventListener("click", () => { const g = td.parentElement.dataset.g; p.open.has(g) ? p.open.delete(g) : p.open.add(g); views.pl(el); }));
  const findSpec = id => { for (const it of L) { if (it.id === id && it.k === "grp") return {spec: {t: "accts", list: it.rows.filter(r => r.t === "acct").map(r => r.a), virt: it.rows.filter(r => r.t === "v")}, label: it.label}; if (it.k === "grp") for (const r of it.rows) if (r.id === id) return {spec: r, label: r.label}; } return null; };
  $$("td.c", el).forEach(td => td.addEventListener("click", () => {
    const f = findSpec(td.dataset.id); if (!f) return; const c = cols[+td.dataset.col];
    if (f.spec.t === "accts" && f.spec.virt && f.spec.virt.length) { const ls = f.spec.virt.map(v => v); drillGroupVirtual(ls, f.spec.list, ent, c.ms, f.label); return; }
    drill(f.spec, ent, c.ms, f.label);
  }));
  $$("#lay button", el).forEach(b => b.addEventListener("click", () => { p.layout = b.dataset.v; views.pl(el); }));
  $$("#ent button", el).forEach(b => b.addEventListener("click", () => { p.ent = b.dataset.v; views.pl(el); }));
  $$("#mode button", el).forEach(b => b.addEventListener("click", () => { p.mode = b.dataset.v; views.pl(el); }));
  const am = $("#am", el), bm = $("#bm", el);
  if (am) am.addEventListener("change", () => { p.actM = am.value; views.pl(el); });
  if (bm) bm.addEventListener("change", () => { p.budM = bm.value; views.pl(el); });
  $("#exp", el).addEventListener("click", () => { L.filter(i => i.k === "grp").forEach(i => p.open.add(i.id)); views.pl(el); });
  $("#col", el).addEventListener("click", () => { p.open.clear(); views.pl(el); });
  $("#zeros", el).addEventListener("change", e => { p.zeros = e.target.checked; views.pl(el); });
  $("#csv", el).addEventListener("click", () => downloadCsv(csv, `${title} ${sub}.csv`));
};
function drillGroupVirtual(virt, list, ent, ms, label) {
  const set = new Set(list);
  const vset = new Set(virt.flatMap(v => linesFor(v, ent, ms)));
  const ls = M.lines.filter(x => vset.has(x) || (ms.includes(x.m) && (ent === "ALL" || x.l === ent) && set.has(x.a)));
  const tot = virt.reduce((s, v) => s + virtVal(v.k, ms, "a"), 0) + list.reduce((s, a) => s + accVal(a, ent, ms, "a"), 0);
  const per = ms.length === 1 ? ymLabel(ms[0], true) : `${ymLabel(ms[0])} – ${ymLabel(ms.at(-1))}`;
  const parts = virt.map(v => ({label: v.label, v: virtVal(v.k, ms, "a")})).concat(list.map(a => ({label: `${a} - ${M.names[a] || ""}`, v: accVal(a, ent, ms, "a")}))).filter(x => Math.abs(x.v) > 0.5);
  const hb = hbars(parts);
  openDrawer(`${ENTS[ent]} · ${per}`, label, `<div class="dstats"><div><b>${f$(tot)}</b><span>Total ${esc(per)}</span></div></div><div class="panel"><h3>Lines in this group</h3><div class="hbars" style="margin-top:8px">${hb.html}</div></div>${linesTable(ls.sort((a, b) => a.d < b.d ? 1 : -1))}`, drawerRows);
}

/* ---------------------------------------------------------- MONTH COMPARE */
views.compare = el => {
  const c = st.cmp, m = st.rep;
  c.b ||= m; c.a ||= prevM(m);
  if (c.layout === "soo") c.ent = "ALL";
  const T = c.layout, ent = c.ent, ents = entsAvailable(c.b.slice(0, 4));
  const opts = sel => M.months.map(x => `<option value="${x}" ${x === sel ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  el.innerHTML = `<div class="viewhead"><div><h2>${ymLabel(c.a, true)} vs ${ymLabel(c.b, true)} · ${esc(ENTS[ent])}</h2><div class="desc">Pick any two months. The panel on the right explains the biggest changes from the GL detail (customers, vendors and employees behind each line).</div></div>
    <div class="ctrls"><label>First month<select id="ca">${opts(c.a)}</select></label><label>Second month<select id="cb">${opts(c.b)}</select></label>
    <div class="seg" id="clay"><button data-v="soo" aria-pressed="${T === "soo"}">Statement of Operations</button><button data-v="std" aria-pressed="${T === "std"}">Standard P&L</button></div>
    ${T === "std" ? `<div class="seg" id="cent">${ents.map(e => `<button data-v="${e}" aria-pressed="${e === ent}">${ENTS[e]}</button>`).join("")}</div>` : ""}</div></div>
    <div class="grid-wide"><div class="fs-wrap"><table class="fs" id="cfs"></table></div><div class="card panel"><h3>What changed</h3><p class="sub">Ranked by dollar impact on profit</p><ul class="insights" id="cins"></ul></div></div>`;
  const L = layoutDef(T, ent), A = computeCol(T, ent, [c.a], "a"), B = computeCol(T, ent, [c.b], "a");
  let h = `<thead><tr><th>${esc(ENTS[ent])}</th><th>${ymLabel(c.a)}</th><th>${ymLabel(c.b)}</th><th>Change</th><th>Change %</th></tr></thead><tbody>`;
  for (const it of L) {
    if (it.k === "sec") h += `<tr class="sec"><td colspan="5">${esc(it.label)}</td></tr>`;
    else if (it.k === "grp") {
      if (Math.abs(A[it.id] || 0) < .5 && Math.abs(B[it.id] || 0) < .5) continue;
      const open = st.pl.open.has(it.id);
      h += `<tr class="grp ${open ? "open" : ""}" data-g="${it.id}"><td>${esc(it.label)}</td><td class="num">${fN(A[it.id])}</td><td class="num">${fN(B[it.id])}</td><td class="num">${varHtml(B[it.id], A[it.id], it.good)}</td><td class="num">${varHtml(B[it.id], A[it.id], it.good, true)}</td></tr>`;
      if (open) for (const r of it.rows) { if (Math.abs(A[r.id] || 0) < .5 && Math.abs(B[r.id] || 0) < .5) continue;
        h += `<tr class="acct"><td>${esc(r.label)}</td><td class="num c" data-r="${r.id}" data-m="a">${fN(A[r.id])}</td><td class="num c" data-r="${r.id}" data-m="b">${fN(B[r.id])}</td><td class="num">${varHtml(B[r.id], A[r.id], it.good)}</td><td class="num">${varHtml(B[r.id], A[r.id], it.good, true)}</td></tr>`; }
    } else if (it.k === "tot") h += `<tr class="tot ${it.big ? "big" : ""}"><td>${esc(it.label)}</td><td class="num">${fN(A[it.id])}</td><td class="num">${fN(B[it.id])}</td><td class="num">${varHtml(B[it.id], A[it.id], it.good)}</td><td class="num">${varHtml(B[it.id], A[it.id], it.good, true)}</td></tr>`;
    else if (it.k === "pct") h += `<tr class="pct"><td>${esc(it.label)}</td><td class="num">${fP(A[it.den] ? A[it.num] / A[it.den] : null)}</td><td class="num">${fP(B[it.den] ? B[it.num] / B[it.den] : null)}</td><td></td><td></td></tr>`;
  }
  $("#cfs", el).innerHTML = h + "</tbody>";
  const rowById = {}; L.filter(i => i.k === "grp").forEach(g => g.rows.forEach(r => rowById[r.id] = {r, g}));
  $$("tr.grp td:first-child", el).forEach(td => td.addEventListener("click", () => { const g = td.parentElement.dataset.g; st.pl.open.has(g) ? st.pl.open.delete(g) : st.pl.open.add(g); views.compare(el); }));
  $$("td.c", el).forEach(td => td.addEventListener("click", () => { const {r} = rowById[td.dataset.r]; drill(r, ent, [td.dataset.m === "a" ? c.a : c.b], r.label); }));
  // insights
  const pre3 = [1, 2, 3].map(k => addM(c.a, -k));
  const cand = Object.values(rowById).map(({r, g}) => ({r, g, a: A[r.id] || 0, b: B[r.id] || 0})).map(x => ({...x, imp: (x.b - x.a) * x.g.good})).filter(x => Math.abs(x.b - x.a) >= 750)
    .sort((x, y) => Math.abs(y.imp) - Math.abs(x.imp)).slice(0, 10);
  const ins = cand.map(x => {
    const dv = drivers(x.r, ent, [c.a], [c.b]).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 3);
    const hist = new Map(drivers(x.r, ent, pre3).map(d => [d.k, d.a]));
    const nm = x.r.label.replace(/^\d{4}(-\d{3})? - /, ""), d = x.b - x.a;
    const why = dv.filter(v => Math.abs(v.d) >= 100).map(v => {
      const prior = Math.abs(hist.get(v.k) || 0) > 1;
      let tag = "";
      if (Math.abs(v.a) > 1 && Math.abs(v.b) < 1 && !prior) tag = ` — one-time item in ${ymLabel(c.a)}`;
      else if (Math.abs(v.a) < 1 && Math.abs(v.b) > 1 && !prior) tag = ` — new in ${ymLabel(c.b)}`;
      else if (Math.abs(v.b) < 1 && Math.abs(v.a) > 1) tag = ` — nothing in ${ymLabel(c.b)}`;
      return `${v.k}: ${fK(v.a)} → ${fK(v.b)}${tag}`;
    });
    return {good: x.imp > 0, x, html: `<b>${esc(nm)}</b> ${d > 0 ? "up" : "down"} ${fK(Math.abs(d))} (${fK(x.a)} → ${fK(x.b)})<div class="why">${why.length ? esc(why.join(" · ")) : "Spread across many small items."}</div>`};
  });
  const ul = $("#cins", el);
  ul.innerHTML = ins.map((x, i) => `<li class="click" data-i="${i}"><span class="ic ${x.good ? "good" : "bad"}">${x.good ? "▲" : "▼"}</span><div class="tx">${x.html}</div></li>`).join("") || `<li><div class="tx muted">No material changes.</div></li>`;
  $$("li[data-i]", ul).forEach(li => li.addEventListener("click", () => { const x = ins[+li.dataset.i].x; drill(x.r, ent, [c.a, c.b], `${x.r.label} (${ymLabel(c.a)} + ${ymLabel(c.b)})`); }));
  $("#ca", el).addEventListener("change", e => { c.a = e.target.value; views.compare(el); });
  $("#cb", el).addEventListener("change", e => { c.b = e.target.value; views.compare(el); });
  $$("#clay button", el).forEach(b => b.addEventListener("click", () => { c.layout = b.dataset.v; views.compare(el); }));
  $$("#cent button", el).forEach(b => b.addEventListener("click", () => { c.ent = b.dataset.v; views.compare(el); }));
};

/* ---------------------------------------------------------- SALES BY CUSTOMER */
const salesDiv = x => x.div;
let SIX = null;   // div|customer|month -> {i: invoices, c: credit memos}
function salesIdx() {
  if (SIX) return SIX; SIX = new Map();
  for (const x of M.sales) { const k = x.div + "|" + x.c + "|" + x.m; const o = SIX.get(k) || {i: 0, c: 0}; o[x.k === "c" ? "c" : "i"] += x.v; SIX.set(k, o); }
  return SIX;
}
const salesAmt = (div, c, m, cm) => { const o = salesIdx().get(div + "|" + c + "|" + m); return o ? o.i + (cm ? o.c : 0) : 0; };
function salesBy(m, div, cm) {
  const out = new Map();
  for (const x of M.sales) { if (x.m !== m || (!cm && x.k === "c")) continue; const d = salesDiv(x); if (div !== "ALL" && d !== div) continue; out.set(x.c, (out.get(x.c) || 0) + x.v); }
  return out;
}
const normName = s => String(s || "").toLowerCase().replace(/\s+-\s+(exited|exiting|moved to g2|g2|city warehouse)\b.*$/, "").replace(/\(new\)/g, "").replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter(w => w && !["inc", "llc", "corp", "corporation", "co", "company", "the", "ltd", "lp", "usa", "us", "na", "of"].includes(w)).join(" ");
function budgetMatch(div, sageNames) {
  const aliases = cfgx().customerAliases || {};
  const buds = (M.cfg.salesBudget || []).filter(b => b.div === div);
  const map = new Map(); // budget name -> sage name
  const nn = sageNames.map(n => [n, normName(n)]);
  for (const b of buds) {   // pass 1: alias or exact name
    if (b.growth) continue;
    if (aliases[b.name] && sageNames.includes(aliases[b.name])) map.set(b.name, aliases[b.name]);
    else if (sageNames.includes(b.name)) map.set(b.name, b.name);
  }
  const claimed = new Set(map.values());
  for (const b of buds) {   // pass 2: normalized / prefix / unique first word
    if (b.growth || map.has(b.name)) continue;
    const bn = normName(b.name);
    const free = nn.filter(([n]) => !claimed.has(n) || /city warehouse|- g2/i.test(b.name));
    let hit = free.find(([, s]) => s === bn) || free.find(([, s]) => bn.length >= 4 && s.length >= 4 && (s.startsWith(bn) || bn.startsWith(s)));
    if (!hit) { const f = bn.split(" ")[0]; const c = free.filter(([, s]) => s.split(" ")[0] === f); if (f.length >= 5 && c.length === 1) hit = c[0]; }
    if (hit) map.set(b.name, hit[0]);
  }
  return {buds, map};
}
views.sales = el => {
  const sv = st.sales, m = st.rep, y = m.slice(0, 4), ym = monthsThrough(m), mi = +m.slice(5) - 1;
  const divs = sv.div === "ALL" ? ["G1", "G2"] : [sv.div];
  const rows = [];
  for (const dv of divs) {
    const names = [...new Set(M.sales.filter(x => x.m.startsWith(y) && salesDiv(x) === dv).map(x => x.c))];
    const {buds, map} = budgetMatch(dv, names);
    const fy = +y === +(M.cfg.fyStart || "2026").slice(0, 4);
    const used = new Set(map.values());
    const act = nm => ym.map(mm => salesAmt(dv, nm, mm, sv.cm));
    const byKey = new Map();   // several budget lines can belong to one Sage customer (e.g. HIH at G2 and City Warehouse)
    for (const b of buds) {
      const sn = map.get(b.name), key = sn || "budget:" + b.name;
      const bb = fy ? ym.map((_, i) => b.bud[i] || 0) : ym.map(() => 0);
      const o = byKey.get(key);
      if (o) { o.bud = o.bud.map((v, i) => v + bb[i]); o.bnames.push(b.name); continue; }
      const r = {div: dv, name: sn || b.name, bname: b.name, bnames: [b.name], sec: b.growth ? "growth" : (b.spec ? "spec" : "core"), act: sn ? act(sn) : ym.map(() => 0), bud: bb, matched: !!sn || b.growth};
      byKey.set(key, r); rows.push(r);
    }
    for (const nm of names) if (!used.has(nm)) rows.push({div: dv, name: nm, sec: "new", act: act(nm), bud: ym.map(() => 0), matched: true});
  }
  rows.forEach(r => { r.m = r.act[mi] || 0; r.mb = r.bud[mi] || 0; r.ya = r.act.reduce((a, b) => a + b, 0); r.yb = r.bud.reduce((a, b) => a + b, 0); });
  const q = sv.q.toLowerCase();
  const vis = rows.filter(r => (!q || r.name.toLowerCase().includes(q)) && (Math.abs(r.ya) + Math.abs(r.yb) > 0.5));
  const SECS = [["core", "Budgeted customers"], ["spec", "Identified spec & growth customers"], ["new", "New / unbudgeted customers"], ["growth", "Unidentified growth target"]];
  const tot = rs => ({m: rs.reduce((s, r) => s + r.m, 0), mb: rs.reduce((s, r) => s + r.mb, 0), ya: rs.reduce((s, r) => s + r.ya, 0), yb: rs.reduce((s, r) => s + r.yb, 0), act: ym.map((_, i) => rs.reduce((s, r) => s + (r.act[i] || 0), 0))});
  const T = tot(vis);
  const unmatched = rows.filter(r => !r.matched && r.yb > 0);
  el.innerHTML = `<div class="viewhead"><div><h2>Sales by Customer · ${sv.div === "ALL" ? "G1 + G2" : sv.div} · ${sv.mode === "month" ? ymLabel(m, true) + " vs budget" : "Month over month, " + y}</h2>
    <div class="desc">Invoiced sales by invoice date from Sage AR${sv.cm ? ", net of credit memos" : ""}. Sales won't tie to P&L revenue because recurring storage is deferred. City Warehouse customers roll into their home division.</div></div>
    <div class="ctrls"><div class="seg" id="sdiv">${["ALL", "G1", "G2"].map(d => `<button data-v="${d}" aria-pressed="${d === sv.div}">${d === "ALL" ? "All" : d}</button>`).join("")}</div>
    <div class="seg" id="smode"><button data-v="month" aria-pressed="${sv.mode === "month"}">Month vs Budget</button><button data-v="mom" aria-pressed="${sv.mode === "mom"}">Month over Month</button></div>
    <label class="small muted" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="scm" ${sv.cm ? "checked" : ""}> Net of credit memos</label>
    <input class="search" id="sq" placeholder="Find a customer" value="${esc(sv.q)}"><button class="btn" id="scsv">CSV</button></div></div>
    ${unmatched.length ? `<div class="banner">${unmatched.length} budgeted customer name(s) didn't match a Sage customer: ${esc(unmatched.slice(0, 6).map(r => r.bname).join(", "))}${unmatched.length > 6 ? "…" : ""}. Match them under ⚙ Inputs.</div>` : ""}
    <div class="kpis">
      <div class="card"><div class="small muted">${ymLabel(m, true)} sales</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${f$(T.m)}</div><div class="small">Budget ${f$(T.mb)} · <span class="${deltaCls(T.m - T.mb, 1)}">${T.m - T.mb >= 0 ? "+" : ""}${f$(T.m - T.mb)}</span></div></div>
      <div class="card"><div class="small muted">YTD sales</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${f$(T.ya)}</div><div class="small">Budget ${f$(T.yb)} · <span class="${deltaCls(T.ya - T.yb, 1)}">${T.ya - T.yb >= 0 ? "+" : ""}${f$(T.ya - T.yb)}</span></div></div>
      <div class="card"><div class="small muted">Customers invoiced in ${ymLabel(m)}</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${vis.filter(r => Math.abs(r.m) > 0.5).length}</div><div class="small">${vis.filter(r => r.sec === "new" && Math.abs(r.m) > 0.5).length} not in the budget</div></div>
      <div class="card"><div class="small muted">Top 10 share of ${ymLabel(m)}</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${fP(T.m ? [...vis].sort((a, b) => b.m - a.m).slice(0, 10).reduce((s, r) => s + r.m, 0) / T.m : null, 0)}</div><div class="small">concentration</div></div>
    </div>
    <div class="card panel"><div id="schart"></div></div>
    <div class="tscroll"><table class="data" id="stbl"></table></div>`;
  comboChart($("#schart", el), {labels: ym.map(x => MN[+x.slice(5) - 1]), series: [
    {name: "Invoiced sales", type: "bar", color: "var(--s1)", values: T.act},
    {name: "Budget", type: "dash", color: "var(--budget)", values: ym.map((_, i) => vis.reduce((s, r) => s + (r.bud[i] || 0), 0))}], height: 200});
  let h, csv;
  if (sv.mode === "month") {
    h = `<thead><tr><th>Customer</th><th>Div</th><th class="num">${ymLabel(m)} actual</th><th class="num">${ymLabel(m)} budget</th><th class="num">Variance</th><th class="num">Var %</th><th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">YTD var</th></tr></thead><tbody>`;
    csv = [["Customer", "Division", "Section", "Month actual", "Month budget", "Variance", "YTD actual", "YTD budget", "YTD variance"]];
    for (const [k, lab] of SECS) { const rs = vis.filter(r => r.sec === k).sort((a, b) => b.m - a.m || b.ya - a.ya); if (!rs.length) continue;
      const t = tot(rs);
      h += `<tr class="subhead"><td colspan="9">${lab}</td></tr>` + rs.map(r => `<tr class="click" data-n="${esc(r.name)}"><td>${esc(r.name)}${r.matched ? "" : ' <span class="chip warn">not matched</span>'}</td><td><span class="chip">${r.div}</span></td><td class="num">${f$(r.m)}</td><td class="num">${f$(r.mb)}</td><td class="num">${varHtml(r.m, r.mb, 1)}</td><td class="num">${r.mb ? varHtml(r.m, r.mb, 1, true) : ""}</td><td class="num">${f$(r.ya)}</td><td class="num">${f$(r.yb)}</td><td class="num">${varHtml(r.ya, r.yb, 1)}</td></tr>`).join("")
        + `<tr class="tot"><td colspan="2">Total ${lab.toLowerCase()}</td><td class="num">${f$(t.m)}</td><td class="num">${f$(t.mb)}</td><td class="num">${varHtml(t.m, t.mb, 1)}</td><td class="num">${varHtml(t.m, t.mb, 1, true)}</td><td class="num">${f$(t.ya)}</td><td class="num">${f$(t.yb)}</td><td class="num">${varHtml(t.ya, t.yb, 1)}</td></tr>`;
      rs.forEach(r => csv.push([r.name, r.div, lab, r2(r.m), r2(r.mb), r2(r.m - r.mb), r2(r.ya), r2(r.yb), r2(r.ya - r.yb)])); }
    h += `<tr class="tot"><td colspan="2">TOTAL SALES</td><td class="num">${f$(T.m)}</td><td class="num">${f$(T.mb)}</td><td class="num">${varHtml(T.m, T.mb, 1)}</td><td class="num">${varHtml(T.m, T.mb, 1, true)}</td><td class="num">${f$(T.ya)}</td><td class="num">${f$(T.yb)}</td><td class="num">${varHtml(T.ya, T.yb, 1)}</td></tr>`;
  } else {
    const rs = [...vis].sort((a, b) => b.ya - a.ya);
    h = `<thead><tr><th>Customer</th><th>Div</th>${ym.map(x => `<th class="num">${MN[+x.slice(5) - 1]}</th>`).join("")}<th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">Variance</th></tr></thead><tbody>`
      + rs.map(r => `<tr class="click" data-n="${esc(r.name)}"><td>${esc(r.name)}</td><td><span class="chip">${r.div}</span></td>${r.act.map(v => `<td class="num">${v ? fN(v) : '<span class="muted">–</span>'}</td>`).join("")}<td class="num"><b>${f$(r.ya)}</b></td><td class="num">${f$(r.yb)}</td><td class="num">${varHtml(r.ya, r.yb, 1)}</td></tr>`).join("")
      + `<tr class="tot"><td colspan="2">TOTAL SALES</td>${T.act.map(v => `<td class="num">${fN(v)}</td>`).join("")}<td class="num">${f$(T.ya)}</td><td class="num">${f$(T.yb)}</td><td class="num">${varHtml(T.ya, T.yb, 1)}</td></tr>`;
    csv = [["Customer", "Division", ...ym, "YTD actual", "YTD budget", "Variance"], ...rs.map(r => [r.name, r.div, ...r.act.map(r2), r2(r.ya), r2(r.yb), r2(r.ya - r.yb)])];
  }
  $("#stbl", el).innerHTML = h + "</tbody>";
  $$("#stbl tr[data-n]", el).forEach(tr => tr.addEventListener("click", () => { const r = rows.find(x => x.name === tr.dataset.n); customerDrawer(tr.dataset.n, r); }));
  $$("#sdiv button", el).forEach(b => b.addEventListener("click", () => { sv.div = b.dataset.v; views.sales(el); }));
  $$("#smode button", el).forEach(b => b.addEventListener("click", () => { sv.mode = b.dataset.v; views.sales(el); }));
  $("#scm", el).addEventListener("change", e => { sv.cm = e.target.checked; views.sales(el); });
  let t; $("#sq", el).addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { sv.q = e.target.value; views.sales(el); const s = $("#sq", el); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); });
  $("#scsv", el).addEventListener("click", () => downloadCsv(csv, `Sales by customer ${sv.div} ${m}.csv`));
};
function customerDrawer(name, row) {
  const y = st.rep.slice(0, 4), ym = yearMonths(y);
  const inv = M.sales.filter(x => x.c === name && x.m.startsWith(y)).sort((a, b) => a.d < b.d ? 1 : -1);
  const byM = ym.map(mm => inv.filter(x => x.m === mm).reduce((s, x) => s + x.v, 0));
  const glr = M.lines.filter(x => x.c === name && x.m.startsWith(y) && x.a.startsWith("4"));
  const byAcct = {}; glr.forEach(x => byAcct[x.a] = (byAcct[x.a] || 0) + natural(x.a, x.v));
  const hb = hbars(Object.entries(byAcct).sort((a, b) => b[1] - a[1]).map(([a, v]) => ({label: `${a} ${M.names[a] || ""}`, v})));
  drawerRows = inv.map(x => ({Date: x.d, Document: x.doc, Division: x.l, Type: x.k === "c" ? "Credit memo" : "Invoice", Amount: x.v}));
  openDrawer(`Customer · ${y}`, name, `<div class="dstats"><div><b>${f$(byM.reduce((a, b) => a + b, 0))}</b><span>${y} invoiced</span></div>${row ? `<div><b>${f$(row.yb)}</b><span>YTD budget</span></div>` : ""}<div><b>${inv.length}</b><span>documents</span></div></div>
    <div class="panel"><div id="cch"></div></div>${glr.length ? `<div class="panel"><h3>Revenue recognized by account (GL)</h3><div class="hbars" style="margin-top:8px">${hb.html}</div></div>` : ""}
    <div class="tscroll" style="max-height:none"><table class="lines"><thead><tr><th>Date</th><th>Document</th><th>Div</th><th>Type</th><th class="num">Amount</th></tr></thead><tbody>${inv.map(x => `<tr><td>${x.d}</td><td>${esc(x.doc)}</td><td>${x.l}</td><td>${x.k === "c" ? "Credit memo" : "Invoice"}</td><td class="num">${f$(x.v, 2)}</td></tr>`).join("")}</tbody></table></div>`, drawerRows);
  const ser = [{name: "Invoiced", type: "bar", color: "var(--s1)", values: byM}];
  if (row && row.bud.some(Boolean)) ser.push({name: "Budget", type: "dash", color: "var(--budget)", values: ym.map((_, i) => (M.cfg.salesBudget || []).filter(b => row.bnames.includes(b.name) && b.div === row.div).reduce((s, b) => s + (b.bud[i] || 0), 0))});
  comboChart($("#cch"), {labels: ym.map(x => MN[+x.slice(5) - 1]), series: ser, height: 190});
}

/* ---------------------------------------------------------- MOVE */
function moveLines() {
  const man = cfgx().moveManual || {};
  return M.mv.map(x => { const o = {...x}; if (man[x.key]) { o.cat = man[x.key]; o.how = "manual"; } return o; })
    .filter(x => x.cat !== "__not_move__" && (x.a.startsWith("6120") || (x.cat && x.how !== "none")));
}
views.move = el => {
  const m = st.rep, ml = moveLines().filter(x => x.m <= m), cfg = M.cfg;
  const budget = (cfg.moveBudget || []).map(b => ({...b}));
  const cats = new Map(budget.map(b => [b.cat, {...b, op: 0, cx: 0, n: 0}]));
  for (const x of ml) { const c = x.cat || "Unclassified"; if (!cats.has(c)) cats.set(c, {cat: c, group: "OpEx", budget: 0, op: 0, cx: 0, n: 0}); const o = cats.get(c); x.a.startsWith("2100") ? o.cx += x.v : o.op += x.v; o.n++; }
  const all = [...cats.values()], tb = all.reduce((s, c) => s + c.budget, 0), top = all.reduce((s, c) => s + c.op, 0), tcx = all.reduce((s, c) => s + c.cx, 0);
  const plMonth = natural("6120-000", actRaw("6120-000", "ALL", [m]));
  const review = M.mv.filter(x => !(cfgx().moveManual || {})[x.key] && (x.how === "none" || x.how === "vendor")).length;
  const start = (cfg.moveStart || "2026-06"), months = []; for (let k = start; k <= m; k = addM(k, 1)) months.push(k);
  el.innerHTML = `<div class="viewhead"><div><h2>G3 Move · actual vs budget through ${ymLabel(m, true)}</h2><div class="desc">Operating move costs come from GL 6120-000 (consolidated only). Capitalized costs come from fixed-asset additions in the 2100 group. Categories follow the move budget.</div></div>
    <div class="ctrls"><button class="btn" id="mvcsv">CSV</button></div></div>
    ${review ? `<div class="banner">${review} move line(s) were classified automatically by vendor or need a category. Review them under <a href="#" id="toAdm2">⚙ Inputs</a>.</div>` : ""}
    <div class="kpis">
      <div class="card"><div class="small muted">Total move spend to date</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${f$(top + tcx)}</div><div class="meter" style="margin:8px 0"><span class="${top + tcx > tb ? "over" : ""}" style="width:${Math.min(100, tb ? (top + tcx) / tb * 100 : 0)}%"></span></div><div class="small">${fP(tb ? (top + tcx) / tb : null, 0)} of the ${f$(tb)} budget · ${f$(tb - top - tcx)} left</div></div>
      <div class="card"><div class="small muted">Expensed on the P&L (6120)</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${f$(top)}</div><div class="small">${ymLabel(m)}: ${f$(plMonth)}</div></div>
      <div class="card"><div class="small muted">Capitalized (fixed assets)</div><div style="font-size:24px;font-weight:700;color:var(--navy)">${f$(tcx)}</div><div class="small">Balance sheet, 2100 group</div></div>
    </div>
    <div class="card panel"><h3>Monthly move spend</h3><div id="mvch"></div></div>
    <div class="tscroll"><table class="data" id="mvt"></table></div>`;
  comboChart($("#mvch", el), {labels: months.map(x => ymLabel(x)), stacked: true, series: [
    {name: "Expensed (P&L)", type: "bar", color: "var(--s2)", values: months.map(mm => ml.filter(x => x.m === mm && !x.a.startsWith("2100")).reduce((s, x) => s + x.v, 0))},
    {name: "Capitalized", type: "bar", color: "var(--s1)", values: months.map(mm => ml.filter(x => x.m === mm && x.a.startsWith("2100")).reduce((s, x) => s + x.v, 0))}], height: 210});
  let h = `<thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Expensed</th><th class="num">Capitalized</th><th class="num">Total spent</th><th class="num">Remaining</th><th style="min-width:140px">Used</th></tr></thead><tbody>`;
  const csv = [["Group", "Category", "Budget", "Expensed", "Capitalized", "Total", "Remaining"]];
  for (const [g, lab] of [["CapEx", "Capital expense budget"], ["OpEx", "Operating expense budget"]]) {
    const rs = all.filter(c => c.group === g); if (!rs.length) continue;
    const s = k => rs.reduce((t, c) => t + c[k], 0);
    h += `<tr class="subhead"><td colspan="7">${lab}</td></tr>` + rs.map(c => { const t = c.op + c.cx, p = c.budget ? t / c.budget : (t ? 1.01 : 0);
      csv.push([g, c.cat, r2(c.budget), r2(c.op), r2(c.cx), r2(t), r2(c.budget - t)]);
      return `<tr class="click" data-c="${esc(c.cat)}"><td>${esc(c.cat)}${c.cat === "Unclassified" ? ' <span class="chip warn">review</span>' : ""}</td><td class="num">${f$(c.budget)}</td><td class="num">${f$(c.op)}</td><td class="num">${f$(c.cx)}</td><td class="num"><b>${f$(t)}</b></td><td class="num ${c.budget - t < 0 ? "neg" : ""}">${f$(c.budget - t)}</td><td><div class="meter"><span class="${p > 1 ? "over" : ""}" style="width:${Math.min(100, p * 100)}%"></span></div></td></tr>`; }).join("")
      + `<tr class="tot"><td>Total ${g === "CapEx" ? "capital" : "operating"}</td><td class="num">${f$(s("budget"))}</td><td class="num">${f$(s("op"))}</td><td class="num">${f$(s("cx"))}</td><td class="num">${f$(s("op") + s("cx"))}</td><td class="num">${f$(s("budget") - s("op") - s("cx"))}</td><td></td></tr>`;
  }
  h += `<tr class="tot"><td>TOTAL MOVE</td><td class="num">${f$(tb)}</td><td class="num">${f$(top)}</td><td class="num">${f$(tcx)}</td><td class="num">${f$(top + tcx)}</td><td class="num">${f$(tb - top - tcx)}</td><td></td></tr>`;
  $("#mvt", el).innerHTML = h + "</tbody>";
  $$("#mvt tr[data-c]", el).forEach(tr => tr.addEventListener("click", () => {
    const c = tr.dataset.c, ls = ml.filter(x => (x.cat || "Unclassified") === c).sort((a, b) => a.d < b.d ? 1 : -1);
    drawerRows = ls.map(x => ({Date: x.d, Account: x.a, Division: x.l, Vendor: x.vn, Employee: x.e ? empName(x.e) : "", Memo: x.memo, How: x.how, Amount: x.v}));
    openDrawer("G3 Move", c, `<div class="dstats"><div><b>${f$(ls.reduce((s, x) => s + x.v, 0))}</b><span>Spent to date</span></div><div><b>${ls.length}</b><span>lines</span></div></div><div class="tscroll" style="max-height:none"><table class="lines"><thead><tr><th>Date</th><th>Type</th><th>Vendor / employee</th><th>Memo</th><th>Classified by</th><th class="num">Amount</th><th></th></tr></thead><tbody>${
      ls.map(x => `<tr><td>${x.d}</td><td>${x.a.startsWith("2100") ? "CapEx" : "P&L"}</td><td>${esc(x.vn || (x.e ? empName(x.e) : ""))}</td><td class="memo">${esc(x.memo)}</td><td>${{match: "Detail list", vendor: "Vendor (auto)", manual: "You", none: "–"}[x.how] || x.how}</td><td class="num">${f$(x.v, 2)}</td><td>${x.u ? `<a href="${sageUrl(x.u)}" target="_blank" rel="noopener">↗</a>` : ""}</td></tr>`).join("")}</tbody></table></div>`, drawerRows);
  }));
  const ta = $("#toAdm2", el); if (ta) ta.addEventListener("click", e => { e.preventDefault(); st.view = "admin"; render(); });
  $("#mvcsv", el).addEventListener("click", () => downloadCsv(csv, "G3 move vs budget.csv"));
};

/* ---------------------------------------------------------- AR */
const arBase = () => (M.cfg.arDashboard || "../gfs-ar-aging/").replace(/\/?$/, "/");
views.ar = el => {
  el.innerHTML = `<div class="viewhead"><div><h2>Accounts Receivable</h2><div class="desc">This is the live AR Aging Dashboard, shown here unchanged. It uses its own passphrase; once unlocked in this tab it stays unlocked while the tab is open.</div></div>
    <div class="ctrls"><a class="btn" href="${arBase()}" target="_blank" rel="noopener">Open in a new tab ↗</a></div></div>
    <iframe class="ar" src="${arBase()}" title="AR Aging Dashboard"></iframe>`;
};
async function arSummary(box) {
  const pw = store.get(AR_PW_KEY, true) || store.get(AR_PW_KEY);
  const ask = msg => { box.innerHTML = `<div class="muted small" style="margin-bottom:8px">${msg}</div><form id="arf" style="display:flex;gap:8px"><input class="field" type="password" id="arpw" placeholder="AR dashboard passphrase" style="max-width:260px"><button class="btn primary">Show</button></form>`;
    $("#arf", box).addEventListener("submit", e => { e.preventDefault(); store.set(AR_PW_KEY, $("#arpw", box).value, true); arSummary(box); }); };
  if (!pw) return ask("Enter the AR dashboard passphrase once to show AR here (it also unlocks the AR tab).");
  try {
    const env = await (await fetch(arBase() + "data.enc.json?t=" + Date.now(), {cache: "no-store"})).json();
    const ar = await decryptEnv(env, pw);
    const asOf = new Date(ar.asOf + "T00:00:00"), b = [0, 0, 0, 0, 0], over = new Map();
    for (const it of ar.items) { const dd = Math.floor((asOf - new Date(it.due + "T00:00:00")) / 864e5); const k = dd <= 0 ? 0 : dd <= 30 ? 1 : dd <= 60 ? 2 : dd <= 90 ? 3 : 4; b[k] += it.bal;
      if (k === 4) over.set(it.c, (over.get(it.c) || 0) + it.bal); }
    const tot = b.reduce((s, v) => s + v, 0), lab = ["Current", "1–30", "31–60", "61–90", "Over 90"], col = ["var(--s3)", "var(--s1)", "var(--s4)", "var(--s2)", "var(--bad)"];
    const top = [...over.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5);
    box.innerHTML = `<div class="dstats"><div><b>${f$(tot)}</b><span>Total AR · as of ${esc(ar.asOf)}</span></div><div><b>${fP(tot ? b[4] / tot : null)}</b><span>over 90 days</span></div></div>
      <div class="hbars">${lab.map((l, i) => `<div class="hbar"><span class="nm">${l}</span><span class="tr"><span style="width:${tot ? Math.max(0, b[i]) / tot * 100 : 0}%;background:${col[i]}"></span></span><span class="num">${f$(b[i])}</span></div>`).join("")}</div>
      ${top.length ? `<div class="small muted" style="margin:12px 0 6px">Largest over-90 balances</div><div class="hbars">${top.map(([c, v]) => `<div class="hbar"><span class="nm">${esc((ar.customers[c] || {}).n || c)}</span><span class="tr"><span style="width:${v / top[0][1] * 100}%;background:var(--bad)"></span></span><span class="num">${f$(v)}</span></div>`).join("")}</div>` : ""}
      <p class="small"><a href="#" id="toAr">Open the AR tab →</a></p>`;
    $("#toAr", box).addEventListener("click", e => { e.preventDefault(); st.view = "ar"; render(); });
  } catch { store.del(AR_PW_KEY); ask("Couldn't unlock the AR data with the saved passphrase."); }
}

/* ---------------------------------------------------------- ADMIN / INPUTS */
views.admin = el => {
  const m = st.rep, cfg = cfgx(), e = st.edits;
  const cats = (M.cfg.moveBudget || []).map(b => b.cat);
  const man = cfg.moveManual || {};
  const q = M.mv.filter(x => x.how === "none" || x.how === "vendor" || (e.moveManual || {})[x.key]).sort((a, b) => a.d < b.d ? 1 : -1);
  const caps = cfg.capacity || {}, poh = (cfg.palletsOnHand || {})[m] || {};
  const pyM = addM(m, -12), py = (cfg.priorYear || {})[pyM] || {};
  const unmatched = [];
  for (const dv of ["G1", "G2"]) { const names = [...new Set(M.sales.filter(x => salesDiv(x) === dv).map(x => x.c))].sort(); const {buds, map} = budgetMatch(dv, names);
    buds.filter(b => !b.growth && !map.has(b.name) && b.bud.some(Boolean)).forEach(b => unmatched.push({b, dv, names})); }
  const dirty = Object.keys(e).some(k => Object.keys(e[k] || {}).length);
  el.innerHTML = `<div class="viewhead"><div><h2>Inputs & classification</h2><div class="desc">The few things Sage doesn't know. Changes apply on this device right away; to share them, download the updated config file and upload it to the repo.</div></div></div>
    ${dirty ? `<div class="banner info">You have unsaved changes on this device. Download config.enc.json below, upload it to GitHub, then run the refresh workflow.</div>` : ""}
    <div class="card panel adm"><h3>G3 Move lines to review (${q.length})</h3><p class="sub">Lines on 6120 that weren't on the move detail list, plus fixed-asset additions in the 2100 group. Pick a budget category, or mark a fixed asset as not part of the move.</p>
      ${q.length ? `<div class="tscroll" style="max-height:420px"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Vendor / memo</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>${q.map(x => `<tr><td>${x.d}</td><td>${x.a.startsWith("2100") ? "CapEx " + x.a : "P&L"}</td><td>${esc(x.vn)}<div class="small muted">${esc(x.memo)}</div></td><td class="num">${f$(x.v, 2)}</td><td><select data-k="${esc(x.key)}"><option value="">${x.how === "vendor" ? "Auto: " + esc(x.cat) : x.a.startsWith("2100") ? "Not reviewed (excluded)" : "Unclassified"}</option>${cats.map(c => `<option ${man[x.key] === c ? "selected" : ""}>${esc(c)}</option>`).join("")}${x.a.startsWith("2100") ? `<option value="__not_move__" ${man[x.key] === "__not_move__" ? "selected" : ""}>Not a move cost</option>` : ""}</select></td></tr>`).join("")}</tbody></table></div>` : `<div class="muted">Nothing to review.</div>`}</div>
    <div class="grid2">
      <div class="card panel adm"><h3>Capacity · ${ymLabel(m, true)}</h3><p class="sub">End-of-month pallets on hand and total pallet capacity by building</p>
        <table class="data"><thead><tr><th>Building</th><th>Rack on hand</th><th>Bulk on hand</th><th>Rack capacity</th><th>Bulk capacity</th></tr></thead><tbody>${["G1", "G2", "CW", "G3"].map(d => `<tr><td>${d}</td><td><input type="number" data-p="${d}.rack" value="${(poh[d] || {}).rack ?? ""}"></td><td><input type="number" data-p="${d}.bulk" value="${(poh[d] || {}).bulk ?? ""}"></td><td><input type="number" data-c="${d}.rack" value="${(caps[d] || {}).rack ?? ""}"></td><td><input type="number" data-c="${d}.bulk" value="${(caps[d] || {}).bulk ?? ""}"></td></tr>`).join("")}</tbody></table></div>
      <div class="card panel adm"><h3>Prior year · ${ymLabel(pyM, true)}</h3><p class="sub">Before the Sage conversion, prior-year months aren't in Sage. From ${+m.slice(0, 4) + 1} on, the prior year comes from Sage.</p>
        <table class="data"><tbody>${[["revenue", "Revenue"], ["grossProfit", "Gross profit"], ["unadjustedNI", "Unadjusted net income"]].map(([k, l]) => `<tr><td>${l}</td><td><input type="number" data-py="${k}" value="${py[k] ?? ""}"></td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="card panel adm"><h3>Budget customer names (${unmatched.length} unmatched)</h3><p class="sub">Budget names come from the Excel package. Most match a Sage customer automatically; pick the Sage customer for the rest.</p>
      ${unmatched.length ? `<table class="data"><tbody>${unmatched.map(u => `<tr><td><span class="chip">${u.dv}</span> ${esc(u.b.name)}</td><td><select data-al="${esc(u.b.name)}"><option value="">– choose Sage customer –</option>${u.names.map(n => `<option>${esc(n)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>` : `<div class="muted">All budget customers are matched.</div>`}</div>
    <div class="card panel adm"><h3>Save for everyone</h3><p class="sub">Paste the CONFIG_KEY (the same value saved as a GitHub secret). It never leaves this browser.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="password" id="ck" placeholder="CONFIG_KEY" style="width:320px"><button class="btn primary" id="dl">Download config.enc.json</button><button class="btn" id="clr">Discard local changes</button></div>
      <ol class="small muted"><li>Download the file.</li><li>In the GitHub repo, choose Add file → Upload files and upload it (it replaces the old one).</li><li>Actions → Refresh financials dashboard → Run workflow.</li></ol><div class="err" id="ckErr"></div></div>`;
  $$("select[data-k]", el).forEach(s => s.addEventListener("change", () => { (e.moveManual ||= {}); if (s.value) e.moveManual[s.dataset.k] = s.value; else delete e.moveManual[s.dataset.k]; saveEdits(); }));
  $$("input[data-p]", el).forEach(i => i.addEventListener("change", () => { const [d, k] = i.dataset.p.split("."); const cur = JSON.parse(JSON.stringify(((cfgx().palletsOnHand || {})[m]) || {})); (cur[d] ||= {})[k] = i.value === "" ? null : +i.value; (e.palletsOnHand ||= {})[m] = cur; saveEdits(); }));
  $$("input[data-c]", el).forEach(i => i.addEventListener("change", () => { const [d, k] = i.dataset.c.split("."); const cur = JSON.parse(JSON.stringify(cfgx().capacity || {})); (cur[d] ||= {})[k] = +i.value || 0; e.capacity = cur; saveEdits(); }));
  $$("input[data-py]", el).forEach(i => i.addEventListener("change", () => { const cur = Object.assign({}, (cfgx().priorYear || {})[pyM]); cur[i.dataset.py] = i.value === "" ? null : +i.value; (e.priorYear ||= {})[pyM] = cur; saveEdits(); }));
  $$("select[data-al]", el).forEach(s => s.addEventListener("change", () => { (e.customerAliases ||= {})[s.dataset.al] = s.value; saveEdits(); }));
  $("#clr", el).addEventListener("click", () => { st.edits = {}; saveEdits(); views.admin(el); });
  $("#dl", el).addEventListener("click", async () => {
    $("#ckErr", el).textContent = "";
    try {
      const k = $("#ck", el).value.trim(); const raw = Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - k.length % 4) % 4)), c => c.charCodeAt(0));
      if (raw.length !== 32) throw new Error("key");
      const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
      const merged = Object.assign({}, M.cfg, mergedEdits()); const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(merged))));
      const enc = u => btoa(String.fromCharCode(...u));
      let s = ""; for (let i = 0; i < ct.length; i += 32768) s += String.fromCharCode(...ct.subarray(i, i + 32768));
      const blob = new Blob([JSON.stringify({v: 1, iv: enc(iv), ct: btoa(s)})], {type: "application/json"});
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "config.enc.json"; a.click();
    } catch { $("#ckErr", el).textContent = "That doesn't look like the CONFIG_KEY (it's a 43-character code)."; }
  });
};

/* ---------------------------------------------------------- misc */
function downloadCsv(rows, name) {
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map(r => r.map(q).join(",")).join("\n")], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]/g, "-"); a.click();
}
function defaultRep() {
  const a = M.asOf.slice(0, 7), d = +M.asOf.slice(8, 10);
  let m = d < 20 ? addM(a, -1) : a;
  if (!M.months.includes(m)) m = M.months.filter(x => x <= a).at(-1) || a;
  return m;
}
function start(snap) {
  D = snap; M = buildModel(snap);
  st.rep = defaultRep();
  $("#lock").classList.add("hidden"); $("#app").classList.remove("hidden");
  const opts = M.months.filter(x => x <= M.asOf.slice(0, 7));
  $("#repMonth").innerHTML = opts.map(x => `<option value="${x}" ${x === st.rep ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  const gen = new Date(snap.generatedAt);
  $("#liveText").textContent = snap.mode === "live" ? `Live from Sage · ${gen.toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})}` : "Preview data";
  $("#liveBadge").classList.toggle("preview", snap.mode !== "live");
  $("#subTitle").textContent = `${snap.company || "GFS Logistics"} · data through ${new Date(snap.asOf + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})}`;
  const ban = [];
  if (snap.mode === "preview") ban.push(`<div class="banner">Preview built from the October package numbers (Jan–Oct 2026). Drill-downs show one line per account and month until the live Sage feed is connected.</div>`);
  (snap.warnings || []).forEach(w => ban.push(`<div class="banner">${esc(w)}</div>`));
  $("#banners").innerHTML = ban.join("");
  $("#foot").innerHTML = `Source: Sage Intacct general ledger, budget “${esc(M.cfg.budgetId || "GFS Budget")}” and AR invoices. Presentation follows the GFS monthly financial package. Excluded from reporting: ${(M.cfg.excludeLines || []).map(x => `${esc(x.acct)} ${f$(x.amt, 2)} (${esc(x.why)})`).join("; ") || "nothing"}.`;
  render();
}

/* ---------------------------------------------------------- boot */
$("#lockForm").addEventListener("submit", e => { e.preventDefault(); unlock($("#pw").value, $("#remember").checked); });
$("#nav").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (!b) return; st.view = b.dataset.view; render(); window.scrollTo(0, 0); });
$("#repMonth").addEventListener("change", e => { st.rep = e.target.value; st.pl.actM = st.pl.budM = st.rep; st.cmp.a = st.cmp.b = null; render(); });
$("#dClose").addEventListener("click", closeDrawer); $("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
$("#dCsv").addEventListener("click", () => { if (!drawerRows.length) return; const k = Object.keys(drawerRows[0]); downloadCsv([k, ...drawerRows.map(r => k.map(x => r[x]))], ($("#dTitle").textContent || "detail") + ".csv"); });
$("#lockBtn").addEventListener("click", () => { store.del(LS_KEY); location.reload(); });
const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
applyTheme(store.get(THEME_KEY));
$("#themeBtn").addEventListener("click", () => { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); const nx = cur === "dark" ? "light" : "dark"; store.set(THEME_KEY, nx); applyTheme(nx); render(); });
if (window.__PREVIEW_DATA__) start(window.__PREVIEW_DATA__);
else { const saved = store.get(LS_KEY, true) || store.get(LS_KEY); if (saved) { $("#remember").checked = !!store.get(LS_KEY); unlock(saved, $("#remember").checked); } }
})();
