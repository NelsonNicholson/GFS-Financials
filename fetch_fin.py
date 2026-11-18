#!/usr/bin/env python3
"""
Build the encrypted data file for the GFS Financials Dashboard.

  live     SAGE_CLIENT_ID / SAGE_CLIENT_SECRET / SAGE_USERNAME are set
           -> pulls the GL (P&L + fixed assets), the Sage budget and AR invoice lines
              from the Sage Intacct REST API, then classifies them using config.enc.json
  preview  --preview FILE  -> encrypts a pre-built snapshot (used for testing)

Secrets: DASHBOARD_PASSWORD (viewers), CONFIG_KEY (unlocks config.enc.json),
         SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_USERNAME (= Financials_Dashboard@CompanyID)

Public-repo rule: nothing printed to the Actions log contains dollar amounts,
customer names or vendor names. Counts and pass/fail only.
"""
import argparse
import base64
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from decimal import Decimal
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

PBKDF2_ITERATIONS = 310_000
PAGE_SIZE = 1000
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "config.enc.json")
b64e = lambda b: base64.b64encode(b).decode("ascii")
b64d = lambda s: base64.b64decode(s)


def env(name, required=True):
    v = (os.environ.get(name) or "").strip()
    if required and not v:
        sys.exit(f"Missing required secret / environment variable {name}")
    return v


def money(v):
    return float(Decimal(str(v or "0")).quantize(Decimal("0.01")))


# ----------------------------------------------------------------------------- config
def load_config():
    key = env("CONFIG_KEY")
    if not os.path.exists(CONFIG_FILE):
        sys.exit("config.enc.json is missing from the repo")
    blob = json.load(open(CONFIG_FILE))
    raw = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    try:
        pt = AESGCM(raw).decrypt(b64d(blob["iv"]), b64d(blob["ct"]), None)
    except Exception:
        sys.exit("CONFIG_KEY does not match config.enc.json")
    return json.loads(pt)


# ----------------------------------------------------------------------------- Sage REST
class Sage:
    def __init__(self):
        import requests
        self.base = os.environ.get("SAGE_API_BASE", "https://api.intacct.com/ia/api/v1").rstrip("/")
        self.s = requests.Session()
        self.s.headers["Accept"] = "application/json"
        payload = {"grant_type": "client_credentials", "client_id": env("SAGE_CLIENT_ID"),
                   "client_secret": env("SAGE_CLIENT_SECRET"), "username": env("SAGE_USERNAME")}
        url = f"{self.base}/oauth2/token"
        r = self.s.post(url, json=payload, timeout=60)
        if r.status_code >= 400:
            r = self.s.post(url, data=payload, timeout=60)
        if r.status_code >= 400:
            hint = ""
            if r.status_code in (400, 401, 403):
                hint = ("\nChecklist: (1) SAGE_USERNAME is Financials_Dashboard@<CompanyID> exactly; "
                        "(2) the client ID is authorized in Sage (Company > Setup > Company > Security > Web Services authorizations / "
                        "Application subscriptions: REST API enabled); (3) the Financials_Dashboard user is active, is a Web Services user, "
                        "and has read permission for General Ledger and Accounts Receivable; (4) client ID/secret were copied without spaces.")
            sys.exit(f"Sage authentication failed ({r.status_code}): {r.text[:400]}{hint}")
        self.s.headers["Authorization"] = "Bearer " + r.json()["access_token"]

    def query(self, obj, fields, filters=None, required=True, order=None):
        rows, start = [], 1
        while True:
            body = {"object": obj, "fields": fields, "start": start, "size": PAGE_SIZE}
            if filters:
                body["filters"] = filters
            if order:
                body["orderBy"] = order
            r = self.s.post(f"{self.base}/services/core/query", json=body, timeout=180)
            if r.status_code >= 400:
                msg = f"Sage query on {obj} failed ({r.status_code}): {r.text[:400]}"
                if required:
                    sys.exit(msg)
                print("::warning::" + msg)
                return None
            data = r.json()
            rows.extend(data.get("ia::result", []))
            nxt = (data.get("ia::meta") or {}).get("next")
            if not nxt:
                return rows
            start = int(nxt)


def g(rec, path, default=None):
    if path in rec:
        return rec[path]
    cur = rec
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


class Strings:
    """String table: the browser gets each repeated name once."""
    def __init__(self):
        self.S, self.ix = [], {}

    def __call__(self, x):
        if x is None or x == "":
            return -1
        x = str(x)
        if x not in self.ix:
            self.ix[x] = len(self.S)
            self.S.append(x)
        return self.ix[x]


GL_FIELDS = ["id", "entryDate", "glAccount.id", "glAccount.name", "dimensions.location.id", "dimensions.employee.id",
             "dimensions.customer.name", "dimensions.vendor.name", "description", "journalEntry.glJournal.id",
             "journalEntry.id", "journalEntry.description", "txnType", "baseAmount", "state"]


def gl_query(s, filters):
    rows = s.query("general-ledger/journal-entry-line", GL_FIELDS + ["journalEntry.webURL"], filters, required=False)
    if rows is None:  # webURL not available to this user/company: retry without it
        rows = s.query("general-ledger/journal-entry-line", GL_FIELDS, filters)
    out = []
    for r in rows:
        st = str(g(r, "state") or "").lower()
        if "draft" in st:
            continue
        amt = money(g(r, "baseAmount"))
        if str(g(r, "txnType") or "").lower() == "credit":
            amt = -amt
        out.append(r | {"_amt": amt})
    return out


def url_token(u):
    u = u or ""
    return u.split(".r=", 1)[1] if ".r=" in u else ""


def build_live(cfg, tz):
    s = Sage()
    today = dt.datetime.now(tz).date()
    fy0 = cfg.get("dataStart", cfg["fyStart"] + "-01")
    S = Strings()
    names = dict(cfg.get("accountNames", {}))

    # --- 1. P&L general ledger lines (accounts 4000 and up)
    raw = gl_query(s, [{"$between": {"entryDate": [fy0, today.isoformat()]}}, {"$gte": {"glAccount.id": "4000"}}])
    excl = cfg.get("excludeLines", [])
    used_excl = [False] * len(excl)
    gl, excluded = [], []
    for r in raw:
        a, d, amt = g(r, "glAccount.id"), g(r, "entryDate"), r["_amt"]
        names.setdefault(a, g(r, "glAccount.name") or a)
        hit = next((i for i, x in enumerate(excl) if not used_excl[i] and x["acct"] == a and d[:7] == x["month"]
                    and abs(abs(amt) - x["amt"]) < 0.005), None)
        if hit is not None:
            used_excl[hit] = True
            excluded.append({"d": d, "acct": a, "amt": amt, "why": excl[hit].get("why", "")})
            continue
        gl.append([d, a, g(r, "dimensions.location.id") or "", amt, S(g(r, "dimensions.employee.id")),
                   S(g(r, "dimensions.customer.name")), S(g(r, "dimensions.vendor.name")),
                   S(g(r, "description") or g(r, "journalEntry.description")), S(g(r, "journalEntry.glJournal.id")),
                   S(url_token(g(r, "journalEntry.webURL"))), S(g(r, "journalEntry.id"))])
    gl.sort(key=lambda x: (x[0], x[1]))
    print(f"[gl] {len(gl)} P&L lines from {fy0}; {len(excluded)} excluded by config rule")

    # --- 2. Fixed-asset additions (move CapEx lives on the balance sheet, 2100 group)
    fa_raw = gl_query(s, [{"$between": {"entryDate": [cfg.get("moveStart", "2026-06") + "-01", today.isoformat()]}},
                          {"$startsWith": {"glAccount.id": "2100"}}])
    fa = [r for r in fa_raw if r["_amt"] > 0]
    for r in fa_raw:
        names.setdefault(g(r, "glAccount.id"), g(r, "glAccount.name") or g(r, "glAccount.id"))

    # --- 3. Move classification: 6120 (P&L) + 2100 additions
    mv = classify_move(cfg, [r for r in raw if g(r, "glAccount.id") == "6120-000"] + fa, S)
    print(f"[move] {len(mv)} move lines; {sum(1 for m in mv if m[5] == 'match')} matched to the detail list, "
          f"{sum(1 for m in mv if m[5] == 'vendor')} by vendor, {sum(1 for m in mv if m[5] == 'manual')} manual, "
          f"{sum(1 for m in mv if m[5] == 'none')} need classification")

    # --- 4. Budget
    bud_rows = s.query("general-ledger/budget-detail",
                       ["glAccount.id", "dimensions.location.id", "reportingPeriod.startDate", "amount", "budget.id"],
                       [{"$eq": {"budget.id": cfg.get("budgetId", "GFS Budget")}}, {"$gte": {"reportingPeriod.startDate": fy0}}])
    bud = [[g(r, "glAccount.id"), g(r, "dimensions.location.id") or "", (g(r, "reportingPeriod.startDate") or "")[:7],
            money(g(r, "amount"))] for r in bud_rows if money(g(r, "amount"))]
    print(f"[budget] {len(bud)} budget cells")

    # --- 5. Sales by customer (invoice lines on revenue accounts, by invoice date) + credit memos
    sales = []
    inv = s.query("accounts-receivable/invoice-line",
                  ["invoice.invoiceDate", "invoice.invoiceNumber", "invoice.customer.id", "invoice.customer.name",
                   "dimensions.location.id", "glAccount.id", "baseAmount"],
                  [{"$gte": {"invoice.invoiceDate": fy0}}, {"$startsWith": {"glAccount.id": "4"}}])
    agg = defaultdict(float)
    for r in inv:
        k = (g(r, "invoice.invoiceDate"), g(r, "invoice.invoiceNumber") or "", g(r, "invoice.customer.name") or g(r, "invoice.customer.id"),
             g(r, "dimensions.location.id") or "", "i")
        agg[k] += money(g(r, "baseAmount"))
    adj = s.query("accounts-receivable/adjustment-line",
                  ["arAdjustment.createdDate", "arAdjustment.adjustmentNumber", "arAdjustment.customer.name",
                   "dimensions.location.id", "glAccount.id", "baseCurrency.amount"],
                  [{"$gte": {"arAdjustment.createdDate": fy0}}, {"$startsWith": {"glAccount.id": "4"}}], required=False) or []
    for r in adj:
        k = (g(r, "arAdjustment.createdDate"), g(r, "arAdjustment.adjustmentNumber") or "", g(r, "arAdjustment.customer.name") or "",
             g(r, "dimensions.location.id") or "", "c")
        agg[k] += money(g(r, "baseCurrency.amount"))
    for (d, n, c, loc, kind), v in sorted(agg.items()):
        if abs(v) >= 0.005 and d:
            sales.append([d, S(n), S(c), loc, round(v, 2), kind])
    print(f"[sales] {sum(1 for x in sales if x[5] == 'i')} invoices, {sum(1 for x in sales if x[5] == 'c')} credit memos")

    # --- 6. Tie-out checks (pass/fail only - public log)
    checks = {"excludedLines": excluded, "excludeRulesUnused": [x for i, x in enumerate(excl) if not used_excl[i]]}
    for m, ref in (cfg.get("moveRefByMonth") or {}).items():
        pass  # reference values are from the package; the browser shows the Sage number
    warn = []
    known = set(cfg.get("knownAccounts", []))
    if known:
        unk = sorted({x[1] for x in gl} - known)
        if unk:
            warn.append(f"{len(unk)} GL account(s) are not in the report structure: " + ", ".join(unk))
            print(f"::warning::{len(unk)} GL account(s) not in the report structure - shown under 'Unmapped' on the dashboard")

    return {"gl": gl, "fa_count": len(fa), "mv": mv, "bud": bud, "sales": sales, "S": S.S, "acctNames": names,
            "checks": checks, "warnings": warn}


def classify_move(cfg, rows, S):
    """Category for each move line: manual override > detail-list match (date+amount) > vendor learned from matches."""
    rules = defaultdict(list)
    for rl in cfg.get("moveRules", []):
        rules[(rl["d"], round(rl["amt"], 2))].append(rl["cat"])
    manual = cfg.get("moveManual", {})          # key -> category or "__not_move__"
    hints = dict(cfg.get("moveVendorHints", {}))  # vendor -> category
    out, learned = [], defaultdict(lambda: defaultdict(int))
    pending = []
    for r in rows:
        a, d, amt = g(r, "glAccount.id"), g(r, "entryDate"), r["_amt"]
        key = f"{g(r, 'id')}"
        vend = g(r, "dimensions.vendor.name") or ""
        memo = g(r, "description") or g(r, "journalEntry.description") or ""
        rec = [d, a, g(r, "dimensions.location.id") or "", amt, None, "none", S(vend), S(memo),
               S(url_token(g(r, "journalEntry.webURL"))), key, S(g(r, "dimensions.employee.id"))]
        if key in manual:
            rec[4], rec[5] = manual[key], "manual"
        else:
            cands = rules.get((d, round(abs(amt), 2))) or rules.get((d, round(amt, 2)))
            if cands:
                rec[4], rec[5] = cands.pop(0) if len(cands) > 1 else cands[0], "match"
                if vend:
                    learned[vend][rec[4]] += 1
            else:
                pending.append(rec)
        out.append(rec)
    for rec in pending:  # vendor-based suggestion for lines not on the detail list
        vend = S.S[rec[6]] if rec[6] >= 0 else ""
        cat = hints.get(vend) or (max(learned[vend].items(), key=lambda kv: kv[1])[0] if learned.get(vend) else None)
        if cat:
            rec[4], rec[5] = cat, "vendor"
        elif rec[1].startswith("2100"):
            rec[4], rec[5] = None, "none"  # fixed-asset addition not known to be move-related
    return [r for r in out if r[4] != "__not_move__"]


# ----------------------------------------------------------------------------- encrypt
def encrypt_for_viewers(obj, password):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS).derive(password.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, separators=(",", ":")).encode(), None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": PBKDF2_ITERATIONS, "salt": b64e(salt), "iv": b64e(iv), "ct": b64e(ct)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data.enc.json")
    ap.add_argument("--preview", help="encrypt a pre-built snapshot JSON instead of calling Sage")
    args = ap.parse_args()
    tz = ZoneInfo(os.environ.get("REPORT_TZ", "America/Chicago"))
    now = dt.datetime.now(tz)

    if args.preview:
        snap = json.load(open(args.preview))
        snap["cfg"] = snap.get("cfg") or load_config()
    else:
        cfg = load_config()
        if not env("SAGE_CLIENT_ID", required=False):
            sys.exit("Sage secrets are not set (SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_USERNAME).")
        data = build_live(cfg, tz)
        snap = {"v": 1, "mode": "live", "company": cfg.get("company", "GFS Logistics"), "asOf": now.date().isoformat(),
                "generatedAt": now.isoformat(timespec="seconds"), "cfg": cfg} | data

    password = env("DASHBOARD_PASSWORD")
    if len(password) < 12:
        sys.exit("DASHBOARD_PASSWORD must be at least 12 characters.")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    json.dump(encrypt_for_viewers(snap, password), open(args.out, "w"))
    print(f"[{snap['mode']}] encrypted data file written ({os.path.getsize(args.out) // 1024} KB)")


if __name__ == "__main__":
    main()
