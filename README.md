# GFS Logistics: Financials Dashboard

**Live site (after setup):** https://nelsonnicholson.github.io/gfs-financials/ (passphrase protected)

The monthly GFS financial package as an interactive website, fed by Sage Intacct.

| Section | What it shows |
|---|---|
| **Summary** | Headline numbers for the reporting month vs budget, prior month, YTD and prior year; "what moved" notes written from the GL; budget-to-actual bridge; division cards; warehouse labor, overtime, freight markup, customer movers, capacity and AR |
| **P&L** | Statement of Operations (consolidated) or Standard P&L (Consolidated, G1, G2, CW). Month vs Budget (pick the actual and budget months), Month over Month, YTD vs Budget. Groups expand to accounts (subtotals below each group; Warehouse Labor split into employee, temp-to-hire and temporary). Every actual amount opens the journal lines behind it. Export to Excel (formulas, outline grouping) or PDF (auditor-style, one portrait page when it fits) |
| **Month Compare** | Any two months side by side, with plain-English explanations of the biggest changes (customers, vendors, employees behind each line, one-time and new items flagged) |
| **Warehouse Labor** | Cost by employee and position (from June 2026, when Sage started tagging payroll lines by employee), overtime history heatmap, agency labor by vendor |
| **Sales by Customer** | Invoiced sales from Sage AR by customer vs the customer budget: month vs budget, month over month with YTD |
| **G3 Move** | Move spend vs the move budget by category, split between expensed (6120) and capitalized (2100 group) |
| **AR** | The existing AR Aging Dashboard, embedded unchanged |
| **⚙ Inputs** | The few things Sage doesn't hold: move-line categories, pallet counts and capacity, prior-year months, budget customer names |

## How it works

```
Sage Intacct ──► GitHub Action (when you click Run workflow) ──► encrypted data.enc.json ──► GitHub Pages
                 fetch_fin.py + config.enc.json                                            index.html decrypts
                                                                                           with your passphrase
```

- **Refresh:** Actions → *Refresh financials dashboard* → **Run workflow**. It pulls everything posted in Sage so far, including the open month. It also runs whenever you upload a file to the repo.
- **Sources:** GL journal lines for accounts 4000+ (P&L), fixed-asset additions in the 2100 group (move CapEx), the Sage budget "GFS Budget", and AR invoice lines and credit memos (sales by customer).
- **Reporting rules** (from the package): Customer Care and Warehouse Manager wages + payroll taxes are Direct Operating Expense, using the employee on each GL line; Management Wages (Kernodle, Medina, Miller) and the remaining office taxes are overhead. Jan–Jun 2026 use the package split because the GL had no employee names before 6/11/2026. Adjustments to Net Income = 6110–6180. G3 Move (6120) shows only at the consolidated level. The January 2026 promissory-note interest ($14,740.96) is excluded. Budget comparisons are made at the category subtotal level, as in the package.

## Secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `DASHBOARD_PASSWORD` | Passphrase viewers type (12+ characters). Change it to revoke access, then re-run the workflow. |
| `CONFIG_KEY` | Unlocks `config.enc.json` (classifications, customer and move budgets, employee roles). Provided separately. Keep a copy. |
| `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET` | The Sage REST API client app (the same client app the AR dashboard uses is fine). |
| `SAGE_USERNAME` | `Financials_Dashboard@<your Sage Company ID>` |

If the run fails at "Sage authentication", the log lists what to check (user ID format, client authorized in Sage, Web Services user active with read access to GL and AR).

## Changing classifications and inputs

1. Open the dashboard → **⚙ Inputs**, make the changes (they apply on your device right away).
2. Paste the CONFIG_KEY and click **Download config.enc.json**.
3. In this repo: **Add file → Upload files**, upload it (replaces the old one). The workflow runs automatically and everyone sees the change.

## Security

- Sage credentials live only in GitHub secrets. Only encrypted files are committed or published; the site is public but the data is AES-256 encrypted.
- Actions logs on a public repo are public, so the script prints counts and pass/fail only, never dollar amounts or names.

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.js`, `app.css`, `logo.png` | The dashboard (no external libraries) |
| `fetch_fin.py` | Pulls from Sage, classifies, encrypts for viewers |
| `config.enc.json` | Encrypted configuration (see above) |
| `.github/workflows/refresh.yml` | Refresh + deploy workflow |
| `requirements.txt` | Python packages |
