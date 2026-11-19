/* GFS Financials — board report. Data: Sage Intacct via fetch_fin.py (AES-256 encrypted). */
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

/* ============================================================ formatting */
const r2 = v => Math.round((v || 0) * 100) / 100;
const f$ = (v, dec = 0) => { if (v == null || !isFinite(v)) return "–"; const s = Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: dec, maximumFractionDigits: dec});
  return Math.round(v * 10 ** dec) < 0 ? `($${s})` : `$${s}`; };
const fN = v => (v == null || !isFinite(v)) ? "–" : Math.abs(Math.round(v)) < 1 ? "–" : (Math.round(v) < 0 ? `(${Math.abs(Math.round(v)).toLocaleString("en-US")})` : Math.round(v).toLocaleString("en-US"));
const fK = (v, sign) => { if (v == null || !isFinite(v)) return "–"; const a = Math.abs(v), sg = v < 0 ? "−" : sign ? "+" : "";
  return a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(2)}M` : a >= 1e5 ? `${sg}$${(a / 1e3).toFixed(0)}K` : a >= 1e3 ? `${sg}$${(a / 1e3).toFixed(1)}K` : `${sg}$${a.toFixed(0)}`; };
const fP = (v, d = 1, sign) => (v == null || !isFinite(v)) ? "–" : `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`;
const fPts = v => (v == null || !isFinite(v)) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)} pts`;
const pctOf = (a, b) => (b ? (a - b) / Math.abs(b) : null);
const ymLabel = (m, long) => { const [y, mo] = m.split("-"); return `${(long ? MNL : MN)[+mo - 1]} ${long ? y : "’" + y.slice(2)}`; };
const mName = m => MNL[+m.slice(5) - 1];
const addM = (m, k) => { let [y, mo] = m.split("-").map(Number); mo += k; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; };
const yearMonths = y => MN.map((_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
const monthsThrough = m => yearMonths(m.slice(0, 4)).filter(x => x <= m);
const tone = (d, good) => (!d || Math.abs(d) < 0.5) ? "neu" : (d * good > 0 ? "good" : "bad");

/* ============================================================ state */
let D = null, M = null, PW = null;
const st = {
  view: "summary", rep: null,
  pl: {layout: "soo", ent: "ALL", mode: "month", basis: null, actM: null, open: new Set(), zeros: false, pctRev: true},
  cmp: {a: null, b: null, layout: "soo", ent: "ALL", open: new Set()},
  sales: {div: "ALL", mode: "month", cm: true, q: ""},
  edits: (() => { try { return JSON.parse(store.get(EDITS_KEY) || "{}"); } catch { return {}; } })(),
};
const saveEdits = () => store.set(EDITS_KEY, JSON.stringify(st.edits));

/* ============================================================ crypto + loading */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decryptEnv(env, password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter}, base, {name: "AES-GCM", length: 256}, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(env.iv)}, key, b64(env.ct))));
}
async function unlock(password, remember) {
  $("#err").textContent = ""; const b = $("#unlockBtn"); b.disabled = true; b.textContent = "Opening…";
  try {
    const res = await fetch("data.enc.json?t=" + Date.now(), {cache: "no-store"});
    if (!res.ok) throw new Error("file");
    let snap; try { snap = await decryptEnv(await res.json(), password); } catch { throw new Error("pw"); }
    if (remember) store.set(LS_KEY, password); else store.del(LS_KEY);
    store.set(LS_KEY, password, true); PW = password;
    start(snap);
  } catch (e) {
    $("#err").textContent = e.message === "pw" ? "That passphrase didn't work." : "Couldn't load the report data. Try again in a minute.";
    store.del(LS_KEY);
  } finally { b.disabled = false; b.textContent = "Open report"; }
}
const loading = (on, txt) => { $("#loading").classList.toggle("hidden", !on); if (txt) $("#loadingText").textContent = txt; };
async function ensureYears(years) {
  const need = [...new Set(years)].filter(y => (M.histYears || []).includes(y) && !M.loaded.has(y));
  if (!need.length) return;
  loading(true, `Loading ${need.join(" & ")} detail from the archive…`);
  try {
    for (const y of need) {
      const res = await fetch(`hist-${y}.enc.json?t=${Date.now()}`, {cache: "no-store"});
      const h = await decryptEnv(await res.json(), PW);
      addLines(h.gl, h.S); M.loaded.add(y);
    }
    resetCaches();
  } catch { /* history file missing: views fall back to monthly totals */ }
  finally { loading(false); }
}

/* ============================================================ model */
const CUST_MERGE = [[/^Applied Adhesives\s*\((APPPAY|WARADH)\)\s*$/i, "Applied Adhesives"]];
const custName = c => { if (!c) return c; const mm = (M && M.cfg && M.cfg.customerMerge) || {}; if (mm[c]) return mm[c]; for (const [re, to] of CUST_MERGE) if (re.test(c)) return to; return c; };
function mapLine(r, S) { const s = i => (i == null || i < 0) ? "" : (S[i] ?? "");
  return {d: r[0], m: r[0].slice(0, 7), a: r[1], l: r[2] || "", v: r[3], e: s(r[4]), c: custName(s(r[5])), vn: s(r[6]), memo: s(r[7]), j: s(r[8]), u: s(r[9]), je: s(r[10]), doc: s(r[11])}; }
function addLines(rows, S) { for (const r of rows || []) M.lines.push(mapLine(r, S)); M.lines.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0); }
function buildModel(snap) {
  const S = snap.S || [], cfg = snap.cfg || {};
  const s = i => (i == null || i < 0) ? "" : (S[i] ?? "");
  M = {cfg, S, lines: [], A: {}, B: {}, names: Object.assign({}, cfg.accountNames || {}, snap.acctNames || {}), asOf: snap.asOf,
       histYears: snap.histYears || [], loaded: new Set([snap.detailYear || (snap.asOf || "").slice(0, 4)])};
  addLines(snap.gl, S);
  const addA = (a, l, m, v) => { ((M.A[a] ||= {})[l] ||= {})[m] = (M.A[a][l][m] || 0) + v; };
  if (snap.agg) snap.agg.forEach(([a, l, m, v]) => addA(a, l || "", m, v));
  else M.lines.forEach(x => addA(x.a, x.l, x.m, x.v));
  (snap.bud || []).forEach(([a, l, m, v]) => { ((M.B[a] ||= {})[l || ""] ||= {})[m] = ((M.B[a][l || ""] || {})[m] || 0) + v; });
  const acc = new Set(Object.keys(M.A)); Object.keys(M.B).forEach(a => acc.add(a)); Object.keys(cfg.accountNames || {}).forEach(a => acc.add(a));
  M.accts = [...acc].filter(a => a >= "4000").sort();
  const months = new Set(); for (const a in M.A) for (const l in M.A[a]) for (const m in M.A[a][l]) months.add(m);
  M.months = [...months].filter(m => m <= (snap.asOf || "9999").slice(0, 7)).sort();
  M.budYears = new Set(); for (const a in M.B) for (const l in M.B[a]) for (const m in M.B[a][l]) M.budYears.add(m.slice(0, 4));
  const cw = cfg.cwCustomerDivision || {default: "G1", contains: {}};
  const sdiv = (l, c) => { if (l === "G1" || l === "G2") return l; for (const [k, d] of Object.entries(cw.contains || {})) if (c.toUpperCase().includes(k.toUpperCase())) return d; return cw.default || "G1"; };
  M.sales = (snap.sales || []).map(r => { const c = custName(s(r[2])); return {d: r[0], m: r[0].slice(0, 7), doc: s(r[1]), c, l: r[3], v: r[4], k: r[5], div: sdiv(r[3], c)}; });
  M.mv = (snap.mv || []).map(r => ({d: r[0], m: r[0].slice(0, 7), a: r[1], l: r[2], v: r[3], cat: r[4], how: r[5], vn: s(r[6]), memo: s(r[7]), u: s(r[8]), key: r[9], e: s(r[10] ?? -1)}));
}
const hasBudget = y => M.budYears.has(String(y));
const ENTS = {ALL: "Consolidated", G1: "G1 · GFS Logistics", G2: "G2 · Texas Cartage", CW: "CW · City Warehouse"};
const ENTS_S = {ALL: "Consolidated", G1: "G1", G2: "G2", CW: "CW"};
const kindOf = a => a.startsWith("4") ? "rev" : (a >= "6110" && a < "6200" && !a.startsWith("6120")) ? "adj" : a.startsWith("6120") ? "move" : "exp";
const natural = (a, raw) => (kindOf(a) === "rev" || kindOf(a) === "adj") ? -raw : raw;
function sumMap(byL, ent, ms) { if (!byL) return 0; let t = 0; for (const l in byL) { if (ent !== "ALL" && l !== ent) continue; const bm = byL[l]; for (const m of ms) t += bm[m] || 0; } return t; }
const actRaw = (a, ent, ms) => sumMap(M.A[a], ent, ms);
function budNat(a, ent, ms) { let t = sumMap(M.B[a], ent, ms); if (kindOf(a) === "adj" && !/^617/.test(a)) t = -t; return t; }
const accVal = (a, ent, ms, f) => f === "b" ? budNat(a, ent, ms) : natural(a, actRaw(a, ent, ms));

/* office compensation split for the Statement of Operations */
function mergedEdits() { const e = st.edits || {}, c = M.cfg, o = {};
  for (const k of ["moveManual", "palletsOnHand", "priorYear", "customerAliases", "capacity"]) if (e[k]) o[k] = Object.assign({}, c[k] || {}, e[k]);
  return o; }
const cfgx = () => Object.assign({}, M.cfg, mergedEdits());
const empRole = id => ((M.cfg.employees || {})[id] || {}).role || "";
const empName = id => ((M.cfg.employees || {})[id] || {}).name || id;
function ocLineRole(x) {
  if (x.memo.toLowerCase().includes((M.cfg.salaryReclassMemo || "Salary Reclass").toLowerCase())) return "realloc";
  const r = empRole(x.e); if (r === "cc" || r === "whm") return r;
  if (x.a === "6005-001" && (r === "mgmt" || (!x.e && (x.j === (M.cfg.joeKernodle || {}).journal || /\bJK\b/.test(x.memo))))) return "mgmt";
  return "other";
}
let ocCache = {};
function officeComp(m) {
  if (ocCache[m]) return ocCache[m];
  const w = natural("6005-001", actRaw("6005-001", "ALL", [m])), t = natural("6005-006", actRaw("6005-006", "ALL", [m]));
  const hist = (M.cfg.officeCompHistory || {})[m];
  let r;
  if (m < (M.cfg.officeCompSplitFrom || "2026-01")) r = {cc: 0, whm: 0, mgmt: w, ovtax: t, unsplit: true};
  else if (m <= (M.cfg.officeCompFrozenThrough || "") && hist) r = {cc: hist.cc, whm: hist.whm, mgmt: hist.mgmt, ovtax: r2(w + t - hist.cc - hist.whm - hist.mgmt), frozen: true};
  else { let cc = 0, wh = 0, mg = 0;
    for (const x of M.lines) if (x.m === m && (x.a === "6005-001" || x.a === "6005-006")) { const k = ocLineRole(x); if (k === "cc") cc += x.v; else if (k === "whm") wh += x.v; else if (k === "mgmt") mg += x.v; }
    r = {cc: r2(cc), whm: r2(wh), mgmt: r2(mg), ovtax: r2(w + t - cc - wh - mg)}; }
  return (ocCache[m] = r);
}
function ocBudget(m) { const ob = (M.cfg.overheadWageBudget || {})[m] || {mgmt: 0, ovTax: 0};
  return {ccwhm: budNat("6005-001", "ALL", [m]) + budNat("6005-006", "ALL", [m]) - ob.mgmt - ob.ovTax, mgmt: ob.mgmt, ovtax: ob.ovTax}; }
function virtVal(k, ms, f) { let t = 0; for (const m of ms) { if (f === "b") { const b = ocBudget(m); t += k === "cc" ? b.ccwhm : k === "whm" ? 0 : b[k]; } else t += officeComp(m)[k]; } return t; }

/* layouts */
const accts = p => M.accts.filter(p), pre = (...p) => a => p.some(x => a.startsWith(x)), sfx = a => +(a.split("-")[1] || 0);
const rowsOf = list => list.map(a => ({t: "acct", a, id: "a:" + a, label: `${a} · ${M.names[a] || ""}`}));
let layoutCache = {};
function layoutDef(type, ent) {
  const key = type + ent; if (layoutCache[key]) return layoutCache[key];
  const L = [], used = new Set(), soo = type === "soo";
  const grp = (id, label, rows, good, subs) => { rows.forEach(r => r.t === "acct" && used.add(r.a)); L.push({k: "grp", id, label, rows, good, subs}); };
  const sec = label => L.push({k: "sec", label});
  const tot = (id, label, parts, good, cls) => L.push({k: "tot", id, label, parts, good, cls});
  const pct = (label, num, den) => L.push({k: "pct", label, num, den});
  sec("Revenue");
  grp("rv_st", "Storage Revenue", rowsOf(accts(pre("4005"))), 1);
  grp("rv_fu", "Fulfillment Revenue", rowsOf(accts(pre("4010"))), 1);
  grp("rv_ha", "Handling Revenue", rowsOf(accts(pre("4015"))), 1);
  grp("rv_fr", "Freight Revenue", rowsOf(accts(pre("4020"))), 1);
  grp("rv_ot", "Other Revenue", rowsOf(accts(a => a.startsWith("4") && !used.has(a))), 1);
  tot("rev", "Total Revenue", [["rv_st", 1], ["rv_fu", 1], ["rv_ha", 1], ["rv_fr", 1], ["rv_ot", 1]], 1, "key");
  sec("Cost of Goods Sold");
  grp("cg_fr", "Freight Expense", rowsOf(accts(pre("5010", "5011", "5012", "5013"))), -1);
  { const LB = [["cg_lb_e", "GFS Employee Labor", "5035"], ["cg_lb_f", "Full-Time Temp-to-Hire Labor", "5040"], ["cg_lb_t", "Temporary Labor", "5045"]];
    const rows = [], subs = [];
    for (const [id, label, px] of LB) { const rs = rowsOf(accts(pre(px))); if (!rs.length) continue; rs.forEach(r => r.sg = id); rows.push(...rs); subs.push({id, label}); }
    grp("cg_lb", "Warehouse Labor", rows, -1, subs); }
  grp("cg_cm", "Commissions Expense", rowsOf(accts(pre("5025"))), -1);
  grp("cg_pm", "Production Materials", rowsOf(accts(pre("5020"))), -1);
  const oc5 = accts(a => a.startsWith("5") && !used.has(a)); if (oc5.length) grp("cg_ot", "Other Cost of Goods Sold", rowsOf(oc5), -1);
  tot("cogs", "Total Cost of Goods Sold", [["cg_fr", 1], ["cg_lb", 1], ["cg_cm", 1], ["cg_pm", 1], ["cg_ot", 1]], -1);
  tot("gp", soo ? "Warehouse Operating Profit" : "Gross Profit", [["rev", 1], ["cogs", -1]], 1, "key");
  pct(soo ? "Operating margin" : "Gross margin", "gp", "rev");
  if (soo) {
    sec("Direct Operating Expense");
    grp("d_oc", "Customer Care & Warehouse Manager", [{t: "v", k: "cc", id: "v:cc", label: "Customer Care wages & taxes", nb: true}, {t: "v", k: "whm", id: "v:whm", label: "Warehouse Manager wages & taxes", nb: true}], -1);
    ["6005-001", "6005-006"].forEach(a => used.add(a));
    grp("d_wh", "Warehouse Operating Expense", rowsOf(accts(pre("6010"))), -1);
    grp("d_ad", "Administrative Expenses", rowsOf(accts(a => a.startsWith("6015") && sfx(a) >= 7)), -1);
    grp("d_oo", "Occupancy & Utilities", rowsOf(accts(a => a.startsWith("6025") && a !== "6025-005")), -1);
    tot("dox", "Total Direct Operating Expense", [["d_oc", 1], ["d_wh", 1], ["d_ad", 1], ["d_oo", 1]], -1);
    tot("woi", "Warehouse Operating Income", [["gp", 1], ["dox", -1]], 1, "key");
    pct("Warehouse operating margin", "woi", "rev");
    sec("Allocated Overhead");
    const ocRows = [{t: "v", k: "mgmt", id: "v:mgmt", label: "Management wages"}];
    accts(a => a.startsWith("6005") && !["6005-001", "6005-006", "6005-007"].includes(a)).forEach(a => ocRows.push(...rowsOf([a])));
    ocRows.push({t: "v", k: "ovtax", id: "v:ovtax", label: "6005-006 · Taxes (overhead)"});
    if (M.accts.includes("6005-007")) ocRows.push(...rowsOf(["6005-007"]));
    grp("o_oc", "Office Compensation", ocRows, -1);
    grp("o_ad", "Administrative Expenses", rowsOf(accts(a => a.startsWith("6015") && sfx(a) < 7)), -1);
    grp("o_pf", "Professional Fees", rowsOf(accts(pre("6020"))), -1);
    grp("o_oo", "Occupancy · Tax Rebates & CAM", rowsOf(accts(a => a === "6025-005")), -1);
    grp("o_it", "Computer Equipment & IT", rowsOf(accts(pre("6030"))), -1);
    grp("o_bd", "Business Development", rowsOf(accts(pre("6035"))), -1);
    const un = accts(a => a >= "6000" && a < "6110" && !used.has(a)); if (un.length) grp("o_un", "Other / Unmapped Expense", rowsOf(un), -1);
    tot("opx", "Total Allocated Overhead", [["o_oc", 1], ["o_ad", 1], ["o_pf", 1], ["o_oo", 1], ["o_it", 1], ["o_bd", 1], ["o_un", 1]], -1);
    tot("uni", "Unadjusted Net Income", [["woi", 1], ["opx", -1]], 1, "key");
  } else {
    sec("Operating Expense");
    grp("x_oc", "Office Compensation", rowsOf(accts(pre("6005"))), -1);
    grp("x_wh", "Warehouse Operating Expense", rowsOf(accts(pre("6010"))), -1);
    grp("x_ad", "Administrative Expenses", rowsOf(accts(pre("6015"))), -1);
    grp("x_pf", "Professional Fees", rowsOf(accts(pre("6020"))), -1);
    grp("x_oo", "Occupancy & Utilities", rowsOf(accts(pre("6025"))), -1);
    grp("x_it", "Computer Equipment & IT", rowsOf(accts(pre("6030"))), -1);
    grp("x_bd", "Business Development", rowsOf(accts(pre("6035"))), -1);
    const un = accts(a => a >= "6000" && a < "6110" && !used.has(a)); if (un.length) grp("x_un", "Other / Unmapped Expense", rowsOf(un), -1);
    tot("opx", "Total Operating Expense", [["x_oc", 1], ["x_wh", 1], ["x_ad", 1], ["x_pf", 1], ["x_oo", 1], ["x_it", 1], ["x_bd", 1], ["x_un", 1]], -1);
    tot("uni", "Unadjusted Net Income", [["gp", 1], ["opx", -1]], 1, "key");
  }
  pct("Unadjusted net margin", "uni", "rev");
  sec("Adjustments to Net Income");
  grp("adj", "Adjustments to Net Income", rowsOf(accts(a => kindOf(a) === "adj")), 1);
  tot("ani", "Adjusted Net Income", [["uni", 1], ["adj", 1]], 1, ent === "ALL" ? "key" : "final");
  pct("Adjusted net margin", "ani", "rev");
  if (ent === "ALL") {
    sec("G3 Move");
    grp("mv", "G3 Move Operating Expense", rowsOf(accts(a => kindOf(a) === "move")), -1);
    tot("nim", "Net Income after Move Expense", [["ani", 1], ["mv", -1]], 1, "final");
  }
  return (layoutCache[key] = L);
}
let colCache = new Map();
function computeCol(type, ent, ms, f) {
  const key = [type, ent, ms.join(","), f].join("|"); if (colCache.has(key)) return colCache.get(key);
  const V = {};
  for (const it of layoutDef(type, ent)) {
    if (it.k === "grp") { let t = 0; for (const r of it.rows) { const v = r.t === "acct" ? accVal(r.a, ent, ms, f) : virtVal(r.k, ms, f); V[r.id] = v; t += v; if (r.sg) V[r.sg] = (V[r.sg] || 0) + v; } V[it.id] = t; }
    else if (it.k === "tot") V[it.id] = it.parts.reduce((s, [id, sg]) => s + (V[id] || 0) * sg, 0);
  }
  colCache.set(key, V); return V;
}
const val = (id, type, ent, ms, f) => computeCol(type, ent, ms, f)[id] || 0;
function resetCaches() { colCache = new Map(); ocCache = {}; SIX = null; }

/* comparison basis */
const BASIS = {bud: "Budget", py: "Prior year", pm: "Prior month"};
function basisCols(basis, ms) { if (basis === "bud") return {ms, f: "b"}; if (basis === "py") return {ms: ms.map(m => addM(m, -12)), f: "a"}; return {ms: ms.map(m => addM(m, -1)), f: "a"}; }
function basisAvailable(basis, ms) { if (basis === "bud") return hasBudget(ms[0].slice(0, 4)); if (basis === "py") return M.months.includes(addM(ms.at(-1), -12)) || M.months.includes(addM(ms[0], -12)); return M.months.includes(addM(ms[0], -1)); }
const defaultBasis = m => ["bud", "py", "pm"].find(b => basisAvailable(b, [m])) || "bud";

/* GL lines for drill-downs */
function linesFor(spec, ent, ms) {
  const ms2 = new Set(ms), ok = x => ms2.has(x.m) && (ent === "ALL" || x.l === ent);
  if (spec.t === "acct") return M.lines.filter(x => x.a === spec.a && ok(x));
  if (spec.t === "accts") { const s = new Set(spec.list); return M.lines.filter(x => s.has(x.a) && ok(x)); }
  if (spec.t === "v") return M.lines.filter(x => {
    if (!((x.a === "6005-001" || x.a === "6005-006") && ok(x))) return false;
    const oc = officeComp(x.m);
    if (oc.frozen) return true;
    if (oc.unsplit) return spec.k === "mgmt" ? x.a === "6005-001" : spec.k === "ovtax" ? x.a === "6005-006" : false;
    const k = ocLineRole(x); return spec.k === "ovtax" ? (k === "other" || k === "realloc") : k === spec.k; });
  return [];
}
const cpKey = x => x.c || x.vn || (x.e ? empName(x.e) : "") || (x.memo ? x.memo.slice(0, 60) : "") || "Journal entry";
function drivers(spec, ent, msA, msB) {
  const agg = new Map();
  const add = (x, w) => { const k = cpKey(x), o = agg.get(k) || {k, a: 0, b: 0}; o[w] += natural(x.a, x.v); agg.set(k, o); };
  linesFor(spec, ent, msA).forEach(x => add(x, "a")); if (msB) linesFor(spec, ent, msB).forEach(x => add(x, "b"));
  return [...agg.values()].map(o => ({...o, d: o.b - o.a}));
}
const grpSpec = g => g.rows.some(r => r.t === "v") ? {t: "grpv", g} : {t: "accts", list: g.rows.map(r => r.a)};

/* ============================================================ charts */
const tip = $("#tip");
function showTip(e, html) { tip.innerHTML = html; tip.classList.remove("hidden"); const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 16; if (x + w > innerWidth - 8) x = e.clientX - w - 16; if (y + h > innerHeight - 8) y = e.clientY - h - 16; tip.style.left = x + "px"; tip.style.top = y + "px"; }
const hideTip = () => tip.classList.add("hidden");
const tipRows = rows => rows.map(([l, v, c]) => `<div class="r"><span>${c ? `<i class="sw" style="background:${c}"></i>` : ""}${esc(l)}</span><b>${v}</b></div>`).join("");
function nice(lo, hi, n = 4) { const span = (hi - lo) || Math.abs(hi) || 1; const step0 = span / n, p = 10 ** Math.floor(Math.log10(step0)), r = step0 / p;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; return {lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step}; }
function axes(W, H, pl, pr, pt, pb, sc, fmt) { let g = ""; for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) { const y = pt + (sc.hi - v) / (sc.hi - sc.lo) * (H - pt - pb);
  g += `<line class="${Math.abs(v) < 1e-9 ? "zl" : "gl"}" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="ax" x="${pl - 8}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; } return g; }
/* monthly bars vs a target tick; bars that beat target are solid, misses are lighter */
function barTarget(el, {labels, actual, target, sel, good = 1, height = 260, fmt = fK, onClick, names = ["Actual", "Budget"]}) {
  const W = Math.max(320, el.clientWidth || 600), H = height, pl = 56, pr = 8, pt = 24, pb = 28;
  const vals = actual.concat(target || []).filter(v => v != null);
  const sc = nice(Math.min(0, ...vals), Math.max(...vals, 1) * 1.08);
  const y = v => pt + (sc.hi - v) / (sc.hi - sc.lo) * (H - pt - pb);
  const n = labels.length, cw = (W - pl - pr) / n, bw = Math.min(34, cw * .58);
  let g = axes(W, H, pl, pr, pt, pb, sc, fmt);
  labels.forEach((lb, i) => {
    const cx = pl + cw * i + cw / 2, a = actual[i], t = target ? target[i] : null;
    g += `<text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle" ${i === sel ? 'style="fill:var(--navy);font-weight:700"' : ""}>${esc(lb)}</text>`;
    if (a != null) { const y0 = y(Math.max(a, 0)), h = Math.max(1, Math.abs(y(a) - y(0))); const miss = t != null && (a - t) * good < 0;
      const fill = miss ? "color-mix(in srgb,var(--c1) 38%,var(--surface))" : "var(--c1)";
      g += `<rect x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${h}" rx="4" fill="${fill}" ${i === sel ? 'stroke="var(--gold)" stroke-width="2"' : ""}/>`;
      if (i === sel) g += `<text class="lb" x="${cx}" y="${Math.min(y0, t != null ? y(t) : y0) - 8}" text-anchor="middle">${fmt(a)}</text>`; }
    if (t != null && t !== 0) g += `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${y(t)}" y2="${y(t)}" stroke="var(--navy)" stroke-width="2.5" stroke-linecap="round"/>`;
    g += `<rect data-i="${i}" x="${pl + cw * i}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent" style="cursor:${onClick ? "pointer" : "default"}"/>`;
  });
  el.innerHTML = `<div class="legend"><span><i style="background:var(--c1)"></i>${esc(names[0])}${target ? (good > 0 ? " at/above " : " at/below ") + esc(names[1].toLowerCase()) : ""}</span>${target ? `<span><i style="background:color-mix(in srgb,var(--c1) 38%,var(--surface))"></i>${good > 0 ? "Below" : "Above"} ${esc(names[1].toLowerCase())}</span><span><i class="tk"></i>${esc(names[1])}</span>` : ""}</div><div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(names[0])} by month">${g}</svg></div>`;
  $$("rect[data-i]", el).forEach(r => { const i = +r.dataset.i;
    r.addEventListener("mousemove", e => showTip(e, `<div class="th">${esc(labels[i])}</div>` + tipRows([[names[0], f$(actual[i]), "var(--c1)"], ...(target ? [[names[1], f$(target[i]), "var(--navy)"], ["Variance", `<span class="${tone((actual[i] ?? 0) - (target[i] ?? 0), good) === "bad" ? "neg" : "pos"}">${fK((actual[i] ?? 0) - (target[i] ?? 0), true)}</span>`]] : [])])));
    r.addEventListener("mouseleave", hideTip); if (onClick) r.addEventListener("click", () => onClick(i)); });
}
/* lines with direct end labels and an optional reference line */
function lineChart(el, {labels, series, height = 260, fmt = fK, ref, onClick}) {
  const W = Math.max(320, el.clientWidth || 600), H = height, pl = 56, pr = 96, pt = 16, pb = 28;
  const vals = series.flatMap(s => s.values).filter(v => v != null).concat(ref ? [ref.value] : []);
  const sc = nice(Math.min(0, ...vals), (Math.max(...vals) * 1.05) || 1);
  const n = labels.length, cw = (W - pl - pr) / Math.max(n - 1, 1), X = i => pl + (n === 1 ? (W - pl - pr) / 2 : cw * i), Y = v => pt + (sc.hi - v) / (sc.hi - sc.lo) * (H - pt - pb);
  let g = axes(W, H, pl, pr, pt, pb, sc, fmt);
  labels.forEach((lb, i) => { if (n <= 13 || i % 2 === 0) g += `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`; });
  if (ref) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(ref.value)}" y2="${Y(ref.value)}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5 4"/><text class="lbm" x="${pl + 6}" y="${Y(ref.value) - 6}" style="fill:var(--gold);font-weight:600">${esc(ref.label)}</text>`;
  const ends = [];
  series.forEach(s => { let d = ""; s.values.forEach((v, i) => { if (v == null) return; d += (d && s.values[i - 1] != null ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.8 : 2.4}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (!s.dash) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="${i === s.values.length - 1 ? 4.5 : 2.6}" fill="${i === s.values.length - 1 ? s.color : "var(--surface)"}" stroke="${s.color}" stroke-width="2"/>`; });
    let li = -1; s.values.forEach((v, i) => { if (v != null) li = i; }); if (li >= 0) ends.push({y: Y(s.values[li]), x: X(li), s, v: s.values[li]}); });
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
  ends.forEach(e => { g += `<text class="lb" x="${e.x + 10}" y="${e.y - 1}" style="fill:${e.s.color}">${fmt(e.v)}</text><text class="lbm" x="${e.x + 10}" y="${e.y + 12}">${esc(e.s.short || e.s.name)}</text>`; });
  g += `<line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--axis)" stroke-dasharray="3 3" opacity="0"/>`;
  labels.forEach((_, i) => g += `<rect data-i="${i}" x="${X(i) - cw / 2}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent" style="cursor:${onClick ? "pointer" : "default"}"/>`);
  el.innerHTML = `<div class="legend">${series.map(s => `<span><i class="${s.dash ? "ds" : "ln"}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div><div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map(s => s.name).join(", "))}">${g}</svg></div>`;
  const xh = $(".xh", el);
  $$("rect[data-i]", el).forEach(r => { const i = +r.dataset.i;
    r.addEventListener("mousemove", e => { xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("opacity", 1);
      showTip(e, `<div class="th">${esc(labels[i])}</div>` + tipRows(series.map(s => [s.name, fmt(s.values[i]), s.color]))); });
    r.addEventListener("mouseleave", () => { xh.setAttribute("opacity", 0); hideTip(); }); if (onClick) r.addEventListener("click", () => onClick(i)); });
}
/* bridge from a starting value to an ending value */
function waterfall(el, items, {height = 300} = {}) {
  const W = Math.max(320, el.clientWidth || 600), H = height, pl = 56, pr = 8, pt = 26, pb = 54;
  let run = 0; const geo = items.map(it => { if (it.type === "delta") { const a = run; run += it.v; return [a, run]; } run = it.v; return [0, it.v]; });
  const sc = nice(Math.min(0, ...geo.flat()), Math.max(...geo.flat()) * 1.08);
  const y = v => pt + (sc.hi - v) / (sc.hi - sc.lo) * (H - pt - pb), cw = (W - pl - pr) / items.length, bw = Math.min(52, cw * .62);
  let g = axes(W, H, pl, pr, pt, pb, sc, fK);
  items.forEach((it, i) => { const [a, b] = geo[i], x = pl + cw * i + (cw - bw) / 2, top = y(Math.max(a, b)), h = Math.max(2, Math.abs(y(a) - y(b)));
    const col = it.type !== "delta" ? "var(--navy)" : it.v >= 0 ? "var(--good)" : "var(--bad)";
    g += `<rect x="${x}" y="${top}" width="${bw}" height="${h}" rx="4" fill="${col}"/>`;
    if (i < items.length - 1) g += `<line x1="${x + bw}" x2="${x + cw}" y1="${y(b)}" y2="${y(b)}" stroke="var(--axis)" stroke-dasharray="2 3"/>`;
    g += `<text class="lb" x="${x + bw / 2}" y="${top - 8}" text-anchor="middle">${it.type === "delta" ? fK(it.v, true) : fK(it.v)}</text>`;
    const mc = Math.max(5, Math.floor(cw / 6.3)), lines = [""]; it.label.split(" ").forEach(w => { const cur = lines[lines.length - 1]; if ((cur + " " + w).trim().length <= mc || !cur) lines[lines.length - 1] = (cur + " " + w).trim(); else lines.push(w); });
    lines.slice(0, 3).forEach((ln, k) => { g += `<text class="ax" x="${x + bw / 2}" y="${H - pb + 15 + k * 13}" text-anchor="middle">${esc(ln.length > mc + 2 ? ln.slice(0, mc) + "…" : ln)}</text>`; });
    g += `<rect data-i="${i}" x="${pl + cw * i}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent" style="cursor:${it.onClick ? "pointer" : "default"}"/>`; });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Bridge chart">${g}</svg></div>`;
  $$("rect[data-i]", el).forEach(r => { const it = items[+r.dataset.i];
    r.addEventListener("mousemove", e => showTip(e, `<div class="th">${esc(it.label)}</div>${tipRows([[it.type === "delta" ? "Impact on net income" : "Amount", f$(it.v)]])}${it.note ? `<div class="muted small" style="margin-top:4px;max-width:260px">${esc(it.note)}</div>` : ""}`));
    r.addEventListener("mouseleave", hideTip); if (it.onClick) r.addEventListener("click", it.onClick); });
}
function sparkBars(vals, tgts, sel) {
  const W = 240, H = 46, n = vals.length, mx = Math.max(1, ...vals.filter(v => v != null).map(Math.abs), ...(tgts || []).filter(v => v != null).map(Math.abs));
  const cw = W / n, bw = Math.max(3, cw * .62); let g = "";
  vals.forEach((v, i) => { if (v == null) return; const h = Math.max(1.5, Math.abs(v) / mx * (H - 6)), x = i * cw + (cw - bw) / 2;
    g += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="2" fill="${i === sel ? "var(--c1)" : "color-mix(in srgb,var(--c1) 30%,var(--surface))"}" opacity="${v < 0 ? .6 : 1}"/>`;
    if (tgts && tgts[i]) g += `<line x1="${x - 1.5}" x2="${x + bw + 1.5}" y1="${H - Math.abs(tgts[i]) / mx * (H - 6)}" y2="${H - Math.abs(tgts[i]) / mx * (H - 6)}" stroke="var(--navy)" stroke-width="1.6" opacity=".55"/>`; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${g}</svg>`;
}
function bullets(items, {fmt = fK, onClick, good = 1, head} = {}) {
  const mx = Math.max(1, ...items.map(i => Math.max(Math.abs(i.v), Math.abs(i.t || 0))));
  const html = (head ? `<div class="bul head"><span>${esc(head[0])}</span><span></span><span class="v">${esc(head[1])}</span><span class="d">${esc(head[2])}</span></div>` : "") + items.map((it, k) => {
    const d = it.t != null ? it.v - it.t : null, tn = d == null ? "neu" : tone(d, good);
    return `<div class="bul ${onClick ? "click" : ""}" data-k="${k}"><span class="nm" title="${esc(it.label)}">${esc(it.label)}</span><span class="tr"><span class="b" style="width:${Math.abs(it.v) / mx * 100}%;background:${it.color || (tn === "bad" ? "color-mix(in srgb,var(--c1) 45%,var(--surface))" : "var(--c1)")}"></span>${it.t ? `<span class="m" style="left:calc(${Math.abs(it.t) / mx * 100}% - 1px)"></span>` : ""}</span><span class="v">${fmt(it.v)}</span><span class="d ${tn === "bad" ? "neg" : tn === "good" ? "pos" : "muted"}">${d == null ? (it.note || "") : fK(d, true)}</span></div>`; }).join("");
  return {html, bind: el => onClick && $$(".bul[data-k]", el).forEach(b => b.addEventListener("click", () => onClick(items[+b.dataset.k])))};
}

/* ============================================================ drawer */
let drawerRows = [];
function openDrawer(kicker, title, html) { $("#dKicker").textContent = kicker; $("#dTitle").textContent = title; $("#dBody").innerHTML = html;
  $("#dCsv").classList.toggle("hidden", !drawerRows.length); $("#drawer").classList.remove("hidden"); $("#scrim").classList.remove("hidden"); $("#dBody").scrollTop = 0; }
function closeDrawer() { $("#drawer").classList.add("hidden"); $("#scrim").classList.add("hidden"); }
const sageUrl = u => u ? `https://www.intacct.com/ia/acct/ur.phtml?.r=${encodeURIComponent(u)}` : "";
const isBatch = s => /batch summary entry|^G[12] (bill|check|journal entry|general journal|invoice|receipt|deposit)s?$/i.test(s || "");
function linesTable(ls) {
  const rows = ls.map(x => ({...x, nv: natural(x.a, x.v), who: x.c || x.vn || (x.e ? empName(x.e) : "")}));
  drawerRows = rows.map(x => ({Date: x.d, Document: x.doc, Account: x.a, Division: x.l, Name: x.who, Memo: x.memo, Journal: x.j, Amount: r2(x.nv)}));
  const body = rs => rs.map(x => `<tr><td>${esc(x.d)}</td><td title="${esc(x.doc || x.j)}">${esc(x.doc || x.j)}</td><td class="who">${esc(x.who)}</td><td class="memo ${isBatch(x.memo) ? "batch" : ""}">${esc(x.memo)}</td><td>${esc(x.a)}</td><td>${esc(x.l)}</td><td class="num">${f$(x.nv, 2)}</td><td>${x.u ? `<a href="${sageUrl(x.u)}" target="_blank" rel="noopener" title="Open in Sage Intacct">Sage ↗</a>` : ""}</td></tr>`).join("");
  setTimeout(() => { const t = $("#lt"); if (!t) return; $$("th[data-s]", t).forEach(th => th.addEventListener("click", () => { const k = th.dataset.s, dir = th.dataset.dir = th.dataset.dir === "asc" ? "desc" : "asc";
    rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "asc" ? 1 : -1)); $("tbody", t).innerHTML = body(rows); })); });
  return `<div class="tscroll" style="max-height:none;box-shadow:none"><table class="lines" id="lt"><colgroup><col class="c-date"><col class="c-doc"><col class="c-who"><col><col class="c-acct"><col class="c-div"><col class="c-amt"><col class="c-lnk"></colgroup><thead><tr><th data-s="d">Date</th><th data-s="doc">Doc</th><th data-s="who">Customer / vendor / employee</th><th data-s="memo">Memo / description</th><th data-s="a">Account</th><th data-s="l">Div</th><th class="num" data-s="nv">Amount</th><th></th></tr></thead><tbody>${body(rows)}</tbody></table></div>`;
}
const perLabel = ms => ms.length === 1 ? ymLabel(ms[0], true) : `${ymLabel(ms[0], true)} – ${ymLabel(ms.at(-1), true)}`;
async function drill(spec, ent, ms, label) {
  await ensureYears(ms.map(m => m.slice(0, 4)));
  let ls, tot, parts = null;
  if (spec.t === "grpv") { const g = spec.g, vs = new Set(g.rows.filter(r => r.t === "v").flatMap(r => linesFor(r, ent, ms))), acc = new Set(g.rows.filter(r => r.t === "acct").map(r => r.a));
    ls = M.lines.filter(x => vs.has(x) || (acc.has(x.a) && ms.includes(x.m) && (ent === "ALL" || x.l === ent)));
    parts = g.rows.map(r => ({label: r.label, v: r.t === "acct" ? accVal(r.a, ent, ms, "a") : virtVal(r.k, ms, "a")})).filter(p => Math.abs(p.v) > .5);
    tot = parts.reduce((s, p) => s + p.v, 0); }
  else { ls = linesFor(spec, ent, ms); tot = spec.t === "v" ? virtVal(spec.k, ms, "a") : spec.t === "acct" ? accVal(spec.a, ent, ms, "a") : spec.list.reduce((s, a) => s + accVal(a, ent, ms, "a"), 0);
    if (spec.t === "accts" && spec.list.length > 1) parts = spec.list.map(a => ({label: `${a} · ${M.names[a] || ""}`, v: accVal(a, ent, ms, "a")})).filter(p => Math.abs(p.v) > .5); }
  ls.sort((a, b) => a.d < b.d ? 1 : -1);
  const loadedAll = ms.every(m => M.loaded.has(m.slice(0, 4)));
  const contrib = new Map(); ls.forEach(x => { const k = cpKey(x); contrib.set(k, (contrib.get(k) || 0) + natural(x.a, x.v)); });
  const top = [...contrib.entries()].map(([k, v]) => ({label: k, v})).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 8);
  const pb = parts && parts.length > 1 ? bullets(parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)), {fmt: v => f$(v)}) : null, cb = bullets(top, {fmt: v => f$(v)});
  let note = "";
  if (spec.t === "v" || spec.t === "grpv") { if (ms.some(m => officeComp(m).frozen)) note += `<div class="banner info" style="margin:0 0 16px">January–June 2026 use the split from the monthly package, because Sage had no employee names on payroll lines before June 11, 2026. All office wage and tax lines for those months are listed.</div>`;
    if (ms.some(m => officeComp(m).unsplit)) note += `<div class="banner info" style="margin:0 0 16px">Before 2026 the Customer Care / Management split isn't available, so all office pay sits in overhead for these months.</div>`; }
  if (!loadedAll) note += `<div class="banner" style="margin:0 0 16px">Line detail for this year isn't available; showing totals only.</div>`;
  const panels = [pb ? `<div class="card"><div class="card-h"><h3>By account</h3></div><div class="bullets">${pb.html}</div></div>` : "", top.length > 1 ? `<div class="card"><div class="card-h"><h3>Largest contributors</h3></div><div class="bullets">${cb.html}</div></div>` : ""].filter(Boolean);
  const html = `${note}<div class="stats" style="--n:3;margin-bottom:18px"><div class="stat"><div class="sl">Total</div><div class="sv">${f$(tot)}</div><div class="ss">${esc(perLabel(ms))}</div></div><div class="stat"><div class="sl">Journal lines</div><div class="sv">${ls.length.toLocaleString()}</div><div class="ss">from Sage Intacct</div></div><div class="stat"><div class="sl">Entity</div><div class="sv" style="font-size:16px;padding-top:4px">${esc(ENTS_S[ent])}</div><div class="ss">${ent === "ALL" ? "all divisions" : "division only"}</div></div></div>
    ${panels.length ? `<div class="row ${panels.length === 2 ? "g2" : ""}" style="margin-bottom:18px">${panels.join("")}</div>` : ""}
    <h3 style="margin:0 0 10px;color:var(--navy);font-size:15px">Journal lines</h3>${linesTable(ls)}`;
  openDrawer(`${ENTS_S[ent]} · ${perLabel(ms)}`, label, html);
}

/* ============================================================ narrative helpers */
const vsWord = (d, basis) => `${d >= 0 ? "above" : "below"} ${basis === "bud" ? "budget" : basis === "py" ? "the prior year" : "the prior month"}`;
function groupVariances(type, ent, ms, basis) {
  const bc = basisCols(basis, ms), A = computeCol(type, ent, ms, "a"), B = computeCol(type, ent, bc.ms, bc.f);
  return layoutDef(type, ent).filter(i => i.k === "grp" && i.id !== "mv").map(g => { const a = A[g.id] || 0, bf = B[g.id] || 0, gt = basis === "bud" && g.id === "rv_ot" ? growthTarget(ms, ent) : 0, b = bf - gt;
    return {g, a, b, bf, gt, imp: (a - b) * g.good, impF: (a - bf) * g.good}; });
}
/* The revenue budget carries the "Unidentified & Pure Spec Growth" (G1) and "Unidentified Growth Target" (G2) customer
   budget lines in Other Revenue (4025). Comparing them to Other Revenue actuals is misleading, so they are shown on their own. */
function growthTarget(ms, ent) {
  const rows = (M.cfg.salesBudget || []).filter(b => b.growth && (ent === "ALL" || b.div === ent)), fy = String(M.cfg.fyStart || "2026").slice(0, 4);
  return ms.filter(m => m.startsWith(fy)).reduce((t, m) => t + rows.reduce((s, b) => s + (b.bud[+m.slice(5) - 1] || 0), 0), 0);
}
const growthByDiv = ms => ["G1", "G2"].map(d => [d, growthTarget(ms, d)]).filter(([, v]) => Math.abs(v) > .5);

/* ============================================================ views */
const views = {};
const setTitle = (eyebrow, title) => { $("#pgEyebrow").textContent = eyebrow; $("#pgTitle").textContent = title; document.title = `${title} · GFS Financials`;
  const open = st.rep >= M.asOf.slice(0, 7);
  $("#pgTitle").insertAdjacentHTML("beforeend", open ? ` <span class="openpill" title="Month not closed: invoicing, accruals and allocations are incomplete, so ratios and variances are not meaningful yet">Open month · through ${new Date(M.asOf + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric"})}</span>` : ""); };
async function render() {
  const y = st.rep.slice(0, 4), need = [y, String(+y - 1)];
  if (st.view === "compare" && st.cmp.a) need.push(st.cmp.a.slice(0, 4), st.cmp.b.slice(0, 4));
  await ensureYears(need);
  resetCaches();
  $$("#nav button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === st.view));
  $("#side").classList.remove("open"); hideTip();
  (views[st.view] || views.summary)($("#view"));
  const q = M.mv.filter(x => !(cfgx().moveManual || {})[x.key] && x.how === "none").length;
  $("#admBadge").textContent = q; $("#admBadge").classList.toggle("hidden", !q);
}
const go = (view, fn) => { if (fn) fn(); st.view = view; render(); window.scrollTo(0, 0); };
const card = (title, lede, body, extra = "") => `<div class="card ${extra}"><div class="card-h"><div><h3>${title}</h3>${lede ? `<p class="lede">${lede}</p>` : ""}</div></div><div class="card-b">${body}</div></div>`;
const cls = t => t === "bad" ? "neg" : t === "good" ? "pos" : "";

/* ------------------------------------------------ EXECUTIVE SUMMARY */
views.summary = el => {
  const m = st.rep, y = m.slice(0, 4), ytd = monthsThrough(m), pm = addM(m, -1), T = "soo";
  const basis = defaultBasis(m), bName = BASIS[basis].toLowerCase(), bShort = basis === "bud" ? "budget" : basis === "py" ? "PY" : "PM", bc = basisCols(basis, [m]), bcy = basisCols(basis, ytd);
  setTitle(`Executive summary · Consolidated`, `${mName(m)} ${y} performance`);
  const A = computeCol(T, "ALL", [m], "a"), B = computeCol(T, "ALL", bc.ms, bc.f), P = computeCol(T, "ALL", [pm], "a");
  const YA = computeCol(T, "ALL", ytd, "a"), YB = computeCol(T, "ALL", bcy.ms, bcy.f);
  const pyM = addM(m, -12), hasPY = M.months.includes(pyM), PY = hasPY ? computeCol(T, "ALL", [pyM], "a") : null, pyCfg = (cfgx().priorYear || {})[pyM];
  const pyv = id => PY ? PY[id] : pyCfg ? ({rev: pyCfg.revenue, gp: pyCfg.grossProfit, uni: pyCfg.unadjustedNI})[id] ?? null : null;
  const mg = (id, V) => V.rev ? V[id] / V.rev : null;

  const gv = groupVariances(T, "ALL", [m], basis);
  const revG = gv.filter(x => x.g.good === 1 && x.g.id.startsWith("rv_")), revImp = revG.reduce((s, x) => s + x.impF, 0), gT = revG.reduce((s, x) => s + x.gt, 0);
  const gvC = [{g: {label: "Revenue", id: "rev"}, imp: revImp}, ...gv.filter(x => !revG.includes(x))];
  const neg = gvC.filter(x => x.imp < -500).sort((a, b) => a.imp - b.imp).slice(0, 2), posv = gvC.filter(x => x.imp > 500).sort((a, b) => b.imp - a.imp).slice(0, 2);
  const dRev = A.rev - B.rev, dUni = A.uni - B.uni, up = d => d >= 0 ? "up" : "dn";
  const head = `${mName(m)} revenue of ${fK(A.rev)} came in <span class="${up(dRev)}">${fP(Math.abs(pctOf(A.rev, B.rev) || 0))} ${vsWord(dRev, basis)}</span>; unadjusted net income of ${fK(A.uni)} was <span class="${up(dUni)}">${fK(Math.abs(dUni))} ${vsWord(dUni, basis)}</span>.`;
  const p1 = `Warehouse operating income was <b>${fK(A.woi)}</b>, a <b>${fP(mg("woi", A))}</b> margin (${fPts((mg("woi", A) || 0) - (mg("woi", B) || 0))} vs ${bName}). ` +
    (neg.length ? `The largest drags were ${neg.map(x => `<b>${esc(x.g.label.toLowerCase())}</b> (${fK(x.imp, true)})`).join(" and ")}` : "No category fell materially short") +
    (posv.length ? `, offset in part by ${posv.map(x => `<b>${esc(x.g.label.toLowerCase())}</b> (${fK(x.imp, true)})`).join(" and ")}.` : ".");
  const pG = gT > .5 ? ` The ${bName} includes <b>${fK(gT)}</b> of unidentified growth target (${growthByDiv([m]).map(([d, v]) => `${d} ${fK(v)}`).join(", ")}) that is not tied to a customer; excluding it, revenue ${revImp + gT >= 0 ? "beat" : "missed"} ${bName} by <b>${fK(Math.abs(revImp + gT))}</b>.` : "";
  const p2 = `Year to date, revenue is <b>${fK(YA.rev)}</b> (${fP(pctOf(YA.rev, YB.rev), 1, true)} vs ${bName}) and unadjusted net income is <b>${fK(YA.uni)}</b> against <b>${fK(YB.uni)}</b>` +
    (Math.abs(A.mv || 0) > .5 ? `. The G3 move added <b>${fK(A.mv)}</b> of operating expense this month, leaving net income after move costs at <b>${fK(A.nim)}</b>.` : ".");
  const tile = (id, label, good, sub) => {
    const a = A[id], b = B[id], p = P[id], last = Array.from({length: 12}, (_, i) => addM(m, i - 11));
    const sv = last.map(x => M.months.includes(x) ? val(id, T, "ALL", [x], "a") : null), sb = basis === "bud" ? last.map(x => val(id, T, "ALL", [x], "b")) : null;
    const py = pyv(id), d1 = a - b, d2 = py != null ? a - py : a - p, l2 = py != null ? "vs prior year" : "vs prior month";
    return `<div class="card kpi" data-k="${id}"><div class="k-label"><span>${esc(label)}</span><span class="tag ${tone(d1, good)}" title="vs ${bName}">${fP(pctOf(a, b), 1, true)}</span></div>
      <div class="k-val">${fK(a)}</div><div class="k-sub">${sub}</div>
      <div class="k-chips"><div class="chipbox"><div class="cl">vs ${bName}</div><div class="cv ${cls(tone(d1, good))}">${fK(d1, true)}</div></div>
      <div class="chipbox"><div class="cl">${l2}</div><div class="cv ${cls(tone(d2, good))}">${fK(d2, true)}</div></div></div>
      <div class="k-spark">${sparkBars(sv, sb, 11)}</div></div>`; };
  el.innerHTML = `
    <div class="row"><div class="card brief"><h2>${head}</h2><p>${p1}${pG}</p><p>${p2}</p></div></div>
    <div class="row g4">
      ${tile("rev", "Revenue", 1, `YTD ${fK(YA.rev)} · ${fP(pctOf(YA.rev, YB.rev), 1, true)} vs ${bShort}`)}
      ${tile("woi", "Warehouse Operating Income", 1, `${fP(mg("woi", A))} margin · ${fPts((mg("woi", A) || 0) - (mg("woi", B) || 0))} vs ${bShort}`)}
      ${tile("uni", "Unadjusted Net Income", 1, `${fP(mg("uni", A))} margin · YTD ${fK(YA.uni)}`)}
      ${tile("ani", "Adjusted Net Income", 1, `${fP(mg("ani", A))} margin · adjustments ${fK(A.adj, true)}`)}
    </div>
    <div class="sec sh"><h2>Revenue and profitability</h2></div>
    <div class="row g2">
      ${card(`Revenue ${hasBudget(y) ? "vs budget" : "by month"} · ${y}`, `<span id="revLede"></span>`, `<div id="chRev"></div>`)}
      ${card(`What moved net income vs ${bName}`, `<span id="wfLede"></span>`, `<div id="wf"></div>`)}
    </div>
    <div class="row g21">
      ${card("Margins month by month", `Warehouse operating margin and unadjusted net margin${hasBudget(y) ? ", with the budgeted net margin for reference" : ""}`, `<div id="chMg"></div>`)}
      ${card("Highlights & watch list", `Largest category variances vs ${bName}, explained from the GL`, `<ul class="ilist" id="ins"></ul>`)}
    </div>
    <div class="sec sh"><h2>Division scorecards</h2><div class="lede">Standard P&L by division · G3 move costs are reported at the consolidated level only · click a card for its income statement</div></div>
    <div class="row" id="divs"></div>
    <div class="sec sh"><h2>Labor, freight and customers</h2></div>
    <div class="row g2">
      ${card("Warehouse labor efficiency", "Warehouse labor cost as a share of revenue · lower is better", `<div id="lab"></div>`)}
      ${card("Overtime control", "Overtime as a share of regular warehouse wages · 8% is a normal month", `<div id="ot"></div>`)}
    </div>
    <div class="row g2">
      ${card("Freight markup & shipping errors", "Adjusted markup excludes shipping errors and carrier service charges", `<div id="frt"></div>`)}
      ${card("Customer movers", `Largest changes in invoiced sales, ${ymLabel(m)} vs ${ymLabel(pm)}`, `<div id="movers"></div>`)}
    </div>
    <div class="row g2">
      ${card("Capacity", "End-of-month pallets on hand vs capacity", `<div id="cap"></div>`)}
      ${card("Accounts receivable", "Live from the AR dashboard", `<div id="arSum"></div>`)}
    </div>`;
  $$(".kpi[data-k]", el).forEach(t => t.addEventListener("click", () => go("pl", () => Object.assign(st.pl, {layout: "soo", ent: "ALL", mode: "month", actM: m, basis}))));

  const ym = yearMonths(y);
  const ra = ym.map(x => x <= m && M.months.includes(x) ? val("rev", T, "ALL", [x], "a") : null), rb = hasBudget(y) ? ym.map(x => val("rev", T, "ALL", [x], "b")) : null;
  const beats = rb ? ra.filter((v, i) => v != null && v >= rb[i]).length : 0, cnt = ra.filter(v => v != null).length;
  let best = -1; ra.forEach((v, i) => { if (v != null && (best < 0 || v > ra[best])) best = i; });
  $("#revLede", el).innerHTML = `${rb ? `Beat budget in <b>${beats} of ${cnt}</b> months; ` : ""}the strongest month was <b>${MNL[best] || "–"}</b> at <b>${fK(ra[best])}</b>. Click a month to open its income statement.`;
  barTarget($("#chRev", el), {labels: MN, actual: ra, target: rb, sel: +m.slice(5) - 1, height: 270,
    onClick: i => { if (ra[i] != null) go("pl", () => Object.assign(st.pl, {mode: "month", actM: ym[i], layout: "soo", ent: "ALL"})); }});

  const imp = gv.filter(x => !revG.includes(x) && Math.abs(x.imp) >= 1).sort((a, b) => Math.abs(b.imp) - Math.abs(a.imp)), topI = imp.slice(0, 4), rest = imp.slice(4).reduce((s, x) => s + x.imp, 0);
  const short = l => ({"Warehouse Operating Expense": "WH opex", "Customer Care & Warehouse Manager": "Care & WH Mgr", "Occupancy & Utilities": "Occupancy", "Office Compensation": "Office comp", "Administrative Expenses": "Admin", "Professional Fees": "Prof. fees", "Warehouse Labor": "WH labor", "Freight Expense": "Freight", "Production Materials": "Materials", "Computer Equipment & IT": "IT", "Business Development": "Bus. dev.", "Commissions Expense": "Commissions", "Adjustments to Net Income": "Adjustments"})[l] || l.replace(" Expense", "");
  const costImp = imp.reduce((s, x) => s + x.imp, 0), worst = imp.filter(x => x.imp < 0).sort((a, b) => a.imp - b.imp)[0];
  $("#wfLede", el).innerHTML = `${ymLabel(m, true)} · revenue ${revImp >= 0 ? "beat" : "missed"} ${bName} by <b>${fK(Math.abs(revImp))}</b>; costs ${costImp >= 0 ? "came in under" : "ran over"} by <b>${fK(Math.abs(costImp))}</b>${worst ? `, led by ${esc(worst.g.label.toLowerCase())} (${fK(worst.imp, true)})` : ""}. Click a bar for the detail.`;
  waterfall($("#wf", el), [{label: BASIS[basis], v: B.uni, type: "start"},
    {label: "Revenue", v: revImp, type: "delta", note: `Total revenue: ${f$(A.rev)} actual vs ${f$(B.rev)} ${bName}${gT ? `, which includes ${f$(gT)} of unidentified growth target held in Other Revenue (identified revenue ${fK(revImp + gT, true)} vs its budget)` : ""}. ${revG.filter(x => Math.abs(x.imp) >= 500).sort((a, b) => Math.abs(b.imp) - Math.abs(a.imp)).map(x => `${x.g.label} ${fK(x.imp, true)}`).join(" · ")}`, onClick: () => go("pl", () => Object.assign(st.pl, {layout: "soo", ent: "ALL", mode: "month", actM: m, basis}))},
    ...topI.map(x => ({label: short(x.g.label), v: x.imp, type: "delta", note: `${x.g.label}: ${f$(x.a)} actual vs ${f$(x.b)} ${bName}`, onClick: () => drill(grpSpec(x.g), "ALL", [m], x.g.label)})),
    ...(Math.abs(rest) >= 1 ? [{label: "Other", v: rest, type: "delta"}] : []), {label: "Actual", v: A.uni, type: "end"}], {height: 296});

  const ms = ytd.filter(x => M.months.includes(x));
  const mgS = (id, f) => ms.map(x => { const V = computeCol(T, "ALL", [x], f); return V.rev ? V[id] / V.rev : null; });
  lineChart($("#chMg", el), {labels: ms.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 380, series: [
    {name: "Warehouse operating margin", short: "WH operating", color: "var(--c1)", values: mgS("woi", "a")},
    {name: "Unadjusted net margin", short: "Net", color: "var(--c2)", values: mgS("uni", "a")},
    ...(hasBudget(y) ? [{name: "Budgeted net margin", short: "Net budget", color: "var(--bud)", dash: true, values: mgS("uni", "b")}] : [])],
    onClick: i => go("pl", () => Object.assign(st.pl, {mode: "month", actM: ms[i], layout: "soo", ent: "ALL"}))});

  const posH = gv.filter(x => x.imp > 500).sort((a, b) => b.imp - a.imp).slice(0, 2), negH = gv.filter(x => x.imp < -500).sort((a, b) => a.imp - b.imp).slice(0, 2);
  const others = gv.filter(x => Math.abs(x.imp) > 500 && !posH.includes(x) && !negH.includes(x)).sort((a, b) => Math.abs(b.imp) - Math.abs(a.imp));
  const ilist = [...posH, ...negH, ...others].slice(0, 6).map(x => ({...x, good: x.imp > 0}));
  const why = x => { const spec = grpSpec(x.g), dv = spec.t === "accts" ? drivers(spec, "ALL", [pm], [m]).filter(d => !/package/i.test(d.k)).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 2).filter(d => Math.abs(d.d) >= 300) : [];
    const acc = x.g.rows.map(r => ({r, v: r.t === "acct" ? accVal(r.a, "ALL", [m], "a") : virtVal(r.k, [m], "a"), p: r.t === "acct" ? accVal(r.a, "ALL", [pm], "a") : virtVal(r.k, [pm], "a")})).sort((p, q) => Math.abs(q.v - q.p) - Math.abs(p.v - p.p))[0];
    const a1 = acc && Math.abs(acc.v - acc.p) > 300 ? `${acc.r.label.replace(/^\d{4}(-\d{3})? · /, "")} ${fK(acc.v - acc.p, true)} vs ${ymLabel(pm)}` : "";
    return [a1, dv.length ? `driven by ${dv.map(d => `${d.k} (${fK(d.d, true)})`).join(", ")}` : ""].filter(Boolean).join("; "); };
  const gItem = gT > .5 ? `<li class="click" id="gtItem"><span class="ic gold">◆</span><div><div class="t">Unidentified growth target</div><div class="w">${fK(gT)} of the ${ymLabel(m)} revenue ${bName} is growth not yet tied to a customer (${growthByDiv([m]).map(([d, v]) => `${d} ${fK(v)}`).join(" · ")}), budgeted in Other Revenue. Other Revenue is compared without it.</div></div><div class="v muted">${fK(gT)}</div></li>` : "";
  $("#ins", el).innerHTML = gItem + ilist.map((x, i) => `<li class="click" data-i="${i}"><span class="ic ${x.good ? "good" : "bad"}">${x.good ? "▲" : "▼"}</span><div><div class="t">${esc(x.g.label)}</div><div class="w">${fK(x.a)} vs ${fK(x.b)} ${bName}${x.gt ? ` (excl. ${fK(x.gt)} growth target)` : ""}${why(x) ? " · " + esc(why(x)) : ""}</div></div><div class="v ${x.good ? "pos" : "neg"}">${fK(x.imp, true)}</div></li>`).join("") || `<li><div></div><div class="w">No material variances.</div><div></div></li>`;
  const gti = $("#gtItem", el); if (gti) gti.addEventListener("click", () => go("sales"));
  $$("#ins li[data-i]", el).forEach(li => li.addEventListener("click", () => { const x = ilist[+li.dataset.i]; drill(grpSpec(x.g), "ALL", [m], x.g.label); }));

  const divs = ["G1", "G2", "CW"].filter(e => Math.abs(val("rev", "std", e, [m], "a")) > .5 || Math.abs(val("rev", "std", e, [m], "b")) > .5);
  const dEl = $("#divs", el); dEl.classList.add(`g${Math.max(2, Math.min(divs.length, 3))}`);
  dEl.innerHTML = divs.map(e => { const V = computeCol("std", e, [m], "a"), Vb = basisCols(basis, [m]), VB = computeCol("std", e, Vb.ms, Vb.f), Y = computeCol("std", e, ytd, "a");
    const last = Array.from({length: 12}, (_, i) => addM(m, i - 11)), sv = last.map(x => M.months.includes(x) ? val("rev", "std", e, [x], "a") : null), sb = basis === "bud" ? last.map(x => val("rev", "std", e, [x], "b")) : null;
    return `<div class="card kpi" data-e="${e}"><div class="k-label"><span>${esc(ENTS[e])}</span><span class="tag ${tone(V.uni - VB.uni, 1)}" title="net income vs ${bName}">${fK(V.uni - VB.uni, true)} net</span></div>
      <div class="k-val">${fK(V.rev)}</div><div class="k-sub">revenue · ${fP(pctOf(V.rev, VB.rev), 1, true)} vs ${bShort}</div>
      <div class="stats s4" style="--n:4;margin-top:14px"><div class="stat"><div class="sl">Gross margin</div><div class="sv">${fP(V.rev ? V.gp / V.rev : null)}</div></div><div class="stat"><div class="sl">Net margin</div><div class="sv ${V.uni < 0 ? "neg" : ""}">${fP(V.rev ? V.uni / V.rev : null)}</div></div><div class="stat"><div class="sl">Net income</div><div class="sv ${V.uni < 0 ? "neg" : ""}">${fK(V.uni)}</div></div><div class="stat"><div class="sl">YTD net</div><div class="sv">${fK(Y.uni)}</div></div></div>
      <div class="k-spark">${sparkBars(sv, sb, 11)}</div></div>`; }).join("");
  $$("#divs .kpi", el).forEach(c => c.addEventListener("click", () => go("pl", () => Object.assign(st.pl, {layout: "std", ent: c.dataset.e, mode: "month", actM: m}))));

  const labA = (e, x, f) => accts(pre("5035", "5040", "5045")).reduce((s, a) => s + accVal(a, e, [x], f), 0);
  const lr = ms.map(x => { const r = val("rev", T, "ALL", [x], "a"); return r ? labA("ALL", x, "a") / r : null; }), lb = hasBudget(y) ? ms.map(x => { const r = val("rev", T, "ALL", [x], "b"); return r ? labA("ALL", x, "b") / r : null; }) : null;
  const pass = x => ["5035-006", "5045-003"].reduce((s, a) => s + accVal(a, "ALL", [x], "a"), 0), plRev = accVal("4010-005", "ALL", [m], "a"), ps = pass(m);
  const labEl = $("#lab", el);
  labEl.innerHTML = `<div class="stats" style="--n:3;margin-bottom:14px"><div class="stat"><div class="sl">% of revenue</div><div class="sv ${lb && lr.at(-1) > lb.at(-1) ? "neg" : ""}">${fP(lr.at(-1))}</div><div class="ss">${lb ? `budget ${fP(lb.at(-1))}` : "&nbsp;"}</div></div><div class="stat"><div class="sl">Billed labor</div><div class="sv">${fK(plRev)}</div><div class="ss">cost ${fK(ps)}</div></div><div class="stat"><div class="sl">Markup</div><div class="sv">${fP(ps ? (plRev - ps) / ps : null)}</div><div class="ss">weekend & project labor</div></div></div><div id="labCh"></div>`;
  lineChart($("#labCh", labEl), {labels: ms.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 200, series: [{name: "Labor % of revenue", short: "Actual", color: "var(--c1)", values: lr}, ...(lb ? [{name: "Budget", short: "Budget", color: "var(--bud)", dash: true, values: lb}] : [])]});

  const otp = (e, x) => { const reg = ["5035-001", "5040-001", "5045-001"].reduce((s, a) => s + accVal(a, e, [x], "a"), 0), ot = ["5035-002", "5040-002", "5045-002"].reduce((s, a) => s + accVal(a, e, [x], "a"), 0); return reg ? ot / reg : null; };
  const otEl = $("#ot", el), otv = ms.map(x => otp("ALL", x)), over = otv.filter(v => v > .08).length;
  otEl.innerHTML = `<div class="stats" style="--n:3;margin-bottom:14px"><div class="stat"><div class="sl">Consolidated</div><div class="sv ${otv.at(-1) > .08 ? "neg" : ""}">${fP(otv.at(-1))}</div><div class="ss">${ymLabel(m)} · of regular wages</div></div><div class="stat"><div class="sl">G1 · G2</div><div class="sv">${fP(otp("G1", m), 0)} · ${fP(otp("G2", m), 0)}</div><div class="ss">this month</div></div><div class="stat"><div class="sl">Above 8%</div><div class="sv">${over} of ${otv.filter(v => v != null).length}</div><div class="ss">months this year</div></div></div><div id="otCh"></div>`;
  lineChart($("#otCh", otEl), {labels: ms.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 200, ref: {value: .08, label: "8% norm"}, series: [{name: "G1", color: "var(--c1)", values: ms.map(x => otp("G1", x))}, {name: "G2", color: "var(--c2)", values: ms.map(x => otp("G2", x))}]});

  const frt = (e, xs) => { const rev = accts(pre("4020")).reduce((s, a) => s + accVal(a, e, xs, "a"), 0), exp = accts(pre("5010", "5011", "5012", "5013")).reduce((s, a) => s + accVal(a, e, xs, "a"), 0);
    const ef = accts(a => /^501[0-3]-00[23]$/.test(a)).reduce((s, a) => s + accVal(a, e, xs, "a"), 0), inj = accts(a => /^501[0-3]-003$/.test(a)).reduce((s, a) => s + accVal(a, e, xs, "a"), 0);
    const ta = xs.reduce((s, x) => s + (((cfgx().freightTimingAdj || {})[x] || {})[e] || 0), 0), adj = exp - ef + ta; return {rev, exp, inj, mk: exp ? (rev - exp) / exp : null, amk: adj ? (rev - adj) / adj : null}; };
  const fd = ["G1", "G2"].map(d => [d, frt(d, [m]), frt(d, ytd)]);
  $("#frt", el).innerHTML = `<div class="stats" style="--n:2;margin-bottom:16px">${fd.map(([d, a, b]) => `<div class="stat"><div class="sl">${d} adjusted markup</div><div class="sv">${fP(a.amk)}</div><div class="ss">${ymLabel(m)} · YTD ${fP(b.amk)} · unadjusted ${fP(a.mk)}</div></div>`).join("")}</div><div id="frCh" style="margin-bottom:14px"></div>
    <table class="data" style="min-width:0"><thead><tr><th>${ymLabel(m)}</th><th class="num">Freight revenue</th><th class="num">Freight cost</th><th class="num">Shipping errors</th><th class="num">YTD errors</th></tr></thead><tbody>${fd.map(([d, a, b]) => `<tr><td><b>${d}</b></td><td class="num">${fN(a.rev)}</td><td class="num">${fN(a.exp)}</td><td class="num">${fN(a.inj)}</td><td class="num">${fN(b.inj)}</td></tr>`).join("")}</tbody></table>`;

  lineChart($("#frCh", el), {labels: ms.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 170, series: [{name: "G1 adjusted markup", short: "G1", color: "var(--c1)", values: ms.map(x => frt("G1", [x]).amk)}, {name: "G2 adjusted markup", short: "G2", color: "var(--c2)", values: ms.map(x => frt("G2", [x]).amk)}]});
  const sm = salesBy(m, "ALL", true), sp = salesBy(pm, "ALL", true), keys = new Set([...sm.keys(), ...sp.keys()]);
  const mv = [...keys].map(k => ({label: k, v: (sm.get(k) || 0) - (sp.get(k) || 0), now: sm.get(k) || 0})).sort((a, b) => b.v - a.v);
  const ups = mv.filter(x => x.v > 0).slice(0, 5), dns = mv.filter(x => x.v < 0).slice(-5).reverse();
  const hu = bullets(ups.map(x => ({label: x.label, v: x.v, color: "var(--good)", note: fK(x.now)})), {fmt: v => fK(v, true), onClick: it => customerDrawer(it.label), head: ["Increases", "Change", `${ymLabel(m)} sales`]}),
        hd = bullets(dns.map(x => ({label: x.label, v: x.v, color: "var(--bad)", note: fK(x.now)})), {fmt: v => fK(v, true), onClick: it => customerDrawer(it.label), head: ["Decreases", "Change", `${ymLabel(m)} sales`]});
  $("#movers", el).innerHTML = `<div class="bullets" id="mvU">${ups.length ? hu.html : '<span class="muted">No increases</span>'}</div><div style="height:18px"></div><div class="bullets" id="mvD">${dns.length ? hd.html : '<span class="muted">No decreases</span>'}</div>`;
  hu.bind($("#mvU", el)); hd.bind($("#mvD", el));

  const cap = cfgx().capacity || {}, poh = (cfgx().palletsOnHand || {})[m], capRows = Object.keys(cap).filter(d => (cap[d].rack || 0) + (cap[d].bulk || 0) > 0);
  if (!poh) $("#cap", el).innerHTML = `<div class="stats" style="--n:${Math.max(1, capRows.length)}">${capRows.map(d => `<div class="stat"><div class="sl">${d} capacity</div><div class="sv">${fN((cap[d].rack || 0) + (cap[d].bulk || 0))}</div><div class="ss">pallet positions</div></div>`).join("")}</div><p class="note">Pallet counts aren't stored in Sage. Add the ${ymLabel(m, true)} counts under <a href="#" id="toAdm">Inputs</a> to show utilization here.</p>`;
  else { const cb = bullets(capRows.map(d => { const c = (cap[d].rack || 0) + (cap[d].bulk || 0), o = ((poh[d] || {}).rack || 0) + ((poh[d] || {}).bulk || 0); return {label: `${d} · ${fN(o)} of ${fN(c)}`, v: c ? o / c : 0, t: .85}; }), {fmt: v => fP(v, 0), good: -1, head: ["Building", "Utilization", "vs 85%"]});
    $("#cap", el).innerHTML = `<div class="bullets">${cb.html}</div><p class="note">The marker shows an 85% comfort line.</p>`; }
  const ta = $("#toAdm", el); if (ta) ta.addEventListener("click", e => { e.preventDefault(); go("admin"); });
  arSummary($("#arSum", el));
};

/* ------------------------------------------------ INCOME STATEMENT */
views.pl = el => {
  const p = st.pl, m = st.rep; p.actM ||= m;
  if (p.layout === "soo") p.ent = "ALL";
  const yy = p.actM.slice(0, 4), ents = ["ALL", "G1", "G2", "CW"].filter(e => e === "ALL" || Math.abs(val("rev", "std", e, monthsThrough(p.actM), "a")) > .5);
  if (!ents.includes(p.ent)) p.ent = "ALL";
  if (p.mode === "heat" && !hasBudget(yy)) p.mode = "month";
  const T = p.layout, ent = p.ent, ms = p.mode === "month" ? [p.actM] : monthsThrough(p.actM);
  const okB = b => (p.mode === "month" || b !== "pm") && basisAvailable(b, ms);
  if (!p.basis || !okB(p.basis)) p.basis = ["bud", "py", "pm"].find(okB) || "bud";
  const bc = basisCols(p.basis, ms), bLabel = p.mode === "month" ? (p.basis === "bud" ? `${ymLabel(p.actM)} Budget` : `${ymLabel(bc.ms[0])} Actual`) : (p.basis === "bud" ? "YTD Budget" : `YTD ${bc.ms[0].slice(0, 4)}`);
  const stmt = T === "soo" ? "Statement of Operations" : "Income Statement";
  const sub = p.mode === "month" ? `${ymLabel(p.actM, true)} · actual vs ${p.basis === "bud" ? "budget" : ymLabel(bc.ms[0], true)}` : p.mode === "ytd" ? `Year to date through ${ymLabel(p.actM, true)} · vs ${BASIS[p.basis].toLowerCase()}` : p.mode === "trend" ? `Month by month · ${ymLabel(ms[0], true)} – ${ymLabel(p.actM, true)}` : `Variance to budget by month · ${yy}`;
  setTitle(`Income statement · ${ENTS_S[ent]}`, stmt);
  const mOpts = [...M.months].reverse().map(x => `<option value="${x}" ${x === p.actM ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  const heat = p.mode === "heat";
  el.innerHTML = `<div class="toolbar tight inl">
      <div class="seg" id="lay"><button data-v="soo" aria-pressed="${T === "soo"}">Statement of Operations</button><button data-v="std" aria-pressed="${T === "std"}">Standard P&L</button></div>
      ${T === "std" ? `<div class="seg" id="ent">${ents.map(e => `<button data-v="${e}" aria-pressed="${e === ent}">${ENTS_S[e]}</button>`).join("")}</div>` : ""}
      <div class="seg" id="mode"><button data-v="month" aria-pressed="${p.mode === "month"}">Month</button><button data-v="ytd" aria-pressed="${p.mode === "ytd"}" title="Year to date">YTD</button><button data-v="trend" aria-pressed="${p.mode === "trend"}" title="Month-by-month trend">Trend</button>${hasBudget(yy) ? `<button data-v="heat" aria-pressed="${heat}" title="Variance to budget by month">Heatmap</button>` : ""}</div>
      <label class="ctl"><span>${p.mode === "month" ? "" : "Through"}</span><select id="am" aria-label="Month">${mOpts}</select></label>
      ${p.mode === "month" || p.mode === "ytd" ? `<label class="ctl"><span>vs</span><select id="bs" aria-label="Compare to">${["bud", "py", "pm"].filter(b => p.mode === "month" || b !== "pm").map(b => `<option value="${b}" ${b === p.basis ? "selected" : ""} ${okB(b) ? "" : "disabled"}>${BASIS[b]}${okB(b) ? "" : " · no data"}</option>`).join("")}</select></label>` : ""}
      <span class="sp"></span>
      <div class="acts">${heat ? "" : `<button class="btn sm" id="xlsx" title="Excel workbook with formulas">⤓ Excel</button><button class="btn sm" id="pdf" title="Formatted statement">⤓ PDF</button>`}</div>
    </div>
    <div class="stmt">${heat ? `<div class="stmt-h"><div class="stmt-t"><h2>${esc(ENTS[ent])}</h2><div class="lede">${esc(sub)}</div></div></div>` : ""}
      <div class="fs-wrap" id="fsw"></div>
    </div>
    <p class="note" id="fsnote">${heat ? "" : `Click a category to expand it. Click any actual amount for the journal lines behind it. ${T === "soo" ? "Customer Care and Warehouse Manager pay is a direct operating cost; the rest of office pay is allocated overhead. " : ""}${p.basis === "bud" && p.mode !== "trend" ? "Budgets are compared at the category level, as in the monthly package." : ""}`}</p>`;
  const L = layoutDef(T, ent);
  const wire = () => {
    $$("#lay button", el).forEach(b => b.addEventListener("click", () => { p.layout = b.dataset.v; views.pl(el); }));
    $$("#ent button", el).forEach(b => b.addEventListener("click", () => { p.ent = b.dataset.v; views.pl(el); }));
    $$("#mode button", el).forEach(b => b.addEventListener("click", () => { p.mode = b.dataset.v; views.pl(el); }));
    $("#am", el).addEventListener("change", async e => { p.actM = e.target.value; await ensureYears([p.actM.slice(0, 4), String(+p.actM.slice(0, 4) - 1)]); resetCaches(); views.pl(el); });
    const bs = $("#bs", el); if (bs) bs.addEventListener("change", e => { p.basis = e.target.value; views.pl(el); });
    const z = $("#zeros", el); if (z) z.addEventListener("change", e => { p.zeros = e.target.checked; views.pl(el); });
  };
  if (heat) { wire(); heatmap($("#fsw", el), T, ent, monthsThrough(p.actM), el); return; }

  let cols;
  if (p.mode === "month" || p.mode === "ytd") cols = [{h: p.mode === "month" ? `${ymLabel(p.actM)} Actual` : "YTD Actual", ms, f: "a", click: true, act: true}, {h: bLabel, ms: bc.ms, f: bc.f, cmp: true}, {h: "Variance", v: [0, 1], bar: true, cls: "sep"}, {h: "Var %", vp: [0, 1]}, {h: "% of Rev", pr: 0, cls: "sep"}]
    .concat(p.mode === "ytd" && hasBudget(yy) ? [{h: `FY ${yy} Budget`, ms: yearMonths(yy), f: "b", cls: "sep", fy: true}] : []);
  else { const yt = monthsThrough(p.actM); cols = yt.map(x => ({h: MN[+x.slice(5) - 1], ms: [x], f: "a", click: true, mon: true})).concat([{h: "YTD Actual", hs: "YTD", ms: yt, f: "a", click: true, cls: "sep", ytd: true}, ...(hasBudget(yy) ? [{h: "YTD Budget", hs: "Budget", ms: yt, f: "b"}, {h: "Variance", hs: "Var.", v: [yt.length, yt.length + 1]}] : [])]); }
  const data = cols.map(c => c.ms ? computeCol(T, ent, c.ms, c.f) : null);
  const isZero = id => data.every(d => !d || Math.abs(d[id] || 0) < .5);
  const budC = c => c.f === "b" || (c.cmp && p.basis === "bud"), isZeroD = id => data.every((d, i) => !d || budC(cols[i]) || Math.abs(d[id] || 0) < .5);
  const gtOn = p.basis === "bud" && p.mode !== "trend" && growthTarget(bc.ms, ent) > .5;
  const rows = stmtRows(L, isZero, p.zeros, p.mode === "trend", isZeroD, gtOn ? {rv_ot: "Incl. unidentified growth target (budget only)"} : {});
  const ctx = {T, ent, stmt, sub, cols, data, rows, mode: p.mode, actM: p.actM, basis: p.basis, open: p.open};
  const box = $("#fsw", el);
  const lblW = p.mode === "trend" ? 230 : 0, wt = c => c.mon || p.mode !== "trend" ? 1 : 1.45, unitW = (box.clientWidth - (lblW || box.clientWidth * .34)) / cols.reduce((s, c) => s + wt(c), 0);
  const kMode = p.mode === "trend" && unitW < 66;
  const num = v => kMode ? fNk(v) : fN(v);
  const vIdx = cols.findIndex(c => c.bar), maxVar = vIdx < 0 ? 1 : Math.max(1, ...rows.filter(r => r.kind === "grp").map(r => Math.abs((data[0][r.id] || 0) - (data[1][r.id] || 0))));
  const cellH = (c, i, row) => {
    const cv = stmtCell(ctx, c, i, row), cl = c.cls || "";
    if (cv.blank) return `<td class="${cl}"></td>`;
    if (cv.dash) return `<td class="dim ${cl}">–</td>`;
    if (cv.k === "var") { const t = tone(cv.v, row.good ?? 1), w = Math.min(50, Math.abs(cv.v) / maxVar * 50);
      const bar = c.bar ? `<span class="vbar"><span style="${cv.v * (row.good ?? 1) >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`};background:var(--${t === "bad" ? "bad" : t === "good" ? "good" : "faint"})"></span></span>` : "";
      return `<td class="${cl}"><div class="vb"><span class="${cls(t)}">${Math.abs(cv.v) < .5 ? "–" : num(cv.v)}</span>${bar}</div></td>`; }
    if (cv.k === "vp") return `<td class="${cls(tone(cv.d, row.good ?? 1))} ${cl}">${cv.v == null ? "–" : fP(cv.v, 1, true)}</td>`;
    if (cv.k === "pr") return `<td class="muted ${cl}">${cv.v == null ? "–" : fP(cv.v)}</td>`;
    if (cv.k === "pct") return `<td class="${cl}">${fP(cv.v)}</td>`;
    if (cv.k === "pts") return `<td class="${cl}"><span class="${cv.v >= 0 ? "pos" : "neg"}">${fPts(cv.v)}</span></td>`;
    return `<td class="${cl} ${c.click && cv.click ? "c" : ""}" data-col="${i}">${num(cv.v)}</td>`;
  };
  let h = `<colgroup><col class="lbl" ${lblW ? `style="width:${lblW}px"` : ""}>${cols.map(c => `<col ${c.bar ? 'class="vcol"' : p.mode === "trend" ? `style="width:${Math.floor(unitW * wt(c))}px"` : ""}>`).join("")}</colgroup><thead><tr><th class="ttl"><div class="t1"><span>${esc(ENTS[ent])}</span><span class="tl"><button class="lnk" id="exp">Expand all</button><button class="lnk" id="col">Collapse all</button><label class="lnk"><input type="checkbox" id="zeros" ${p.zeros ? "checked" : ""}>Zero lines</label></span></div><div class="t2">${esc(sub)}${kMode ? " · $ in thousands" : ""}</div></th>${cols.map(c => `<th class="${c.cls || ""}" title="${esc(c.h)}">${esc(p.mode === "trend" && c.hs ? c.hs : c.h)}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach((r, ri) => {
    const open = r.parent ? p.open.has(r.parent) : false;
    if (r.kind === "sec") h += `<tr class="sec"><td colspan="${cols.length + 1}">${esc(r.label)}</td></tr>`;
    else if (r.kind === "grp") h += `<tr class="grp ${p.open.has(r.id) ? "open" : ""}" data-g="${r.id}" data-ri="${ri}"><td title="${esc(r.label)}"><span class="tw">▸</span>${esc(r.label)}</td>${cols.map((c, i) => cellH(c, i, r)).join("")}</tr>`;
    else if (r.kind === "subh") h += `<tr class="ch subh ${open ? "" : "hide"}" data-p="${r.parent}"><td colspan="${cols.length + 1}">${esc(r.label)}</td></tr>`;
    else if (r.kind === "acct" || r.kind === "subt" || r.kind === "gtot") h += `<tr class="ch ${r.kind} ${r.depth === 2 ? "d2" : ""} ${open ? "" : "hide"}" data-p="${r.parent}" data-ri="${ri}"><td title="${esc(r.label)}">${esc(r.label)}</td>${cols.map((c, i) => cellH(c, i, r)).join("")}</tr>`;
    else if (r.kind === "tot") h += `<tr class="tot ${r.cls}" data-ri="${ri}"><td>${esc(r.label)}</td>${cols.map((c, i) => cellH(c, i, r)).join("")}</tr>`;
    else if (r.kind === "pct") h += `<tr class="pct"><td>${esc(r.label)}</td>${cols.map((c, i) => cellH(c, i, r)).join("")}</tr>`;
    else if (r.kind === "note") h += `<tr class="note"><td title="The revenue budget holds the unidentified / spec growth target in Other Revenue; it isn't tied to a customer.">${esc(r.label)}</td>${cols.map((c, i) => cellH(c, i, r)).join("")}</tr>`;
  });
  box.innerHTML = `<table class="fs ${p.mode === "trend" ? "trend" : ""}">${h}</tbody></table>`;
  const fs = $("table", box);
  if (T === "soo" && ms.some(x => officeComp(x).unsplit)) $("#fsnote", el).textContent += " Before 2026 the Customer Care / Management split isn't available, so all office pay shows in overhead for those months.";
  // density: when the statement can fit on screen, size rows so Revenue → Net Income is visible without scrolling
  const fit = () => { const vis = $$("tbody tr", fs).filter(r => !r.classList.contains("hide")).length, top = fs.getBoundingClientRect().top + window.scrollY, th = $("thead", fs).offsetHeight;
    const avail = window.innerHeight - top - th - 14, rh = Math.floor(avail / Math.max(1, vis));
    fs.style.setProperty("--rh", `${rh >= 18 ? Math.min(rh, 30) : 28}px`); fs.classList.toggle("dense", rh >= 18 && rh < 24); };
  const toggle = (g, on, noFit) => { const tr = $(`tr.grp[data-g="${g}"]`, fs); if (!tr) return; on ??= !tr.classList.contains("open"); tr.classList.toggle("open", on); on ? p.open.add(g) : p.open.delete(g); $$(`tr.ch[data-p="${g}"]`, fs).forEach(r => r.classList.toggle("hide", !on)); if (!noFit) fit(); };
  $$("tr.grp td:first-child", fs).forEach(td => td.addEventListener("click", () => toggle(td.parentElement.dataset.g)));
  $$("tr.gtot td:first-child", fs).forEach(td => td.addEventListener("click", () => toggle(td.parentElement.dataset.p)));
  $$("td.c", fs).forEach(td => td.addEventListener("click", () => { const r = rows[+td.parentElement.dataset.ri], sp = rowSpec(r); if (sp) drill(sp, ent, cols[+td.dataset.col].ms, r.kind === "gtot" || r.kind === "subt" ? r.label.replace(/^Total /, "") : r.label); }));
  wire(); fit();
  if (views.pl._rs) window.removeEventListener("resize", views.pl._rs);
  views.pl._rs = () => { if (st.view === "pl" && document.body.contains(fs)) fit(); }; window.addEventListener("resize", views.pl._rs);
  $("#exp", el).addEventListener("click", () => { L.filter(i => i.k === "grp").forEach(i => toggle(i.id, true, true)); fit(); });
  $("#col", el).addEventListener("click", () => { L.filter(i => i.k === "grp").forEach(i => toggle(i.id, false, true)); fit(); });
  const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = "Preparing…"; try { await fn(); } catch (e) { alertBanner(`Export failed: ${e.message || e}`); } finally { btn.disabled = false; btn.textContent = t; } };
  $("#xlsx", el).addEventListener("click", e => busy(e.currentTarget, () => exportExcel(ctx)));
  $("#pdf", el).addEventListener("click", e => busy(e.currentTarget, () => exportPdf(ctx)));
};

/* ---------- statement model shared by the screen, Excel and PDF */
const fNk = v => { if (v == null || !isFinite(v) || Math.abs(v) < 50) return "–"; const s = Math.abs(v / 1000).toLocaleString("en-US", {minimumFractionDigits: 1, maximumFractionDigits: 1}); return v < 0 ? `(${s})` : s; };
function stmtRows(L, isZero, zeros, withPct, isZeroD = isZero, notes = {}) {
  const out = [], vis = r => zeros || !(r.t === "acct" ? isZeroD(r.id) : isZero(r.id));
  for (const it of L) {
    if (it.k === "sec") out.push({kind: "sec", label: it.label});
    else if (it.k === "grp") {
      if (!zeros && isZero(it.id) && it.rows.every(r => isZero(r.id))) continue;
      const g = it.id, good = it.good, ar = (r, depth) => ({kind: "acct", id: r.id, label: r.label, parent: g, depth, r, good});
      out.push({kind: "grp", id: g, label: it.label, good, it});
      if (it.subs && it.subs.length) {
        for (const sb of it.subs) { const rs = it.rows.filter(r => r.sg === sb.id && vis(r)); if (!rs.length) continue;
          out.push({kind: "subh", id: sb.id + ":h", label: sb.label, parent: g});
          rs.forEach(r => out.push(ar(r, 2)));
          out.push({kind: "subt", id: sb.id, label: `Total ${sb.label}`, parent: g, good, list: rs.filter(r => r.t === "acct").map(r => r.a), depth: 1}); }
        it.rows.filter(r => !r.sg && vis(r)).forEach(r => out.push(ar(r, 1)));
      } else it.rows.filter(vis).forEach(r => out.push(ar(r, 1)));
      out.push({kind: "gtot", id: g, label: `Total ${it.label}`, parent: g, good, it});
      if (notes[g]) out.push({kind: "note", id: g + ":note", label: notes[g], good});
    } else if (it.k === "tot") out.push({kind: "tot", id: it.id, label: it.label, good: it.good, cls: it.cls || "", parts: it.parts});
    else if (it.k === "pct" && withPct) out.push({kind: "pct", label: it.label, num: it.num, den: it.den});
  }
  return out;
}
const rowSpec = r => r.kind === "grp" || r.kind === "gtot" ? grpSpec(r.it) : r.kind === "subt" ? {t: "accts", list: r.list} : r.kind === "acct" ? r.r : null;
/* value of one cell: {k: amt|var|vp|pr|pct|pts, v} or {blank}/{dash} */
function stmtCell(ctx, c, i, row) {
  const {cols, data, basis} = ctx, id = row.id;
  if (row.kind === "sec" || row.kind === "subh") return {blank: true};
  if (row.kind === "note") return c.ms && (c.f === "b" || (c.cmp && basis === "bud")) ? {k: "amt", v: growthTarget(c.ms, ctx.ent), click: false} : {blank: true};
  if (row.kind === "pct") {
    if (c.ms) return {k: "pct", v: data[i][row.den] ? data[i][row.num] / data[i][row.den] : null};
    if (c.v) { const a = data[c.v[0]], b = data[c.v[1]]; return {k: "pts", v: (a[row.den] ? a[row.num] / a[row.den] : 0) - (b[row.den] ? b[row.num] / b[row.den] : 0)}; }
    return {blank: true}; }
  const budCol = cc => cc.f === "b" || (cc.cmp && basis === "bud");
  const det = row.kind === "subt" || (row.kind === "acct" && (row.r.nb || row.r.t === "acct"));
  if (det && budCol(c) && c.ms) return {dash: true};
  if (det && (c.v || c.vp) && budCol(cols[(c.v || c.vp)[1]])) return {blank: true};
  if (c.v) return {k: "var", v: (data[c.v[0]][id] || 0) - (data[c.v[1]][id] || 0)};
  if (c.vp) { const a = data[c.vp[0]][id] || 0, b = data[c.vp[1]][id] || 0; return {k: "vp", v: Math.abs(b) > .5 ? pctOf(a, b) : null, d: a - b}; }
  if (c.pr != null) { const rv = data[c.pr].rev || 0, a = data[c.pr][id] || 0; return {k: "pr", v: rv && Math.abs(a) > .5 ? a / rv : null}; }
  return {k: "amt", v: data[i][id] || 0, click: row.kind !== "tot"};
}
function alertBanner(msg) { const b = document.createElement("div"); b.className = "banner"; b.textContent = msg; $("#banners").prepend(b); setTimeout(() => b.remove(), 9000); }
function loadLib(name, urls, test) {
  if (test()) return Promise.resolve();
  return urls.reduce((pr, u) => pr.then(() => test() ? null : new Promise(ok => { const s = document.createElement("script"); s.src = u; s.onload = ok; s.onerror = ok; document.head.appendChild(s); })), Promise.resolve())
    .then(() => { if (!test()) throw new Error(`${name} couldn't be loaded (check the internet connection)`); });
}
const libExcel = () => loadLib("The Excel library", ["https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"], () => window.ExcelJS);
const libPdf = () => loadLib("The PDF library", ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js", "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"], () => window.jspdf);
let LOGO = null;
async function logoData() { if (LOGO) return LOGO;
  const b = await (await fetch("logo.png")).blob(), url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = url; }); return (LOGO = {url, w: img.naturalWidth, h: img.naturalHeight}); }
function periodLine(ctx) { const [y, mo] = ctx.actM.split("-").map(Number), end = `${MNL[mo - 1]} ${new Date(y, mo, 0).getDate()}, ${y}`;
  if (ctx.mode === "month") return `For the Month Ended ${end}`;
  const W = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  return mo === 12 ? `For the Year Ended ${end}` : `For the ${W[mo - 1]} Months Ended ${end}`; }
const fileStem = ctx => `GFS ${ctx.stmt} - ${ENTS_S[ctx.ent]} - ${ctx.mode === "month" ? ymLabel(ctx.actM, true) : ctx.mode === "ytd" ? "YTD " + ymLabel(ctx.actM, true) : "Trend " + ctx.actM.slice(0, 4)}`;
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]/g, "-"); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

/* ExcelJS writes <pageSetUpPr> before <outlinePr> inside <sheetPr>; Excel requires the reverse order and
   rejects the sheet otherwise, so the sheet XML is put into schema order before saving. */
const libZip = () => loadLib("The zip library", ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"], () => window.JSZip);
async function fixXlsx(buf) {
  await libZip(); const zip = await JSZip.loadAsync(buf);
  for (const f of Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    let x = await zip.file(f).async("string");
    x = x.replace(/<sheetPr>(.*?)<\/sheetPr>/, (m, inner) => { const tab = (inner.match(/<tabColor[^>]*\/>/) || [""])[0], out = (inner.match(/<outlinePr[^>]*\/>/) || [""])[0], pg = (inner.match(/<pageSetUpPr[^>]*\/>/) || [""])[0]; return `<sheetPr>${tab}${out}${pg}</sheetPr>`; })
      .replace(/outlineLevelRow="0"/, `outlineLevelRow="${Math.max(0, ...[...x.matchAll(/outlineLevel="(\d)"/g)].map(m => +m[1]))}"`)
      .replace(/<row ([^>]*?) collapsed="1"/g, "<row $1");
    zip.file(f, x); }
  return zip.generateAsync({type: "arraybuffer", compression: "DEFLATE"});
}
/* ---------- Excel: every group expanded with Excel outline buttons; subtotals and totals are formulas */
async function exportExcel(ctx) {
  await libExcel();
  const {cols, rows, data} = ctx, wb = new ExcelJS.Workbook(); wb.creator = "GFS Financials Dashboard";
  const land = ctx.mode === "trend" || cols.length > 6;
  const ws = wb.addWorksheet(ENTS_S[ctx.ent], {views: [{state: "frozen", ySplit: 7, showGridLines: false}],
    pageSetup: {orientation: land ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: {left: .5, right: .5, top: .6, bottom: .6, header: .3, footer: .3}, printTitlesRow: "7:7"},
    properties: {outlineLevelRow: 2}});
  ws.headerFooter.oddFooter = `&L&8GFS Logistics · ${ctx.stmt}&C&8Page &P of &N&R&8Prepared from Sage Intacct`;
  const F = "Arial", NF = '#,##0_);(#,##0);"–"_)', PF = '0.0%_);(0.0%);"–"_)', last = cols.length + 1, colL = n => ws.getColumn(n).letter;
  ws.getColumn(1).width = ctx.mode === "trend" ? 44 : 52; cols.forEach((c, i) => ws.getColumn(i + 2).width = c.mon ? 12 : c.vp || c.pr != null ? 10 : 15);
  try { const lg = await logoData(); const id = wb.addImage({base64: lg.url, extension: "png"}); ws.addImage(id, {tl: {col: 0, row: 0}, ext: {width: 150, height: 150 * lg.h / lg.w}}); } catch {}
  const title = (r, text, sz, bold, italic) => { ws.mergeCells(r, 1, r, last); const c = ws.getCell(r, 1); c.value = text; c.font = {name: F, size: sz, bold, italic, color: {argb: "FF0B1F3A"}}; c.alignment = {horizontal: "center"}; };
  title(1, "GFS Logistics", 14, true); title(2, ctx.stmt, 12, true); title(3, ENTS[ctx.ent], 10); title(4, periodLine(ctx), 10, false, true);
  title(5, "(Unaudited)", 8, false, true); ws.getRow(1).height = 22;
  const HR = 7, hr = ws.getRow(HR); hr.getCell(1).value = ""; cols.forEach((c, i) => { const cl = hr.getCell(i + 2); cl.value = c.h; cl.font = {name: F, size: 9, bold: true}; cl.alignment = {horizontal: "right", wrapText: true}; cl.border = {bottom: {style: "thin"}}; });
  hr.getCell(1).border = {bottom: {style: "thin"}}; hr.height = 26;
  // Excel rows: everything expanded (collapsed groups are folded with the outline buttons)
  const out = rows.filter(r => r.kind !== "pct" || true), rowOf = {}, gStart = {}, sStart = {};
  let R = HR + 1; const pending = [];
  const amtIdx = cols.map((c, i) => c.ms ? i : -1).filter(i => i >= 0), actIdx = cols.findIndex(c => c.act || c.ytd), revRow = () => rowOf["tot:rev"];
  for (const r of out) {
    const xr = ws.getRow(R), lab = xr.getCell(1); lab.value = r.label; lab.font = {name: F, size: 9};
    const ind = r.kind === "acct" ? (r.depth === 2 ? 3 : 2) : r.kind === "subh" || r.kind === "subt" ? 1 : 0; lab.alignment = {indent: ind};
    if (r.kind === "sec") { lab.value = r.label.toUpperCase(); lab.font = {name: F, size: 8.5, bold: true, color: {argb: "FF5B6B80"}}; if (R > HR + 1) ws.getRow(R).height = 18; }
    if (r.kind === "grp") { lab.font = {name: F, size: 9, bold: true}; gStart[r.id] = R + 1; xr.outlineLevel = 1; if (!ctx.open.has(r.id)) xr.hidden = true; }
    if (r.kind === "subh") { lab.font = {name: F, size: 9, italic: true}; sStart[r.id.replace(/:h$/, "")] = R + 1; }
    if (r.kind === "acct" || r.kind === "subh" || r.kind === "subt") { xr.outlineLevel = r.depth === 2 && r.kind === "acct" ? 2 : 1; if (!ctx.open.has(r.parent)) xr.hidden = true; }
    if (r.kind === "subt" || r.kind === "gtot") lab.font = {name: F, size: 9, bold: r.kind === "gtot"};
    if (r.kind === "tot") lab.font = {name: F, size: 9.5, bold: true};
    if (r.kind === "gtot") rowOf["g:" + r.id] = R; if (r.kind === "tot") rowOf["tot:" + r.id] = R; if (r.kind === "subt") rowOf["s:" + r.id] = R;
    pending.push([R, r]); R++;
  }
  const ref = (key, ci) => rowOf[key] ? `${colL(ci + 2)}${rowOf[key]}` : "0";
  const partRef = (id, ci) => rowOf["g:" + id] ? ref("g:" + id, ci) : rowOf["tot:" + id] ? ref("tot:" + id, ci) : "0";
  for (const [Rr, r] of pending) {
    if (r.kind === "sec" || r.kind === "subh" || r.kind === "grp") continue;
    const xr = ws.getRow(Rr);
    if (r.kind === "note") { xr.getCell(1).font = {name: F, size: 8.5, italic: true, color: {argb: "FF6B7A90"}}; xr.getCell(1).alignment = {indent: 2};
      cols.forEach((c, i) => { const cv = stmtCell(ctx, c, i, r); if (cv.k === "amt") { const cl = xr.getCell(i + 2); cl.value = r2(cv.v); cl.numFmt = NF; cl.font = {name: F, size: 8.5, italic: true, color: {argb: "FF6B7A90"}}; } }); continue; }
    cols.forEach((c, i) => {
      const cell = xr.getCell(i + 2), L1 = colL(i + 2); cell.font = {name: F, size: 9, bold: r.kind === "tot" || r.kind === "gtot"};
      if (r.kind === "pct") { if (c.ms) { const n = partRef(r.num, i), d = partRef(r.den, i); cell.value = {formula: `IF(${d}=0,"",${n}/${d})`}; cell.numFmt = PF; cell.font = {name: F, size: 8.5, italic: true}; } return; }
      const cv = stmtCell(ctx, c, i, r); if (cv.blank || cv.dash) return;
      if (c.ms) {
        if (r.kind === "acct") cell.value = r2(cv.v);
        else if (r.kind === "subt") cell.value = {formula: `SUM(${L1}${sStart[r.id]}:${L1}${Rr - 1})`, result: r2(cv.v)};
        else if (r.kind === "gtot") { const subs = pending.filter(([, x]) => x.kind === "subt" && x.parent === r.id), loose = pending.filter(([, x]) => x.kind === "acct" && x.parent === r.id && x.depth === 1);
          const budOnly = c.f === "b" || (c.cmp && ctx.basis === "bud");
          if (budOnly) cell.value = r2(cv.v);
          else if (subs.length) cell.value = {formula: [...subs, ...loose].map(([q]) => `${L1}${q}`).join("+"), result: r2(cv.v)};
          else cell.value = {formula: `SUM(${L1}${gStart[r.id]}:${L1}${Rr - 1})`, result: r2(cv.v)}; }
        else if (r.kind === "tot") cell.value = {formula: r.parts.map(([id, sg], k) => `${sg < 0 ? "-" : k ? "+" : ""}${partRef(id, i)}`).join(""), result: r2(cv.v)};
        if (c.ytd && r.kind !== "tot") { const ms = cols.map((x, k) => x.mon ? k : -1).filter(k => k >= 0); if (ms.length) cell.value = {formula: `SUM(${colL(ms[0] + 2)}${Rr}:${colL(ms.at(-1) + 2)}${Rr})`, result: r2(cv.v)}; }
        cell.numFmt = NF;
      } else if (c.v) { cell.value = {formula: `${colL(c.v[0] + 2)}${Rr}-${colL(c.v[1] + 2)}${Rr}`, result: r2(cv.v)}; cell.numFmt = NF; }
      else if (c.vp) { const a = `${colL(c.vp[0] + 2)}${Rr}`, b = `${colL(c.vp[1] + 2)}${Rr}`; cell.value = {formula: `IF(${b}=0,"",(${a}-${b})/ABS(${b}))`}; cell.numFmt = PF; }
      else if (c.pr != null && revRow()) { const a = `${colL(c.pr + 2)}${Rr}`, rv = `$${colL(c.pr + 2)}$${revRow()}`; cell.value = {formula: `IF(${rv}=0,"",${a}/${rv})`}; cell.numFmt = PF; }
      cell.alignment = {horizontal: "right"};
      if (r.kind === "subt" || r.kind === "gtot" || r.kind === "tot") cell.border = {top: {style: "thin"}};
      if (r.kind === "tot" && r.cls === "final") cell.border = {top: {style: "thin"}, bottom: {style: "double"}};
    });
    if (r.kind === "tot" && r.cls) xr.eachCell({includeEmpty: true}, (cl, n) => { if (n <= last) cl.fill = {type: "pattern", pattern: "solid", fgColor: {argb: r.cls === "final" ? "FFDCE6F2" : "FFF1F5FA"}}; });
  }
  const nr = ws.getRow(R + 1).getCell(1); nr.value = `Prepared from the Sage Intacct general ledger on ${new Date().toLocaleDateString("en-US", {month: "long", day: "numeric", year: "numeric"})}. ${ctx.basis === "bud" && ctx.mode !== "trend" ? "Budgets are compared at the category level." : ""}`; nr.font = {name: F, size: 8, italic: true, color: {argb: "FF6B7A90"}};
  let buf = await wb.xlsx.writeBuffer();
  buf = await fixXlsx(buf);
  saveBlob(new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), fileStem(ctx) + ".xlsx");
}

/* ---------- PDF: auditor-style statement; one portrait page when it fits, otherwise landscape without splitting a group */
async function exportPdf(ctx) {
  await libPdf();
  const {cols} = ctx, rows = ctx.rows.filter(r => r.kind === "sec" || r.kind === "grp" || r.kind === "tot" || r.kind === "pct" || r.kind === "note" || ctx.open.has(r.parent));
  const shown = rows.map(r => r.kind === "grp" && ctx.open.has(r.id) ? {...r, open: true} : r);
  const {jsPDF} = window.jspdf, lg = await logoData().catch(() => null);
  const W0 = 612, H0 = 792, mg = 40, headH = 108, footH = 30;
  const unit = r => r.kind === "sec" ? 1.25 : 1;
  const totalU = shown.reduce((s, r) => s + unit(r), 0);
  let land = ctx.mode === "trend" || cols.length > 6, rh;
  if (!land) { rh = Math.min(14, (H0 - 2 * mg - headH - footH - 20) / totalU); if (rh < 9.6) { land = true; } }
  const PW = land ? H0 : W0, PH = land ? W0 : H0;
  if (land) rh = Math.min(13.5, Math.max(9, (PH - 2 * mg - headH - footH - 4) / totalU));
  const fs = Math.max(6.6, Math.min(9, rh * .66));
  const doc = new jsPDF({orientation: land ? "landscape" : "portrait", unit: "pt", format: "letter"});
  const ink = [11, 31, 58], mute = [91, 107, 128];
  const labW = ctx.mode === "trend" ? Math.min(190, PW * .24) : PW * .36, nW = (PW - 2 * mg - labW) / cols.length;
  const k = ctx.mode === "trend" && nW < 40, num = v => k ? fNk(v) : fN(v);
  const x0 = mg, xr = i => mg + labW + nW * (i + 1) - 4;
  const header = (pg) => {
    if (lg) { const h = 30, w = h * lg.w / lg.h; doc.addImage(lg.url, "PNG", mg, mg - 6, w, h); }
    doc.setTextColor(...ink); doc.setFont("times", "bold"); doc.setFontSize(13); doc.text("GFS Logistics", PW / 2, mg + 4, {align: "center"});
    doc.setFontSize(12); doc.text(ctx.stmt, PW / 2, mg + 20, {align: "center"});
    doc.setFont("times", "normal"); doc.setFontSize(10); doc.text(ENTS[ctx.ent], PW / 2, mg + 34, {align: "center"});
    doc.setFont("times", "italic"); doc.text(periodLine(ctx) + (k ? " · $ in thousands" : ""), PW / 2, mg + 47, {align: "center"});
    doc.setFontSize(8); doc.setTextColor(...mute); doc.text("(Unaudited)", PW / 2, mg + 58, {align: "center"});
    const yh = mg + headH - 14; doc.setTextColor(...ink); doc.setFont("times", "bold"); doc.setFontSize(Math.min(8.5, fs));
    cols.forEach((c, i) => { const lines = doc.splitTextToSize(c.h, nW - 6); lines.forEach((ln, j) => doc.text(ln, xr(i), yh - (lines.length - 1 - j) * (fs + 1), {align: "right"})); });
    doc.setDrawColor(...ink); doc.setLineWidth(.6); doc.line(mg, yh + 4, PW - mg, yh + 4);
    return yh + 4 + rh * .95;
  };
  const footer = (pg, n) => { doc.setFont("times", "italic"); doc.setFontSize(7.5); doc.setTextColor(...mute);
    doc.text(`Prepared from the Sage Intacct general ledger · ${new Date().toLocaleDateString("en-US", {month: "long", day: "numeric", year: "numeric"})} · Confidential`, mg, PH - mg + 12);
    doc.text(`Page ${pg} of ${n}`, PW - mg, PH - mg + 12, {align: "right"}); };
  // blocks keep a section title with what follows and an expanded group together
  const blocks = []; let cur = [];
  shown.forEach((r, i) => { cur.push(r); const nx = shown[i + 1]; const inGrp = r.parent && nx && nx.parent === r.parent || (r.kind === "grp" && r.open);
    if (r.kind === "sec" || inGrp) return; blocks.push(cur); cur = []; });
  if (cur.length) blocks.push(cur);
  const pages = [[]]; let used = 0; const cap = PH - 2 * mg - headH - footH;
  blocks.forEach(b => { const hgt = b.reduce((s, r) => s + unit(r) * rh, 0); if (used + hgt > cap && pages.at(-1).length) { pages.push([]); used = 0; } pages.at(-1).push(...b); used += hgt; });
  pages.forEach((pr, pi) => {
    if (pi) doc.addPage(); let y = header(pi + 1);
    pr.forEach(r => {
      const yy = y + (r.kind === "sec" ? rh * .5 : 0);
      doc.setTextColor(...ink);
      if (r.kind === "sec") { doc.setFont("times", "bold"); doc.setFontSize(fs * .92); doc.setTextColor(...mute); doc.text(r.label.toUpperCase(), x0, yy); y += unit(r) * rh; return; }
      const ind = r.kind === "acct" ? (r.depth === 2 ? 22 : 12) : r.kind === "subh" || r.kind === "subt" || r.kind === "note" ? 12 : 0;
      const bold = r.kind === "tot" || r.kind === "gtot" || (r.kind === "grp" && r.open), ital = r.kind === "pct" || r.kind === "subh" || r.kind === "note";
      doc.setFont("times", bold ? "bold" : ital ? "italic" : "normal"); doc.setFontSize(r.kind === "acct" ? fs * .95 : fs);
      const lab = doc.splitTextToSize(r.label, labW - ind - 6)[0]; doc.text(lab, x0 + ind, yy);
      if (!(r.kind === "grp" && r.open) && r.kind !== "subh") cols.forEach((c, i) => {
        const cv = stmtCell(ctx, c, i, r); if (cv.blank) return; let t;
        if (cv.dash) t = "–"; else if (cv.k === "amt" || cv.k === "var") t = Math.abs(cv.v) < .5 ? "–" : num(cv.v); else if (cv.k === "vp") t = cv.v == null ? "–" : fP(cv.v, 1, true).replace("−", "-");
        else if (cv.k === "pr" || cv.k === "pct") t = cv.v == null ? "–" : fP(cv.v).replace("−", "-"); else if (cv.k === "pts") t = fPts(cv.v).replace("−", "-"); else t = "";
        doc.text(t, xr(i), yy, {align: "right"});
        if (r.kind === "subt" || r.kind === "gtot" || r.kind === "tot") { doc.setLineWidth(.4); doc.setDrawColor(...ink); const lx = xr(i) - nW + 10; doc.line(lx, yy - rh * .72, xr(i), yy - rh * .72);
          if (r.cls === "final") { doc.line(lx, yy + 3, xr(i), yy + 3); doc.line(lx, yy + 4.6, xr(i), yy + 4.6); } } });
      y += unit(r) * rh;
    });
    footer(pi + 1, pages.length);
  });
  saveBlob(doc.output("blob"), fileStem(ctx) + ".pdf");
}

function heatmap(box, T, ent, ms, el) {
  const L = layoutDef(T, ent), rows = L.filter(i => i.k === "grp" || (i.k === "tot" && i.cls));
  const A = ms.map(x => computeCol(T, ent, [x], "a")), B = ms.map(x => computeCol(T, ent, [x], "b"));
  const mx = Math.max(1, ...rows.filter(r => r.k === "grp").flatMap(r => ms.map((_, i) => Math.abs((A[i][r.id] || 0) - (B[i][r.id] || 0)))));
  const bg = (d, good) => { if (Math.abs(d) < 500) return "transparent"; const t = Math.min(1, Math.abs(d) / mx) ** .6; return `color-mix(in srgb,${d * good >= 0 ? "var(--good)" : "var(--bad)"} ${Math.round(10 + t * 50)}%,var(--surface))`; };
  box.innerHTML = `<table class="heat"><thead><tr><th>Category · actual minus budget</th>${ms.map(x => `<th>${MN[+x.slice(5) - 1]}</th>`).join("")}<th>YTD</th></tr></thead><tbody>${rows.map(r => {
    const ds = ms.map((_, i) => (A[i][r.id] || 0) - (B[i][r.id] || 0)), tot = ds.reduce((s, v) => s + v, 0);
    return `<tr><td style="${r.k === "tot" ? "color:var(--navy);font-weight:700" : ""}">${esc(r.label)}</td>${ds.map((d, i) => `<td class="h" data-g="${r.id}" data-i="${i}" style="background:${bg(d, r.good)}" title="${esc(r.label)} · ${ymLabel(ms[i], true)}: actual ${f$(A[i][r.id])} vs budget ${f$(B[i][r.id])}">${Math.abs(d) < 500 ? '<span class="muted">·</span>' : fK(d, true)}</td>`).join("")}<td class="h" style="font-weight:700;background:${bg(tot / Math.max(1, ms.length), r.good)}">${fK(tot, true)}</td></tr>`; }).join("")}</tbody></table>`;
  $("#fsnote", el).textContent = "Green helped profit vs budget and red hurt it; darker means larger. Revenue above budget is green; costs above budget are red. Click a cell for the journal lines.";
  $$("td.h[data-g]", box).forEach(td => td.addEventListener("click", () => { const g = L.find(i => i.id === td.dataset.g); if (g && g.k === "grp") drill(grpSpec(g), ent, [ms[+td.dataset.i]], g.label); }));
}

/* ------------------------------------------------ MONTH COMPARE */
views.compare = el => {
  const c = st.cmp, m = st.rep; c.b ||= m; c.a ||= addM(m, -1); if (!M.months.includes(c.a)) c.a = M.months[0];
  if (c.layout === "soo") c.ent = "ALL";
  const T = c.layout, ent = c.ent, ents = ["ALL", "G1", "G2", "CW"].filter(e => e === "ALL" || Math.abs(val("rev", "std", e, [c.a], "a")) + Math.abs(val("rev", "std", e, [c.b], "a")) > .5);
  setTitle("Month compare", `${ymLabel(c.a, true)} vs ${ymLabel(c.b, true)}`);
  const opts = sel => [...M.months].reverse().map(x => `<option value="${x}" ${x === sel ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  el.innerHTML = `<div class="toolbar"><label class="ctl"><span>First month</span><select id="ca">${opts(c.a)}</select></label><label class="ctl"><span>Second month</span><select id="cb">${opts(c.b)}</select></label>
      <label class="ctl"><span>Statement</span><div class="seg" id="clay"><button data-v="soo" aria-pressed="${T === "soo"}">Statement of Operations</button><button data-v="std" aria-pressed="${T === "std"}">Standard P&L</button></div></label>
      ${T === "std" ? `<label class="ctl"><span>Entity</span><div class="seg" id="cent">${ents.map(e => `<button data-v="${e}" aria-pressed="${e === ent}">${ENTS_S[e]}</button>`).join("")}</div></label>` : ""}
      <span class="sp"></span><button class="btn" id="swap">⇄ Swap months</button></div>
    <div class="row g4" id="ctiles"></div>
    <div class="row g21"><div class="fs-wrap" style="max-height:none" id="cfsw"></div>${card("What changed, and why", "Ranked by impact on profit, explained from the customers, vendors and employees on the GL lines. Click an item for its journal lines.", `<ul class="ilist" id="cins"></ul>`)}</div>`;
  const L = layoutDef(T, ent), A = computeCol(T, ent, [c.a], "a"), B = computeCol(T, ent, [c.b], "a");
  const tiles = [["rev", "Revenue", 1], ["gp", T === "soo" ? "WH Operating Profit" : "Gross Profit", 1], [T === "soo" ? "woi" : "opx", T === "soo" ? "WH Operating Income" : "Operating Expense", T === "soo" ? 1 : -1], ["uni", "Unadjusted Net Income", 1]];
  $("#ctiles", el).innerHTML = tiles.map(([id, lab, g]) => { const d = (B[id] || 0) - (A[id] || 0);
    return `<div class="card kpi" style="cursor:default"><div class="k-label"><span>${lab}</span><span class="tag ${tone(d, g)}">${fP(pctOf(B[id], A[id]), 1, true)}</span></div><div class="k-val">${fK(B[id])}</div><div class="k-sub">${ymLabel(c.b)} · was ${fK(A[id])} in ${ymLabel(c.a)}</div>
      <div class="k-chips"><div class="chipbox"><div class="cl">Change</div><div class="cv ${cls(tone(d, g))}">${fK(d, true)}</div></div><div class="chipbox"><div class="cl">% of revenue</div><div class="cv">${fP(B.rev ? B[id] / B.rev : null)}</div></div></div></div>`; }).join("");
  let h = `<colgroup><col class="lbl"><col><col><col><col></colgroup><thead><tr><th>${esc(ENTS_S[ent])}</th><th>${ymLabel(c.a)}</th><th>${ymLabel(c.b)}</th><th class="sep">Change</th><th>Change %</th></tr></thead><tbody>`;
  const vc = (a, b, g) => { const d = b - a, t = tone(d, g); return `<td class="sep ${cls(t)}">${Math.abs(d) < .5 ? "–" : fN(d)}</td><td class="${cls(t)}">${Math.abs(a) > .5 ? fP(pctOf(b, a), 1, true) : "–"}</td>`; };
  for (const it of L) {
    if (it.k === "sec") h += `<tr class="sec"><td colspan="5">${esc(it.label)}</td></tr>`;
    else if (it.k === "grp") { if (Math.abs(A[it.id] || 0) < .5 && Math.abs(B[it.id] || 0) < .5) continue; const open = c.open.has(it.id);
      h += `<tr class="grp ${open ? "open" : ""}" data-g="${it.id}"><td><span class="tw">▶</span>${esc(it.label)}</td><td>${fN(A[it.id])}</td><td>${fN(B[it.id])}</td>${vc(A[it.id], B[it.id], it.good)}</tr>`;
      for (const r of it.rows) { if (Math.abs(A[r.id] || 0) < .5 && Math.abs(B[r.id] || 0) < .5) continue;
        h += `<tr class="acct ${open ? "" : "hide"}" data-p="${it.id}"><td>${esc(r.label)}</td><td class="c" data-r="${r.id}" data-m="a">${fN(A[r.id])}</td><td class="c" data-r="${r.id}" data-m="b">${fN(B[r.id])}</td>${vc(A[r.id], B[r.id], it.good)}</tr>`; } }
    else if (it.k === "tot") h += `<tr class="tot ${it.cls || ""}"><td>${esc(it.label)}</td><td>${fN(A[it.id])}</td><td>${fN(B[it.id])}</td>${vc(A[it.id], B[it.id], it.good)}</tr>`;
    else if (it.k === "pct") h += `<tr class="pct"><td>${esc(it.label)}</td><td>${fP(A[it.den] ? A[it.num] / A[it.den] : null)}</td><td>${fP(B[it.den] ? B[it.num] / B[it.den] : null)}</td><td class="sep"></td><td></td></tr>`;
  }
  $("#cfsw", el).innerHTML = `<table class="fs" style="min-width:640px">${h}</tbody></table>`;
  const fs = $("#cfsw table", el), rowById = {}; L.filter(i => i.k === "grp").forEach(g => g.rows.forEach(r => rowById[r.id] = {r, g}));
  $$("tr.grp td:first-child", fs).forEach(td => td.addEventListener("click", () => { const tr = td.parentElement, g = tr.dataset.g, on = !tr.classList.contains("open"); tr.classList.toggle("open", on); on ? c.open.add(g) : c.open.delete(g); $$(`tr.acct[data-p="${g}"]`, fs).forEach(r => r.classList.toggle("hide", !on)); }));
  $$("td.c", fs).forEach(td => td.addEventListener("click", () => { const {r} = rowById[td.dataset.r]; drill(r, ent, [td.dataset.m === "a" ? c.a : c.b], r.label); }));
  const pre3 = [1, 2, 3].map(k => addM(c.a, -k));
  const cand = Object.values(rowById).map(({r, g}) => ({r, g, a: A[r.id] || 0, b: B[r.id] || 0})).map(x => ({...x, imp: (x.b - x.a) * x.g.good})).filter(x => Math.abs(x.b - x.a) >= 750).sort((x, y) => Math.abs(y.imp) - Math.abs(x.imp)).slice(0, 9);
  const ins = cand.map(x => { const dv = drivers(x.r, ent, [c.a], [c.b]).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 3), hist = new Map(drivers(x.r, ent, pre3).map(d => [d.k, d.a]));
    const why = dv.filter(v => Math.abs(v.d) >= 100).map(v => { const prior = Math.abs(hist.get(v.k) || 0) > 1; let tag = "";
      if (Math.abs(v.a) > 1 && Math.abs(v.b) < 1 && !prior) tag = ` (one-time in ${ymLabel(c.a)})`; else if (Math.abs(v.a) < 1 && Math.abs(v.b) > 1 && !prior) tag = ` (new in ${ymLabel(c.b)})`; else if (Math.abs(v.b) < 1) tag = ` (none in ${ymLabel(c.b)})`;
      return `${v.k} ${fK(v.a)} → ${fK(v.b)}${tag}`; });
    return {x, html: `<span class="ic ${x.imp > 0 ? "good" : "bad"}">${x.imp > 0 ? "▲" : "▼"}</span><div><div class="t">${esc(x.r.label.replace(/^\d{4}(-\d{3})? · /, ""))}</div><div class="w">${fK(x.a)} → ${fK(x.b)}${why.length ? " · " + esc(why.join("; ")) : ""}</div></div><div class="v ${x.imp > 0 ? "pos" : "neg"}">${fK(x.b - x.a, true)}</div>`}; });
  $("#cins", el).innerHTML = ins.map((o, i) => `<li class="click" data-i="${i}">${o.html}</li>`).join("") || `<li><div></div><div class="w">No material changes.</div><div></div></li>`;
  $$("#cins li[data-i]", el).forEach(li => li.addEventListener("click", () => { const x = ins[+li.dataset.i].x; drill(x.r, ent, [c.a, c.b], x.r.label); }));
  const reload = async () => { await ensureYears([c.a.slice(0, 4), c.b.slice(0, 4)]); resetCaches(); views.compare(el); };
  $("#ca", el).addEventListener("change", e => { c.a = e.target.value; reload(); }); $("#cb", el).addEventListener("change", e => { c.b = e.target.value; reload(); });
  $("#swap", el).addEventListener("click", () => { [c.a, c.b] = [c.b, c.a]; views.compare(el); });
  $$("#clay button", el).forEach(b => b.addEventListener("click", () => { c.layout = b.dataset.v; views.compare(el); }));
  $$("#cent button", el).forEach(b => b.addEventListener("click", () => { c.ent = b.dataset.v; views.compare(el); }));
};

/* ------------------------------------------------ CUSTOMERS */
let SIX = null;
function salesIdx() { if (SIX) return SIX; SIX = new Map(); for (const x of M.sales) { const k = x.div + "|" + x.c + "|" + x.m; const o = SIX.get(k) || {i: 0, c: 0}; o[x.k === "c" ? "c" : "i"] += x.v; SIX.set(k, o); } return SIX; }
const salesAmt = (div, c, m, cm) => { const o = salesIdx().get(div + "|" + c + "|" + m); return o ? o.i + (cm ? o.c : 0) : 0; };
function salesBy(m, div, cm) { const out = new Map(); for (const x of M.sales) { if (x.m !== m || (!cm && x.k === "c") || (div !== "ALL" && x.div !== div)) continue; out.set(x.c, (out.get(x.c) || 0) + x.v); } return out; }
const normName = s => String(s || "").toLowerCase().replace(/\s+-\s+(exited|exiting|moved to g2|g2|city warehouse)\b.*$/, "").replace(/\(new\)/g, "").replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter(w => w && !["inc", "llc", "corp", "corporation", "co", "company", "the", "ltd", "lp", "usa", "us", "na", "of"].includes(w)).join(" ");
function budgetMatch(div, sageNames) {
  const aliases = cfgx().customerAliases || {}, buds = (M.cfg.salesBudget || []).filter(b => b.div === div), map = new Map(), nn = sageNames.map(n => [n, normName(n)]);
  for (const b of buds) { if (b.growth) continue; if (aliases[b.name] && sageNames.includes(aliases[b.name])) map.set(b.name, aliases[b.name]); else if (sageNames.includes(b.name)) map.set(b.name, b.name); }
  const claimed = new Set(map.values());
  for (const b of buds) { if (b.growth || map.has(b.name)) continue; const bn = normName(b.name), free = nn.filter(([n]) => !claimed.has(n) || /city warehouse|- g2/i.test(b.name));
    let hit = free.find(([, s]) => s === bn) || free.find(([, s]) => bn.length >= 4 && s.length >= 4 && (s.startsWith(bn) || bn.startsWith(s)));
    if (!hit) { const f = bn.split(" ")[0], cc = free.filter(([, s]) => s.split(" ")[0] === f); if (f.length >= 5 && cc.length === 1) hit = cc[0]; }
    if (hit) map.set(b.name, hit[0]); }
  return {buds, map};
}
function customerRows(y, ym, divs, cm) {
  const rows = [], fy = String(y) === String(M.cfg.fyStart || "2026").slice(0, 4);
  for (const dv of divs) {
    const names = [...new Set(M.sales.filter(x => x.m.startsWith(y) && x.div === dv).map(x => x.c))], {buds, map} = budgetMatch(dv, names), used = new Set(map.values()), byKey = new Map();
    const act = nm => ym.map(x => salesAmt(dv, nm, x, cm));
    for (const b of (fy ? buds : [])) { const sn = map.get(b.name), key = sn || "budget:" + b.name, bb = ym.map(x => b.bud[+x.slice(5) - 1] || 0), o = byKey.get(key);
      if (o) { o.bud = o.bud.map((v, i) => v + bb[i]); o.bnames.push(b.name); continue; }
      const r = {div: dv, name: sn || b.name, bname: b.name, bnames: [b.name], sec: b.growth ? "growth" : (b.spec ? "spec" : "core"), act: sn ? act(sn) : ym.map(() => 0), bud: bb, matched: !!sn || b.growth}; byKey.set(key, r); rows.push(r); }
    for (const nm of names) if (!used.has(nm)) rows.push({div: dv, name: nm, sec: fy ? "new" : "core", act: act(nm), bud: ym.map(() => 0), bnames: [], matched: true});
  }
  return rows;
}
views.sales = el => {
  const sv = st.sales, m = st.rep, y = m.slice(0, 4), ym = monthsThrough(m), mi = ym.length - 1, divs = sv.div === "ALL" ? ["G1", "G2"] : [sv.div];
  setTitle("Customers", `Sales by customer · ${sv.div === "ALL" ? "G1 + G2" : sv.div}`);
  const rows = customerRows(y, ym, divs, sv.cm);
  rows.forEach(r => { r.m = r.act[mi] || 0; r.mb = r.bud[mi] || 0; r.p = mi ? r.act[mi - 1] || 0 : 0; r.ya = r.act.reduce((a, b) => a + b, 0); r.yb = r.bud.reduce((a, b) => a + b, 0); });
  const q = sv.q.toLowerCase(), vis = rows.filter(r => (!q || r.name.toLowerCase().includes(q)) && (Math.abs(r.ya) + Math.abs(r.yb) > .5));
  const tot = rs => ({m: rs.reduce((s, r) => s + r.m, 0), mb: rs.reduce((s, r) => s + r.mb, 0), ya: rs.reduce((s, r) => s + r.ya, 0), yb: rs.reduce((s, r) => s + r.yb, 0), act: ym.map((_, i) => rs.reduce((s, r) => s + (r.act[i] || 0), 0)), bud: ym.map((_, i) => rs.reduce((s, r) => s + (r.bud[i] || 0), 0))});
  const T = tot(vis), hasB = T.yb > 0, unmatched = rows.filter(r => !r.matched && r.yb > 0);
  const top10 = [...vis].sort((a, b) => b.m - a.m).slice(0, 10).reduce((s, r) => s + r.m, 0), newC = vis.filter(r => r.sec === "new" && Math.abs(r.m) > .5);
  const kt = (label, tag, val, sub) => `<div class="card kpi" style="cursor:default"><div class="k-label"><span>${label}</span>${tag}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
  el.innerHTML = `<div class="toolbar"><label class="ctl"><span>Division</span><div class="seg" id="sdiv">${["ALL", "G1", "G2"].map(d => `<button data-v="${d}" aria-pressed="${d === sv.div}">${d === "ALL" ? "All" : d}</button>`).join("")}</div></label>
      <label class="ctl"><span>View</span><div class="seg" id="smode"><button data-v="month" aria-pressed="${sv.mode === "month"}">${ymLabel(m)} vs budget</button><button data-v="mom" aria-pressed="${sv.mode === "mom"}">Month by month</button></div></label>
      <label class="chkl"><input type="checkbox" id="scm" ${sv.cm ? "checked" : ""}> Net of credit memos</label><span class="sp"></span>
      <input class="field" id="sq" placeholder="Find a customer" value="${esc(sv.q)}" style="width:240px;height:36px;padding:0 12px"><button class="btn" id="scsv">Export</button></div>
    ${unmatched.length ? `<div class="banner" style="margin:0 0 var(--gap)">${unmatched.length} budgeted customer name(s) didn't match a Sage customer: ${esc(unmatched.slice(0, 5).map(r => r.bname).join(", "))}${unmatched.length > 5 ? "…" : ""}. Match them under Inputs.</div>` : ""}
    <div class="row g4">
      ${kt(`${ymLabel(m)} sales`, hasB ? `<span class="tag ${tone(T.m - T.mb, 1)}">${fP(pctOf(T.m, T.mb), 1, true)}</span>` : "", fK(T.m), hasB ? `budget ${fK(T.mb)} · ${fK(T.m - T.mb, true)}` : "&nbsp;")}
      ${kt("Year to date", hasB ? `<span class="tag ${tone(T.ya - T.yb, 1)}">${fP(pctOf(T.ya, T.yb), 1, true)}</span>` : "", fK(T.ya), hasB ? `budget ${fK(T.yb)} · ${fK(T.ya - T.yb, true)}` : "&nbsp;")}
      ${kt("Active customers", `<span class="tag gold">${newC.length} new</span>`, vis.filter(r => Math.abs(r.m) > .5).length, `invoiced in ${ymLabel(m)}`)}
      ${kt("Top-10 concentration", "", fP(T.m ? top10 / T.m : null, 0), `of ${ymLabel(m)} sales from 10 customers`)}
    </div>
    <div class="row g2">${card(`Top 15 customers · ${ymLabel(m, true)}`, hasB ? "Bar = invoiced sales · marker = budget · right column = variance. Click a customer for detail." : "Invoiced sales", `<div id="tops"></div>`)}${card(`Invoiced sales by month · ${y}`, hasB ? "Bars that beat the customer budget are solid" : "Invoiced sales", `<div id="sch"></div>`)}</div>
    <div class="tscroll"><table class="data" id="stbl"></table></div>
    <p class="note">Invoiced sales by invoice date from Sage AR. Sales won't tie to P&L revenue because recurring storage is deferred. City Warehouse customers roll into their home division.</p>`;
  const tp = [...vis].sort((a, b) => b.m - a.m).slice(0, 15), tb = bullets(tp.map(r => ({label: r.name, v: r.m, t: hasB && r.mb ? r.mb : null, note: hasB ? "no budget" : ""})), {onClick: it => customerDrawer(it.label, rows.find(r => r.name === it.label)), head: ["Customer", "Sales", hasB ? "vs budget" : ""]});
  $("#tops", el).innerHTML = `<div class="bullets">${tb.html}</div>`; tb.bind($("#tops", el));
  barTarget($("#sch", el), {labels: ym.map(x => MN[+x.slice(5) - 1]), actual: T.act, target: hasB ? T.bud : null, sel: mi, height: 380, names: ["Sales", "Budget"]});
  const SECS = [["core", "Budgeted customers"], ["spec", "Identified spec & growth customers"], ["new", "New / unbudgeted customers"], ["growth", "Unidentified growth target"]];
  let h, csv;
  const vcell = (a, b) => `<td class="num ${cls(tone(a - b, 1))}">${Math.abs(a - b) < .5 ? "–" : fN(a - b)}</td>`;
  if (sv.mode === "month") {
    h = `<thead><tr><th>Customer</th><th>Div</th><th class="num">${ymLabel(m)} actual</th><th class="num">Budget</th><th class="num">Variance</th><th class="num">vs ${ymLabel(addM(m, -1))}</th><th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">YTD variance</th></tr></thead><tbody>`;
    csv = [["Customer", "Division", "Section", "Month actual", "Month budget", "Variance", "Change vs prior month", "YTD actual", "YTD budget", "YTD variance"]];
    for (const [k, lab] of SECS) { const rs = vis.filter(r => r.sec === k).sort((a, b) => b.m - a.m || b.ya - a.ya); if (!rs.length) continue; const t = tot(rs);
      h += `<tr class="sub"><td colspan="9">${lab}</td></tr>` + rs.map(r => `<tr class="click" data-n="${esc(r.name)}"><td>${esc(r.name)}${r.matched ? "" : ' <span class="tag bad">not matched</span>'}</td><td><span class="tag neu">${r.div}</span></td><td class="num"><b>${fN(r.m)}</b></td><td class="num">${fN(r.mb)}</td>${vcell(r.m, r.mb)}${vcell(r.m, r.p)}<td class="num">${fN(r.ya)}</td><td class="num">${fN(r.yb)}</td>${vcell(r.ya, r.yb)}</tr>`).join("")
        + `<tr class="tot"><td colspan="2">Total ${lab.toLowerCase()}</td><td class="num">${fN(t.m)}</td><td class="num">${fN(t.mb)}</td>${vcell(t.m, t.mb)}<td></td><td class="num">${fN(t.ya)}</td><td class="num">${fN(t.yb)}</td>${vcell(t.ya, t.yb)}</tr>`;
      rs.forEach(r => csv.push([r.name, r.div, lab, r2(r.m), r2(r.mb), r2(r.m - r.mb), r2(r.m - r.p), r2(r.ya), r2(r.yb), r2(r.ya - r.yb)])); }
    h += `<tr class="tot"><td colspan="2">TOTAL SALES</td><td class="num">${fN(T.m)}</td><td class="num">${fN(T.mb)}</td>${vcell(T.m, T.mb)}<td></td><td class="num">${fN(T.ya)}</td><td class="num">${fN(T.yb)}</td>${vcell(T.ya, T.yb)}</tr>`;
  } else {
    const so = sv.sort || {k: "ya", dir: -1}, key = r => so.k === "ya" ? r.ya : so.k === "yb" ? r.yb : so.k === "var" ? r.ya - r.yb : so.k === "name" ? r.name.toLowerCase() : (r.act[+so.k] || 0);
    const rs = [...vis].sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * so.dir || b.ya - a.ya; });
    const sh = (k, lab, n = true) => `<th class="${n ? "num" : ""} sortable ${so.k === String(k) ? "sorted" : ""}" data-sk="${k}" title="Sort">${lab}${so.k === String(k) ? `<span class="sarr">${so.dir < 0 ? "▼" : "▲"}</span>` : ""}</th>`;
    h = `<thead><tr>${sh("name", "Customer", false)}<th>Div</th>${ym.map((x, i) => sh(i, MN[+x.slice(5) - 1])).join("")}${sh("ya", "YTD actual")}${sh("yb", "YTD budget")}${sh("var", "Variance")}</tr></thead><tbody>`
      + rs.map((r, i) => `<tr class="click" data-n="${esc(r.name)}"><td><span class="rank">${i + 1}</span>${esc(r.name)}</td><td><span class="tag neu">${r.div}</span></td>${r.act.map(v => `<td class="num">${Math.abs(v) < .5 ? '<span class="muted">–</span>' : fN(v)}</td>`).join("")}<td class="num"><b>${fN(r.ya)}</b></td><td class="num">${fN(r.yb)}</td>${vcell(r.ya, r.yb)}</tr>`).join("")
      + `<tr class="tot"><td colspan="2">TOTAL SALES</td>${T.act.map(v => `<td class="num">${fN(v)}</td>`).join("")}<td class="num">${fN(T.ya)}</td><td class="num">${fN(T.yb)}</td>${vcell(T.ya, T.yb)}</tr>`;
    csv = [["Customer", "Division", ...ym, "YTD actual", "YTD budget", "Variance"], ...rs.map(r => [r.name, r.div, ...r.act.map(r2), r2(r.ya), r2(r.yb), r2(r.ya - r.yb)])];
  }
  $("#stbl", el).innerHTML = (sv.mode === "mom" ? `<colgroup><col style="width:210px"><col style="width:50px">${ym.map(() => "<col>").join("")}<col style="width:96px"><col style="width:96px"><col style="width:92px"></colgroup>` : "") + h + "</tbody>";
  $("#stbl", el).classList.toggle("mom", sv.mode === "mom");
  $$("#stbl th[data-sk]", el).forEach(th => th.addEventListener("click", () => { const k = th.dataset.sk, cur = sv.sort || {k: "ya", dir: -1};
    sv.sort = cur.k === k ? {k, dir: -cur.dir} : {k, dir: k === "name" ? 1 : -1}; views.sales(el); }));
  $$("#stbl tr[data-n]", el).forEach(tr => tr.addEventListener("click", () => customerDrawer(tr.dataset.n, rows.find(x => x.name === tr.dataset.n))));
  $$("#sdiv button", el).forEach(b => b.addEventListener("click", () => { sv.div = b.dataset.v; views.sales(el); }));
  $$("#smode button", el).forEach(b => b.addEventListener("click", () => { sv.mode = b.dataset.v; views.sales(el); }));
  $("#scm", el).addEventListener("change", e => { sv.cm = e.target.checked; resetCaches(); views.sales(el); });
  let t; $("#sq", el).addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { sv.q = e.target.value; views.sales(el); const s = $("#sq", el); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); });
  $("#scsv", el).addEventListener("click", () => downloadCsv(csv, `Sales by customer ${sv.div} ${m}.csv`));
};
function customerDrawer(name, row) {
  const y = st.rep.slice(0, 4), ym = yearMonths(y), inv = M.sales.filter(x => x.c === name && x.m.startsWith(y)).sort((a, b) => a.d < b.d ? 1 : -1);
  const byM = ym.map(x => inv.filter(i => i.m === x).reduce((s, i) => s + i.v, 0));
  const glr = M.lines.filter(x => x.c === name && x.m.startsWith(y) && x.a.startsWith("4")), byA = {}; glr.forEach(x => byA[x.a] = (byA[x.a] || 0) + natural(x.a, x.v));
  const ab = bullets(Object.entries(byA).sort((a, b) => b[1] - a[1]).map(([a, v]) => ({label: `${a} · ${M.names[a] || ""}`, v})), {fmt: v => f$(v)});
  drawerRows = inv.map(x => ({Date: x.d, Document: x.doc, Division: x.l, Type: x.k === "c" ? "Credit memo" : "Invoice", Amount: x.v}));
  const budArr = row && row.bnames && row.bnames.length ? ym.map((_, i) => (M.cfg.salesBudget || []).filter(b => row.bnames.includes(b.name) && b.div === row.div).reduce((s, b) => s + (b.bud[i] || 0), 0)) : null;
  openDrawer(`Customer · ${y}`, name, `<div class="stats" style="--n:3;margin-bottom:18px"><div class="stat"><div class="sl">${y} invoiced</div><div class="sv">${f$(byM.reduce((a, b) => a + b, 0))}</div><div class="ss">through ${ymLabel(st.rep, true)}</div></div><div class="stat"><div class="sl">${y} budget</div><div class="sv">${budArr ? f$(budArr.reduce((a, b) => a + b, 0)) : "–"}</div><div class="ss">full year</div></div><div class="stat"><div class="sl">Documents</div><div class="sv">${inv.length}</div><div class="ss">invoices & credit memos</div></div></div>
    <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Invoiced by month</h3></div><div id="cch"></div></div>${glr.length ? `<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Revenue recognized by account (GL)</h3></div><div class="bullets">${ab.html}</div></div>` : ""}
    <div class="tscroll" style="max-height:none;box-shadow:none"><table class="lines"><thead><tr><th>Date</th><th>Document</th><th>Div</th><th>Type</th><th class="num">Amount</th></tr></thead><tbody>${inv.map(x => `<tr><td>${x.d}</td><td>${esc(x.doc)}</td><td>${x.l}</td><td>${x.k === "c" ? "Credit memo" : "Invoice"}</td><td class="num">${f$(x.v, 2)}</td></tr>`).join("")}</tbody></table></div>`);
  barTarget($("#cch"), {labels: MN, actual: byM.map((v, i) => ym[i] <= st.rep ? v : null), target: budArr, sel: +st.rep.slice(5) - 1, height: 220, names: ["Invoiced", "Budget"]});
}

/* ------------------------------------------------ WAREHOUSE LABOR (employee detail on payroll lines from June 2026) */
const LAB_T = {"5035-001": "reg", "5035-002": "ot", "5035-003": "pto", "5035-004": "hol", "5035-005": "tax", "5035-006": "pass"};
const LAB_COLS = [["reg", "Regular"], ["ot", "Overtime"], ["pto", "PTO"], ["hol", "Holiday"], ["tax", "Taxes"], ["pass", "Passthrough"]];
const labStart = () => M.cfg.laborDetailStart || "2026-06";
function laborBy(per, div) {
  const ok = x => per.includes(x.m) && (div === "ALL" || x.l === div), E = new Map(), A = new Map();
  for (const x of M.lines) {
    if (!ok(x)) continue;
    if (x.a.startsWith("5035")) { const k = x.e || "_un", t = LAB_T[x.a] || "other";
      const o = E.get(k) || {id: k, reg: 0, ot: 0, pto: 0, hol: 0, tax: 0, pass: 0, other: 0, tot: 0, divs: {}, lines: []};
      o[t] += x.v; o.tot += x.v; if (t === "reg") o.divs[x.l] = (o.divs[x.l] || 0) + x.v; o.lines.push(x); E.set(k, o); }
    else if (/^50(40|45)/.test(x.a)) { const k = x.vn || "Unspecified agency", t = /-002$/.test(x.a) ? "ot" : x.a === "5045-003" ? "pass" : "reg";
      const o = A.get(k) || {name: k, reg: 0, ot: 0, pass: 0, tot: 0, ft: 0, tmp: 0, lines: []}; o[t] += x.v; o.tot += x.v; o[x.a.startsWith("5040") ? "ft" : "tmp"] += x.v; o.lines.push(x); A.set(k, o); }
  }
  for (const o of E.values()) { const d = Object.entries(o.divs).sort((a, b) => b[1] - a[1])[0]; o.div = d ? d[0] : ""; o.otp = o.reg ? o.ot / o.reg : null; }
  return {E, A};
}
views.labor = el => {
  const lv = st.labor ||= {per: "month", div: "ALL", sort: {k: "tot", dir: -1}};
  const m = st.rep, start = labStart(), months = M.months.filter(x => x >= start && x <= m);
  setTitle("Warehouse labor", "Warehouse labor by employee");
  if (!months.length) { el.innerHTML = `<div class="banner info">Employee detail on warehouse payroll starts ${ymLabel(start, true)}. Choose ${ymLabel(start, true)} or later as the reporting month.</div>`; return; }
  const per = lv.per === "month" ? [m] : months, perL = lv.per === "month" ? ymLabel(m, true) : `${ymLabel(months[0])} – ${ymLabel(m)}`;
  const {E, A} = laborBy(per, lv.div), emps = [...E.values()].filter(o => o.id !== "_un"), un = E.get("_un");
  const empInfo = id => (M.cfg.employees || {})[id] || {};
  const sum = (arr, k) => arr.reduce((s, o) => s + (o[k] || 0), 0);
  const eTot = sum([...E.values()], "tot"), agTot = sum([...A.values()], "tot"), total = eTot + agTot, rev = val("rev", "std", lv.div, per, "a");
  const eReg = sum(emps, "reg") + (un ? un.reg : 0), eOt = sum(emps, "ot") + (un ? un.ot : 0), aReg = sum([...A.values()], "reg"), aOt = sum([...A.values()], "ot");
  const paid = emps.filter(o => o.reg > .5);
  const headCnt = per.reduce((s, x) => s + new Set(M.lines.filter(l => l.m === x && l.a === "5035-001" && l.e && (lv.div === "ALL" || l.l === lv.div) && l.v > 0).map(l => l.e)).size, 0);
  const avg = headCnt ? sum(emps, "tot") / headCnt : null;
  // monthly OT% history for every employee (whole period since detail starts), for the heatmap and "months above 8%"
  const hist = months.map(x => laborBy([x], lv.div).E);
  const otM = id => hist.map(H => { const o = H.get(id); return o ? {ot: o.ot, reg: o.reg, p: o.reg ? o.ot / o.reg : null} : null; });
  emps.forEach(o => { o.hi = otM(o.id).filter(c => c && c.p != null && c.p > .08).length; const i = empInfo(o.id); o.name = i.name || o.id; o.pos = i.position || ""; o.status = i.status || ""; });
  const kt = (label, tag, v, sub) => `<div class="card kpi" style="cursor:default"><div class="k-label"><span>${label}</span>${tag}</div><div class="k-val">${v}</div><div class="k-sub">${sub}</div></div>`;
  const otAll = (eReg + aReg) ? (eOt + aOt) / (eReg + aReg) : null;
  el.innerHTML = `<div class="toolbar tight"><label class="ctl"><span>Period</span><div class="seg" id="lper"><button data-v="month" aria-pressed="${lv.per === "month"}">${ymLabel(m)}</button><button data-v="since" aria-pressed="${lv.per === "since"}">Since ${ymLabel(start)}</button></div></label>
      <label class="ctl"><span>Division</span><div class="seg" id="ldiv">${["ALL", "G1", "G2", "CW"].map(d => `<button data-v="${d}" aria-pressed="${d === lv.div}">${d === "ALL" ? "All" : d}</button>`).join("")}</div></label><span class="sp"></span><button class="btn sm" id="lcsv">Export</button></div>
    <div class="row g4">
      ${kt("Total warehouse labor", rev ? `<span class="tag neu">${fP(total / rev)} of rev</span>` : "", fK(total), `${perL} · employees + agency labor`)}
      ${kt("GFS employees", `<span class="tag neu">${paid.length} paid</span>`, fK(eTot), avg != null ? `${fK(avg)} average per employee per month` : "&nbsp;")}
      ${kt("Overtime on the P&L", `<span class="tag ${otAll > .08 ? "bad" : "good"}">${fP(otAll)} of regular</span>`, fK(eOt + aOt), `paid to employees ${fK(sum(emps, "ot"))} · ${fK(-(un ? un.ot : 0))} reclassed to G3 move / passthrough`)}
      ${kt("Agency labor", `<span class="tag neu">${fP(total ? agTot / total : null, 0)} of labor</span>`, fK(agTot), `temp-to-hire ${fK(sum([...A.values()], "ft"))} · temporary ${fK(sum([...A.values()], "tmp"))}`)}
    </div>
    <div class="row g2">${card("Overtime rate by month", "Overtime as a share of regular wages · 8% is a normal month. Employee figures below are what each person was paid, before G3 move and customer-passthrough labor is reclassed out.", `<div id="lch"></div>`)}${card(`Most overtime · ${esc(perL)}`, "Overtime dollars by employee · right column = overtime as a share of that person's regular pay", `<div id="ltop"></div>`)}</div>
    <div class="card" style="margin-bottom:var(--gap)"><div class="card-h"><div><h3>Overtime history by employee</h3><p class="lede">Overtime dollars by month since ${ymLabel(start, true)}. Shading shows overtime as a share of regular pay: amber above 8%, red above 15%. Click a row for that person's detail.</p></div></div><div class="tscroll" style="box-shadow:none;max-height:none"><table class="heat lheat" id="lheat"></table></div></div>
    <div class="card" style="margin-bottom:var(--gap)"><div class="card-h"><div><h3>Cost by employee · ${esc(perL)}</h3><p class="lede">GFS payroll (accounts 5035) by employee and pay type. Click a column to sort, a row for the journal lines.</p></div></div><div class="tscroll" style="box-shadow:none;max-height:none"><table class="data" id="ltbl"></table></div></div>
    ${A.size ? `<div class="card"><div class="card-h"><div><h3>Agency labor · ${esc(perL)}</h3><p class="lede">Temp-to-hire (5040) and temporary labor (5045) billed by staffing agencies. Click a row for the bills.</p></div></div><div class="tscroll" style="box-shadow:none;max-height:none"><table class="data" id="latbl"></table></div></div>` : ""}`;
  // chart: OT % by month
  const otSer = (pick) => months.map((x, i) => { let r = 0, o = 0; if (pick === "e") { for (const v of hist[i].values()) { r += v.reg; o += v.ot; } } else { const {A: a} = laborBy([x], lv.div); for (const v of a.values()) { r += v.reg; o += v.ot; } } return r ? o / r : null; });
  lineChart($("#lch", el), {labels: months.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 250, ref: {value: .08, label: "8% norm"}, series: [{name: "GFS employees · on the P&L (after reclasses)", short: "Employees", color: "var(--c1)", values: otSer("e")}, {name: "GFS employees · paid (before G3 move / passthrough reclasses)", short: "Paid", color: "var(--c3)", dash: true, values: hist.map(H => { let r = 0, o = 0; for (const [k, v] of H) if (k !== "_un") { r += v.reg; o += v.ot; } return r ? o / r : null; })}, {name: "Agency labor", short: "Agency", color: "var(--c2)", values: otSer("a")}]});
  const top = [...emps].sort((a, b) => b.ot - a.ot).filter(o => o.ot > .5).slice(0, 10);
  const tb = bullets(top.map(o => ({label: `${o.name}`, v: o.ot, note: fP(o.otp, 0), color: o.otp > .15 ? "var(--bad)" : o.otp > .08 ? "var(--gold)" : "var(--c1)", id: o.id})), {fmt: v => fK(v), onClick: it => empDrawer(it.id, per, lv.div), head: ["Employee", "Overtime", "OT %"]});
  $("#ltop", el).innerHTML = top.length ? `<div class="bullets">${tb.html}</div>` : `<p class="muted">No overtime in this period.</p>`; tb.bind($("#ltop", el));
  // heatmap
  const hm = [...emps].map(o => ({o, c: otM(o.id)})).map(x => ({...x, ot: x.c.reduce((s, c) => s + (c ? c.ot : 0), 0), reg: x.c.reduce((s, c) => s + (c ? c.reg : 0), 0)})).filter(x => x.ot > .5 || x.reg > .5).sort((a, b) => b.ot - a.ot);
  const shade = p => p == null || p <= .08 ? "transparent" : `color-mix(in srgb,${p > .15 ? "var(--bad)" : "var(--gold)"} ${Math.round(18 + Math.min(1, (p - .08) / .22) * 40)}%,var(--surface))`;
  $("#lheat", el).innerHTML = `<thead><tr><th>Employee</th><th class="l">Position</th>${months.map(x => `<th>${MN[+x.slice(5) - 1]}</th>`).join("")}<th>Total OT</th><th>OT %</th><th>Months &gt;8%</th></tr></thead><tbody>${hm.map(x => `<tr class="click" data-e="${esc(x.o.id)}"><td>${esc(x.o.name)}${x.o.status === "Terminated" ? ' <span class="tag neu">former</span>' : ""}</td><td class="l muted">${esc(x.o.pos)}</td>${x.c.map((c, i) => `<td class="h" style="background:${shade(c && c.p)}" title="${esc(x.o.name)} · ${ymLabel(months[i], true)}: overtime ${c ? f$(c.ot) : "$0"} on regular pay of ${c ? f$(c.reg) : "$0"}${c && c.p != null ? ` (${fP(c.p)})` : ""}">${c && c.ot > .5 ? fK(c.ot) : '<span class="muted">·</span>'}</td>`).join("")}<td class="h"><b>${fK(x.ot)}</b></td><td class="h" style="background:${shade(x.reg ? x.ot / x.reg : null)}">${fP(x.reg ? x.ot / x.reg : null, 0)}</td><td class="h">${x.o.hi} of ${months.length}</td></tr>`).join("")}</tbody>`;
  // employee table
  const so = lv.sort, key = o => so.k === "name" ? o.name.toLowerCase() : so.k === "pos" ? o.pos : so.k === "div" ? o.div : so.k === "otp" ? (o.otp ?? -1) : so.k === "hi" ? o.hi : (o[so.k] || 0);
  const er = [...emps].filter(o => Math.abs(o.tot) > .5).sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * so.dir; });
  const sh = (k, lab, n = true) => `<th class="${n ? "num" : ""} sortable ${so.k === k ? "sorted" : ""}" data-sk="${k}">${lab}${so.k === k ? `<span class="sarr">${so.dir < 0 ? "▼" : "▲"}</span>` : ""}</th>`;
  const tr = (o, lab, extra = "") => `<td class="num">${fN(o.reg)}</td><td class="num">${fN(o.ot)}</td><td class="num">${fN(o.pto)}</td><td class="num">${fN(o.hol)}</td><td class="num">${fN(o.tax)}</td><td class="num">${fN(o.pass)}</td><td class="num"><b>${fN(o.tot)}</b></td><td class="num ${o.otp > .15 ? "neg" : ""}">${fP(o.otp, 0)}</td>${extra}`;
  const tt = {reg: 0, ot: 0, pto: 0, hol: 0, tax: 0, pass: 0, tot: 0}; [...E.values()].forEach(o => Object.keys(tt).forEach(k => tt[k] += o[k] || 0)); tt.otp = tt.reg ? tt.ot / tt.reg : null;
  $("#ltbl", el).innerHTML = `<thead><tr>${sh("name", "Employee", false)}${sh("pos", "Position", false)}${sh("div", "Div", false)}${sh("reg", "Regular")}${sh("ot", "Overtime")}${sh("pto", "PTO")}${sh("hol", "Holiday")}${sh("tax", "Taxes")}${sh("pass", "Passthrough")}${sh("tot", "Total")}${sh("otp", "OT %")}${sh("hi", "Months &gt;8%")}</tr></thead><tbody>
    ${er.map(o => `<tr class="click" data-e="${esc(o.id)}"><td>${esc(o.name)}${o.status === "Terminated" ? ' <span class="tag neu">former</span>' : ""}</td><td class="muted">${esc(o.pos)}</td><td><span class="tag neu">${esc(o.div || "–")}</span></td>${tr(o)}<td class="num">${o.hi} of ${months.length}</td></tr>`).join("")}
    ${un && Math.abs(un.tot) > .5 ? `<tr class="click" data-e="_un"><td colspan="3"><i>Not assigned to an employee</i> <span class="muted small">accruals, reclasses, passthrough entries</span></td>${tr({...un, otp: null})}<td></td></tr>` : ""}
    <tr class="tot"><td colspan="3">Total GFS payroll</td>${tr(tt)}<td></td></tr></tbody>`;
  $$("#ltbl th[data-sk]", el).forEach(th => th.addEventListener("click", () => { const k = th.dataset.sk; lv.sort = lv.sort.k === k ? {k, dir: -lv.sort.dir} : {k, dir: ["name", "pos", "div"].includes(k) ? 1 : -1}; views.labor(el); }));
  $$("#ltbl tr[data-e], #lheat tr[data-e]", el).forEach(r => r.addEventListener("click", () => empDrawer(r.dataset.e, r.closest("#lheat") ? months : per, lv.div)));
  if (A.size) { const ag = [...A.values()].sort((a, b) => b.tot - a.tot), at = {reg: sum(ag, "reg"), ot: sum(ag, "ot"), pass: sum(ag, "pass"), tot: sum(ag, "tot")};
    $("#latbl", el).innerHTML = `<thead><tr><th>Agency</th><th class="num">Temp-to-hire</th><th class="num">Temporary</th><th class="num">Regular</th><th class="num">Overtime</th><th class="num">Passthrough</th><th class="num">Total</th><th class="num">OT %</th></tr></thead><tbody>${ag.map((o, i) => `<tr class="click" data-i="${i}"><td>${esc(o.name)}</td><td class="num">${fN(o.ft)}</td><td class="num">${fN(o.tmp)}</td><td class="num">${fN(o.reg)}</td><td class="num">${fN(o.ot)}</td><td class="num">${fN(o.pass)}</td><td class="num"><b>${fN(o.tot)}</b></td><td class="num">${fP(o.reg ? o.ot / o.reg : null, 0)}</td></tr>`).join("")}<tr class="tot"><td>Total agency labor</td><td class="num">${fN(sum(ag, "ft"))}</td><td class="num">${fN(sum(ag, "tmp"))}</td><td class="num">${fN(at.reg)}</td><td class="num">${fN(at.ot)}</td><td class="num">${fN(at.pass)}</td><td class="num">${fN(at.tot)}</td><td class="num">${fP(at.reg ? at.ot / at.reg : null, 0)}</td></tr></tbody>`;
    $$("#latbl tr[data-i]", el).forEach(r => r.addEventListener("click", () => { const o = ag[+r.dataset.i]; const ls = [...o.lines].sort((a, b) => a.d < b.d ? 1 : -1);
      openDrawer(`Agency labor · ${perL}`, o.name, `<div class="stats" style="--n:3;margin-bottom:18px"><div class="stat"><div class="sl">Total</div><div class="sv">${f$(o.tot)}</div><div class="ss">${esc(perL)}</div></div><div class="stat"><div class="sl">Overtime</div><div class="sv">${f$(o.ot)}</div><div class="ss">${fP(o.reg ? o.ot / o.reg : null)} of regular</div></div><div class="stat"><div class="sl">Bill lines</div><div class="sv">${ls.length}</div><div class="ss">from Sage Intacct</div></div></div>${linesTable(ls)}`); })); }
  $$("#lper button", el).forEach(b => b.addEventListener("click", () => { lv.per = b.dataset.v; views.labor(el); }));
  $$("#ldiv button", el).forEach(b => b.addEventListener("click", () => { lv.div = b.dataset.v; views.labor(el); }));
  $("#lcsv", el).addEventListener("click", () => downloadCsv([["Employee", "ID", "Position", "Division", "Status", "Regular", "Overtime", "PTO", "Holiday", "Taxes", "Passthrough", "Total", "OT % of regular", `Months above 8% (of ${months.length})`],
    ...er.map(o => [o.name, o.id, o.pos, o.div, o.status, r2(o.reg), r2(o.ot), r2(o.pto), r2(o.hol), r2(o.tax), r2(o.pass), r2(o.tot), o.otp == null ? "" : r2(o.otp * 100) / 100, o.hi]),
    ...(un ? [["Not assigned to an employee", "", "", "", "", r2(un.reg), r2(un.ot), r2(un.pto), r2(un.hol), r2(un.tax), r2(un.pass), r2(un.tot), "", ""]] : [])], `Warehouse labor ${lv.div} ${perL}.csv`));
};
function empDrawer(id, per, div) {
  const info = (M.cfg.employees || {})[id] || {}, name = id === "_un" ? "Not assigned to an employee" : info.name || id;
  const ls = M.lines.filter(x => x.a.startsWith("5035") && per.includes(x.m) && (div === "ALL" || x.l === div) && (id === "_un" ? !x.e : x.e === id)).sort((a, b) => a.d < b.d ? 1 : -1);
  const by = t => per.map(x => ls.filter(l => l.m === x && LAB_T[l.a] === t).reduce((s, l) => s + l.v, 0));
  const reg = by("reg"), ot = by("ot"), tot = ls.reduce((s, l) => s + l.v, 0), sR = reg.reduce((a, b) => a + b, 0), sO = ot.reduce((a, b) => a + b, 0);
  const perL = per.length === 1 ? ymLabel(per[0], true) : `${ymLabel(per[0])} – ${ymLabel(per.at(-1))}`;
  openDrawer(`Warehouse labor · ${perL}`, `${name}${info.position ? " · " + info.position : ""}`, `<div class="stats" style="--n:4;margin-bottom:18px"><div class="stat"><div class="sl">Total cost</div><div class="sv">${f$(tot)}</div><div class="ss">${esc(perL)}</div></div><div class="stat"><div class="sl">Regular</div><div class="sv">${f$(sR)}</div><div class="ss">5035-001</div></div><div class="stat"><div class="sl">Overtime</div><div class="sv ${sR && sO / sR > .15 ? "neg" : ""}">${f$(sO)}</div><div class="ss">${fP(sR ? sO / sR : null)} of regular</div></div><div class="stat"><div class="sl">Status</div><div class="sv" style="font-size:16px;padding-top:4px">${esc(info.status || "–")}</div><div class="ss">${esc(id === "_un" ? "" : id)}</div></div></div>
    ${per.length > 1 ? `<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Overtime rate by month</h3></div><div id="ech"></div></div>` : ""}${linesTable(ls)}`);
  if (per.length > 1) lineChart($("#ech"), {labels: per.map(x => MN[+x.slice(5) - 1]), fmt: v => fP(v, 0), height: 200, ref: {value: .08, label: "8%"}, series: [{name: "OT % of regular", short: "OT %", color: "var(--c1)", values: per.map((_, i) => reg[i] ? ot[i] / reg[i] : null)}]});
}

/* ------------------------------------------------ G3 MOVE */
function moveLines() { const man = cfgx().moveManual || {};
  return M.mv.map(x => { const o = {...x}; if (man[x.key]) { o.cat = man[x.key]; o.how = "manual"; } return o; }).filter(x => x.cat !== "__not_move__" && (x.a.startsWith("6120") || (x.cat && x.how !== "none"))); }
views.move = el => {
  const m = st.rep, ml = moveLines().filter(x => x.m <= m), cfg = M.cfg;
  setTitle("G3 Move", `Move spend vs budget · through ${ymLabel(m, true)}`);
  const cats = new Map((cfg.moveBudget || []).map(b => [b.cat, {...b, op: 0, cx: 0, n: 0}]));
  for (const x of ml) { const c = x.cat || "Unclassified"; if (!cats.has(c)) cats.set(c, {cat: c, group: "OpEx", budget: 0, op: 0, cx: 0, n: 0}); const o = cats.get(c); x.a.startsWith("2100") ? o.cx += x.v : o.op += x.v; o.n++; }
  const all = [...cats.values()], tb = all.reduce((s, c) => s + c.budget, 0), top = all.reduce((s, c) => s + c.op, 0), tcx = all.reduce((s, c) => s + c.cx, 0), spent = top + tcx;
  const plM = natural("6120-000", actRaw("6120-000", "ALL", [m])), review = M.mv.filter(x => !(cfgx().moveManual || {})[x.key] && x.how === "none").length;
  const months = []; for (let k = cfg.moveStart || "2026-06"; k <= m; k = addM(k, 1)) months.push(k);
  const cum = []; months.reduce((s, x) => { const v = s + ml.filter(l => l.m === x).reduce((t, l) => t + l.v, 0); cum.push(v); return v; }, 0);
  const kt = (label, tag, v, sub, extra = "") => `<div class="card kpi" style="cursor:default"><div class="k-label"><span>${label}</span>${tag}</div><div class="k-val">${v}</div><div class="k-sub">${sub}</div>${extra}</div>`;
  el.innerHTML = `${review ? `<div class="banner" style="margin:0 0 var(--gap)">${review} move line(s) need a category. <a href="#" id="toAdm2">Review them under Inputs</a>.</div>` : ""}
    <div class="row g4">
      ${kt("Total spend to date", `<span class="tag ${spent > tb ? "bad" : "neu"}">${fP(tb ? spent / tb : null, 0)} used</span>`, fK(spent), `of the ${fK(tb)} move budget`, `<div class="meter" style="margin-top:16px"><span class="${spent > tb ? "over" : ""}" style="width:${Math.min(100, tb ? spent / tb * 100 : 0)}%"></span></div>`)}
      ${kt("Remaining budget", "", fK(tb - spent), `${fP(tb ? (tb - spent) / tb : null, 0)} of the budget still available`)}
      ${kt("Expensed on the P&L", `<span class="tag neu">GL 6120</span>`, fK(top), `${ymLabel(m)}: ${fK(plM)}`)}
      ${kt("Capitalized", `<span class="tag neu">2100 group</span>`, fK(tcx), "fixed-asset additions")}
    </div>
    <div class="row g2">${card("Cumulative spend vs budget", "How quickly the move budget is being used", `<div id="mvc"></div>`)}${card("Largest categories", "Bar = spent to date · marker = category budget · right column = over (−) or under budget", `<div id="mvb"></div>`)}</div>
    <div class="tscroll"><table class="data" id="mvt"></table></div>`;
  lineChart($("#mvc", el), {labels: months.map(x => ymLabel(x)), height: 300, ref: {value: tb, label: "Budget"}, series: [{name: "Cumulative spend", short: "Spent", color: "var(--c1)", values: cum}]});
  const tc = [...all].sort((a, b) => (b.op + b.cx) - (a.op + a.cx)).slice(0, 10), bb = bullets(tc.map(c => ({label: c.cat, v: c.op + c.cx, t: c.budget || null, note: c.budget ? "" : "no budget"})), {good: -1, onClick: it => moveDrawer(it.label, ml), head: ["Category", "Spent", "vs budget"]});
  $("#mvb", el).innerHTML = `<div class="bullets">${bb.html}</div>`; bb.bind($("#mvb", el));
  let h = `<thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Expensed</th><th class="num">Capitalized</th><th class="num">Total spent</th><th class="num">Remaining</th><th style="min-width:180px">Used</th></tr></thead><tbody>`;
  const csv = [["Group", "Category", "Budget", "Expensed", "Capitalized", "Total", "Remaining"]];
  for (const [g, lab] of [["CapEx", "Capital budget"], ["OpEx", "Operating budget"]]) { const rs = all.filter(c => c.group === g); if (!rs.length) continue; const s = k => rs.reduce((t, c) => t + c[k], 0);
    h += `<tr class="sub"><td colspan="7">${lab}</td></tr>` + rs.map(c => { const t = c.op + c.cx, pu = c.budget ? t / c.budget : (t ? 1.01 : 0); csv.push([g, c.cat, r2(c.budget), r2(c.op), r2(c.cx), r2(t), r2(c.budget - t)]);
      return `<tr class="click" data-c="${esc(c.cat)}"><td>${esc(c.cat)}${c.cat === "Unclassified" ? ' <span class="tag bad">review</span>' : ""}</td><td class="num">${fN(c.budget)}</td><td class="num">${fN(c.op)}</td><td class="num">${fN(c.cx)}</td><td class="num"><b>${fN(t)}</b></td><td class="num ${c.budget - t < -.5 ? "neg" : ""}">${fN(c.budget - t)}</td><td><div style="display:flex;align-items:center;gap:10px"><div class="meter" style="flex:1"><span class="${pu > 1 ? "over" : ""}" style="width:${Math.min(100, pu * 100)}%"></span></div><span class="small muted" style="width:40px;text-align:right">${c.budget ? fP(pu, 0) : ""}</span></div></td></tr>`; }).join("")
      + `<tr class="tot"><td>Total ${g === "CapEx" ? "capital" : "operating"}</td><td class="num">${fN(s("budget"))}</td><td class="num">${fN(s("op"))}</td><td class="num">${fN(s("cx"))}</td><td class="num">${fN(s("op") + s("cx"))}</td><td class="num">${fN(s("budget") - s("op") - s("cx"))}</td><td></td></tr>`; }
  h += `<tr class="tot"><td>TOTAL G3 MOVE</td><td class="num">${fN(tb)}</td><td class="num">${fN(top)}</td><td class="num">${fN(tcx)}</td><td class="num">${fN(spent)}</td><td class="num">${fN(tb - spent)}</td><td></td></tr>`;
  $("#mvt", el).innerHTML = h + "</tbody>";
  $$("#mvt tr[data-c]", el).forEach(tr => tr.addEventListener("click", () => moveDrawer(tr.dataset.c, ml)));
  const ta = $("#toAdm2", el); if (ta) ta.addEventListener("click", e => { e.preventDefault(); go("admin"); });
};
function moveDrawer(c, ml) { const ls = ml.filter(x => (x.cat || "Unclassified") === c).sort((a, b) => a.d < b.d ? 1 : -1);
  drawerRows = ls.map(x => ({Date: x.d, Account: x.a, Division: x.l, Vendor: x.vn, Employee: x.e ? empName(x.e) : "", Memo: x.memo, ClassifiedBy: x.how, Amount: x.v}));
  openDrawer("G3 Move", c, `<div class="stats" style="--n:2;margin-bottom:18px"><div class="stat"><div class="sl">Spent to date</div><div class="sv">${f$(ls.reduce((s, x) => s + x.v, 0))}</div><div class="ss">expensed + capitalized</div></div><div class="stat"><div class="sl">Lines</div><div class="sv">${ls.length}</div><div class="ss">from Sage Intacct</div></div></div>
    <div class="tscroll" style="max-height:none;box-shadow:none"><table class="lines"><thead><tr><th>Date</th><th>Type</th><th>Vendor / employee</th><th>Memo / description</th><th>Classified by</th><th class="num">Amount</th><th></th></tr></thead><tbody>${ls.map(x => `<tr><td>${x.d}</td><td>${x.a.startsWith("2100") ? "Capitalized" : "Expensed"}</td><td>${esc(x.vn || (x.e ? empName(x.e) : ""))}</td><td class="memo ${isBatch(x.memo) ? "batch" : ""}">${esc(x.memo)}</td><td>${({match: "Move detail list", vendor: "Vendor (auto)", manual: "You", none: "–"})[x.how] || x.how}</td><td class="num">${f$(x.v, 2)}</td><td>${x.u ? `<a href="${sageUrl(x.u)}" target="_blank" rel="noopener">Sage ↗</a>` : ""}</td></tr>`).join("")}</tbody></table></div>`); }

/* ------------------------------------------------ AR */
const arBase = () => (M.cfg.arDashboard || "../gfs-ar-aging/").replace(/\/?$/, "/");
views.ar = el => { setTitle("Receivables", "Accounts receivable aging");
  el.innerHTML = `<div class="toolbar"><span class="muted">The live AR Aging Dashboard, shown unchanged. It has its own passphrase; once unlocked here it stays unlocked while this tab is open.</span><span class="sp"></span><a class="btn" href="${arBase()}" target="_blank" rel="noopener">Open in a new tab ↗</a></div><iframe class="ar" src="${arBase()}" title="AR Aging Dashboard"></iframe>`; };
async function arSummary(box) {
  const pw = store.get(AR_PW_KEY, true) || store.get(AR_PW_KEY);
  const ask = msg => { box.innerHTML = `<p class="note" style="margin:0 0 12px">${msg}</p><form id="arf" style="display:flex;gap:8px"><input class="field" type="password" id="arpw" placeholder="AR dashboard passphrase" style="max-width:280px;height:36px;padding:0 12px"><button class="btn primary">Show</button></form>`;
    $("#arf", box).addEventListener("submit", e => { e.preventDefault(); store.set(AR_PW_KEY, $("#arpw", box).value, true); arSummary(box); }); };
  if (!pw) return ask("Enter the AR dashboard passphrase once to show receivables here. It also unlocks the Receivables page.");
  try {
    const ar = await decryptEnv(await (await fetch(arBase() + "data.enc.json?t=" + Date.now(), {cache: "no-store"})).json(), pw);
    const asOf = new Date(ar.asOf + "T00:00:00"), b = [0, 0, 0, 0, 0], over = new Map();
    for (const it of ar.items) { const dd = Math.floor((asOf - new Date(it.due + "T00:00:00")) / 864e5), k = dd <= 0 ? 0 : dd <= 30 ? 1 : dd <= 60 ? 2 : dd <= 90 ? 3 : 4; b[k] += it.bal; if (k === 4) over.set(it.c, (over.get(it.c) || 0) + it.bal); }
    const tot = b.reduce((s, v) => s + v, 0), lab = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"], col = ["var(--c3)", "var(--c1)", "var(--c5)", "var(--c2)", "var(--bad)"];
    const topO = [...over.entries()].sort((a, c) => c[1] - a[1]).slice(0, 4);
    box.innerHTML = `<div class="stats" style="--n:3;margin-bottom:16px"><div class="stat"><div class="sl">Total receivables</div><div class="sv">${fK(tot)}</div><div class="ss">as of ${esc(ar.asOf)}</div></div><div class="stat"><div class="sl">Current</div><div class="sv">${fP(tot ? b[0] / tot : null, 0)}</div><div class="ss">not yet due</div></div><div class="stat"><div class="sl">Over 90 days</div><div class="sv ${tot && b[4] / tot > .1 ? "neg" : ""}">${fK(b[4])}</div><div class="ss">${fP(tot ? b[4] / tot : null)} of total</div></div></div>
      <div class="bullets">${lab.map((l, i) => `<div class="bul"><span class="nm">${l}</span><span class="tr"><span class="b" style="width:${tot ? Math.max(0, b[i]) / tot * 100 : 0}%;background:${col[i]}"></span></span><span class="v">${fK(b[i])}</span><span class="d muted">${fP(tot ? b[i] / tot : null, 0)}</span></div>`).join("")}</div>
      ${topO.length ? `<p class="note" style="margin-top:14px">Largest over-90 balances: ${topO.map(([c, v]) => `<b>${esc((ar.customers[c] || {}).n || c)}</b> ${fK(v)}`).join(" · ")}. <a href="#" id="toAr">Open receivables →</a></p>` : ""}`;
    const t = $("#toAr", box); if (t) t.addEventListener("click", e => { e.preventDefault(); go("ar"); });
  } catch { store.del(AR_PW_KEY); ask("Couldn't unlock the AR data with the saved passphrase."); }
}

/* ------------------------------------------------ INPUTS */
views.admin = el => {
  const m = st.rep, cfg = cfgx(), e = st.edits, cats = (M.cfg.moveBudget || []).map(b => b.cat), man = cfg.moveManual || {};
  setTitle("Setup", "Inputs & classification");
  const q = M.mv.filter(x => x.how === "none" || x.how === "vendor" || (e.moveManual || {})[x.key]).sort((a, b) => a.d < b.d ? 1 : -1);
  const caps = cfg.capacity || {}, poh = (cfg.palletsOnHand || {})[m] || {};
  const unmatched = []; for (const dv of ["G1", "G2"]) { const names = [...new Set(M.sales.filter(x => x.div === dv).map(x => x.c))].sort(), {buds, map} = budgetMatch(dv, names); buds.filter(b => !b.growth && !map.has(b.name) && b.bud.some(Boolean)).forEach(b => unmatched.push({b, dv, names})); }
  const dirty = Object.keys(e).some(k => Object.keys(e[k] || {}).length);
  el.innerHTML = `${dirty ? `<div class="banner info" style="margin:0 0 var(--gap)">You have changes saved on this device only. Download the config file below and upload it to GitHub to share them.</div>` : ""}
    <div class="row">${card(`G3 move lines to review · ${q.length}`, "Lines on 6120 that weren't on the move detail list, plus fixed-asset additions in the 2100 group. Pick a category, or mark a fixed asset as not part of the move.",
      q.length ? `<div class="tscroll adm" style="max-height:460px;box-shadow:none"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Vendor · memo</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>${q.map(x => `<tr><td>${x.d}</td><td>${x.a.startsWith("2100") ? "Capitalized · " + x.a : "Expensed"}</td><td><b>${esc(x.vn)}</b><div class="small muted">${esc(x.memo)}</div></td><td class="num">${f$(x.v, 2)}</td><td><select data-k="${esc(x.key)}"><option value="">${x.how === "vendor" ? "Auto: " + esc(x.cat) : x.a.startsWith("2100") ? "Not reviewed (excluded)" : "Unclassified"}</option>${cats.map(c => `<option ${man[x.key] === c ? "selected" : ""}>${esc(c)}</option>`).join("")}${x.a.startsWith("2100") ? `<option value="__not_move__" ${man[x.key] === "__not_move__" ? "selected" : ""}>Not a move cost</option>` : ""}</select></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nothing to review.</p>`, "adm")}</div>
    <div class="row g2">${card(`Capacity · ${ymLabel(m, true)}`, "End-of-month pallets on hand and total pallet capacity by building",
      `<table class="data adm" style="min-width:0"><thead><tr><th>Building</th><th>Rack on hand</th><th>Bulk on hand</th><th>Rack capacity</th><th>Bulk capacity</th></tr></thead><tbody>${["G1", "G2", "CW", "G3"].map(d => `<tr><td><b>${d}</b></td><td><input type="number" data-p="${d}.rack" value="${(poh[d] || {}).rack ?? ""}"></td><td><input type="number" data-p="${d}.bulk" value="${(poh[d] || {}).bulk ?? ""}"></td><td><input type="number" data-c="${d}.rack" value="${(caps[d] || {}).rack ?? ""}"></td><td><input type="number" data-c="${d}.bulk" value="${(caps[d] || {}).bulk ?? ""}"></td></tr>`).join("")}</tbody></table>`)}
      ${card(`Budget customer names · ${unmatched.length} unmatched`, "Budget names come from the Excel package. Most match a Sage customer automatically; pick the Sage customer for the rest.",
      unmatched.length ? `<table class="data adm" style="min-width:0"><tbody>${unmatched.map(u => `<tr><td><span class="tag neu">${u.dv}</span> ${esc(u.b.name)}</td><td><select data-al="${esc(u.b.name)}"><option value="">Choose Sage customer…</option>${u.names.map(n => `<option>${esc(n)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>` : `<p class="muted">All budget customers are matched.</p>`)}</div>
    <div class="row">${card("Save for everyone", "Paste the CONFIG_KEY (the same value saved as a GitHub secret). It never leaves this browser.",
      `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center" class="adm"><input type="password" id="ck" placeholder="CONFIG_KEY" style="width:340px;height:36px"><button class="btn primary" id="dl">Download config.enc.json</button><button class="btn" id="clr">Discard local changes</button></div>
      <ol class="note"><li>Download the file.</li><li>In the GitHub repo choose Add file → Upload files and upload it (it replaces the old one).</li><li>The refresh runs automatically; reload the dashboard when it finishes.</li></ol><div class="err" id="ckErr"></div>`)}</div>`;
  $$("select[data-k]", el).forEach(s => s.addEventListener("change", () => { (e.moveManual ||= {}); if (s.value) e.moveManual[s.dataset.k] = s.value; else delete e.moveManual[s.dataset.k]; saveEdits(); }));
  $$("input[data-p]", el).forEach(i => i.addEventListener("change", () => { const [d, k] = i.dataset.p.split("."); const cur = JSON.parse(JSON.stringify(((cfgx().palletsOnHand || {})[m]) || {})); (cur[d] ||= {})[k] = i.value === "" ? null : +i.value; (e.palletsOnHand ||= {})[m] = cur; saveEdits(); }));
  $$("input[data-c]", el).forEach(i => i.addEventListener("change", () => { const [d, k] = i.dataset.c.split("."); const cur = JSON.parse(JSON.stringify(cfgx().capacity || {})); (cur[d] ||= {})[k] = +i.value || 0; e.capacity = cur; saveEdits(); }));
  $$("select[data-al]", el).forEach(s => s.addEventListener("change", () => { (e.customerAliases ||= {})[s.dataset.al] = s.value; saveEdits(); }));
  $("#clr", el).addEventListener("click", () => { st.edits = {}; saveEdits(); views.admin(el); });
  $("#dl", el).addEventListener("click", async () => { $("#ckErr", el).textContent = "";
    try { const k = $("#ck", el).value.trim(), raw = Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - k.length % 4) % 4)), c => c.charCodeAt(0)); if (raw.length !== 32) throw 0;
      const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(Object.assign({}, M.cfg, mergedEdits())))));
      let s = ""; for (let i = 0; i < ct.length; i += 32768) s += String.fromCharCode(...ct.subarray(i, i + 32768));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({v: 1, iv: btoa(String.fromCharCode(...iv)), ct: btoa(s)})], {type: "application/json"})); a.download = "config.enc.json"; a.click();
    } catch { $("#ckErr", el).textContent = "That doesn't look like the CONFIG_KEY (it's a 43-character code)."; } });
};

/* ============================================================ boot */
function downloadCsv(rows, name) { const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(",")).join("\n")], {type: "text/csv"})); a.download = name.replace(/[\\/:*?"<>|]/g, "-"); a.click(); }
function defaultRep() { const a = M.asOf.slice(0, 7), d = +M.asOf.slice(8, 10); let m = d < 20 ? addM(a, -1) : a; if (!M.months.includes(m)) m = M.months.filter(x => x <= a).at(-1) || a; return m; }
function start(snap) {
  D = snap; buildModel(snap); layoutCache = {}; st.rep = defaultRep();
  $("#lock").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#repMonth").innerHTML = [...M.months].reverse().map(x => `<option value="${x}" ${x === st.rep ? "selected" : ""}>${ymLabel(x, true)}</option>`).join("");
  const gen = new Date(snap.generatedAt);
  $("#liveText").textContent = snap.mode === "live" ? `Live from Sage · ${gen.toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})}` : "Preview data";
  $("#liveBadge").classList.toggle("preview", snap.mode !== "live");
  $("#sideCo").textContent = `${snap.company || "GFS Logistics"} · through ${new Date(snap.asOf + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})}`;
  const ban = []; if (snap.mode === "preview") ban.push(`<div class="banner">Preview built from the October package numbers. Drill-downs show one line per account and month.</div>`);
  (snap.warnings || []).forEach(w => ban.push(`<div class="banner">${esc(w)}</div>`)); $("#banners").innerHTML = ban.join("");
  $("#foot").innerHTML = `Source: Sage Intacct general ledger${M.months[0] ? ` (from ${ymLabel(M.months[0], true)})` : ""}, budget “${esc(M.cfg.budgetId || "GFS Budget")}” and AR invoices. Presentation follows the GFS monthly financial package. Excluded from reporting: ${(M.cfg.excludeLines || []).map(x => `${esc(x.acct)} ${f$(x.amt, 2)} (${esc(x.why)})`).join("; ") || "nothing"}. Confidential.`;
  render();
}
$("#lockForm").addEventListener("submit", e => { e.preventDefault(); unlock($("#pw").value, $("#remember").checked); });
$("#nav").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b) go(b.dataset.view); });
$("#repMonth").addEventListener("change", e => { st.rep = e.target.value; st.pl.actM = st.rep; st.pl.basis = null; st.cmp.a = st.cmp.b = null; render(); });
$("#menuBtn").addEventListener("click", () => $("#side").classList.toggle("open"));
$("#dClose").addEventListener("click", closeDrawer); $("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
$("#dCsv").addEventListener("click", () => { if (!drawerRows.length) return; const k = Object.keys(drawerRows[0]); downloadCsv([k, ...drawerRows.map(r => k.map(x => r[x]))], ($("#dTitle").textContent || "detail") + ".csv"); });
$("#lockBtn").addEventListener("click", () => { store.del(LS_KEY); location.reload(); });
const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
applyTheme(store.get(THEME_KEY));
$("#themeBtn").addEventListener("click", () => { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), nx = cur === "dark" ? "light" : "dark"; store.set(THEME_KEY, nx); applyTheme(nx); render(); });
let rz, lastW = innerWidth; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (M && Math.abs(innerWidth - lastW) > 40 && $("#drawer").classList.contains("hidden")) { lastW = innerWidth; render(); } }, 300); });
if (window.__PREVIEW_DATA__) { PW = "preview"; start(window.__PREVIEW_DATA__); }
else { const saved = store.get(LS_KEY, true) || store.get(LS_KEY); if (saved) { $("#remember").checked = !!store.get(LS_KEY); unlock(saved, $("#remember").checked); } }
})();
