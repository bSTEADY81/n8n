# Repointing the skills off `kcs-sheets.ps1`

Seven skills route Sheets **writes** through `kcs-sheets.ps1`, a desktop-only PowerShell
script, and each carries this instruction:

> **Cloud sessions:** MCP reads and native Gmail/Drive work identically on claude.ai, but
> `kcs-sheets.ps1` is desktop-only — in a cloud session, do the reads/drafts and tell Brad the
> sheet write needs the desktop session (do not fall back to Zapier).

That means the writes do not happen unless Brad is at the Mac — including the 9:00 AM
follow-up run, the Monday 07:00 scorecard, and enquiry intake on the `[New Enquiry]` trigger,
all of which execute in the cloud.

The MCP server now has write tools with the same `expect` guard the script provided, and full
`spreadsheets` scope. Repointing removes the desktop dependency entirely.

## Translation

| `kcs-sheets.ps1` | MCP tool |
|---|---|
| `-Action updateCells -SsId <id> -ValuesFile [{range, value, expect}]` | `sheets_write_cells` — `{spreadsheetId, updates: [{range, values, expect}]}` |
| `-Action appendRow -SsId <id> -Tab <tab> -ValuesFile [[…]]` | `sheets_append_row` — `{spreadsheetId, tab, values: […]}` |

**The one shape difference that matters:** the script took a scalar `value` and `expect` per
cell. The tool takes them as rows — arrays of arrays — matching the range.

```jsonc
// was:  {"range": "Quotes!H1405", "value": "Patio", "expect": ""}
{ "range": "Quotes!H1405", "values": [["Patio"]], "expect": [[""]] }

// a whole row block, one call:
{ "range": "Quotes!B1405:L1405", "values": [["Smith", "…", "…"]], "expect": [["", "", ""]] }
```

`expect` is optional but should be used on every Ledger write. Any mismatch aborts the entire
batch before a single cell is written and names the offending cell. Blank, `""` and absent all
compare equal.

Protected columns still apply: `A` and `AE` on the Ledger `Quotes` tab reject in-place writes.
Appends are exempt.

## The edits

In all seven, **delete the "Cloud sessions:" paragraph** quoted above — it is no longer true.
Replace it with:

> **Cloud sessions:** everything in this skill works identically on claude.ai and on the
> desktop. Sheets reads and writes both go through the KCs Sheets MCP.

Then, per skill:

### kcs-enquiry-intake (line 21)
Replace the `Sheets **writes**` bullet with:

> - Sheets **writes**: **KCs Sheets MCP** — `sheets_write_cells` with
>   `updates: [{range: "Quotes!B1405:L1405", values: [[…]], expect: [[…]]}]`. Addresses cells by
>   A1 letter, so the old header-name mis-route is structurally impossible. Always pass `expect`
>   (current cell values, usually `""`) so a shifted row refuses the write.

### kcs-quote-followup and kcs-quote-followup-auto (lines 16 / 20)
Replace `Ledger **writes** (cols M/N/Q–Y/AB): kcs-sheets.ps1 endpoint — -Action updateCells with
[{range,value,expect}] (guarded, live since 2026-08-23); -Action appendRow for new rows` with:

> Ledger **writes** (cols M/N/Q–Y/AB): **KCs Sheets MCP** — `sheets_write_cells` with
> `[{range, values, expect}]` (guarded); `sheets_append_row` for new rows.

### kcs-completed-photo-rename (lines 17 and 64)
Line 17 — replace `Gallery **writes**: kcs-sheets.ps1 -Action appendRow (values via -ValuesFile)`:

> Gallery **writes**: **KCs Sheets MCP** — `sheets_append_row`.

Line 64 — replace the endpoint invocation:

> - Append gallery rows with `sheets_append_row`:
>   `{spreadsheetId: "1LpwYBNFViprmanTLfktP6VMykFyu0-0CPqVtW9Sgb60", tab: "Sheet1", values: […]}`

The temp-file caveat ("powershell -File strips inline quotes") goes with it — no longer relevant.

### kcs-closer-log (lines 138 and 153)
Line 138:

> 5. **Write the row** via the KCs Sheets MCP: append with `sheets_append_row`, update existing
>    cells with `sheets_write_cells` (guarded by `expect`).

Line 153 — replace the `**Writes — Sheets endpoint** (C:\Users\BJ\.claude\bin\kcs-sheets.ps1; The
Closer Tracker ID must be in the endpoint ALLOWED_SS list)` heading with:

> **Writes — KCs Sheets MCP.** The Closer Tracker is on the server's allowlist; no separate
> configuration.

### kcs-quote-generation (line 36)

> 4. **Fill Quote Sheet header** — `sheets_write_cells` with
>    `updates: [{range: "Quote Sheet!B4", values: [["Q7404"]]}, …]` — all header cells in ONE
>    call. Quote workbooks are admitted automatically by their Drive parent folder; resolve the
>    workbook ID with `sheets_find_quote_workbook` first.

### kcs-quote-self-training (line 17)
Replace `Training Log **writes**: kcs-sheets.ps1 -Action appendRow (SsId 1O-Zj…)`:

> Training Log **writes**: **KCs Sheets MCP** — `sheets_append_row` with
> `spreadsheetId: "1O-ZjfNTdIjiWO7CSeaGyCG7rmkN5_oD0WNhDvuRjoh8"`.

## Compatibility already handled server side

- **`matchMode`** — the skills call `sheets_find_row` with `matchMode: exact`. The parameter is
  named `match` here, so `matchMode` is accepted as an alias. Left unhandled it would have been
  ignored and quote-number lookups would have quietly become case-insensitive.
- **`?k=`** — the connector passes the shared secret as `k`, which the server reads.
- **`MCP_SHARED_SECRET`** — accepted alongside `MCP_AUTH_TOKEN`.

Nothing in the skills needs to change for any of those.

## Verify after repointing

Every one of these skills already mandates reading the row back after a write. Keep that. The
`expect` guard prevents writing to the wrong row; the read-back confirms the values landed in
the intended columns. They catch different failures.
