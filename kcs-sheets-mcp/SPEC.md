# KCs Sheets MCP Server — Build Spec

The source spec this server was built from. Kept in the repo because section 1 is the record of
what the skills actually do to Sheets, and it is what to re-read before assuming the six tools
still cover a newly added skill.

Purpose: replace every Zapier Google Sheets call across the KCs skill set with a self hosted
remote MCP server, so Sheets access costs nothing per call.

Scope note: this covers Sheets only. Gmail send and Gmail attachment drafts stay on Zapier
(native Gmail cannot do either), as does Xero BP. Those are low volume. Sheets is the high
volume layer and the one worth killing.

## 1. What the skills actually do to Sheets

Audited across 20 skill files. Every distinct operation, and who needs it:

| # | Operation | Skills that need it |
|---|---|---|
| R1 | Read an A1 range as **values** | materials check, scorecard, draftee assignment, schedule installer calendar, quote send, weekly standup |
| R2 | Read an A1 range as **formulas** (`valueRenderOption=FORMULA`) | quote self training, quote generation (Apollo/Ausdeck conversions), quote pipeline HIP render |
| R3 | **List tabs** and sheet metadata | materials check (discovers `PO *` tabs), quote send (supplier detection by tab names), closer log |
| R4 | **Find a row** by matching a value in one column | enquiry intake (duplicate check on col F email), design approval (col A quote no.), closer log (col A quote no.) |
| R5 | **Read N rows from a start row** to locate the first blank | enquiry intake, new enquiry to CRM, quote watchdog (the ledger runs past 1,700 rows) |
| W1 | **Write specific cells**, several ranges in **one** call | quote generation (Quote Sheet header block), enquiry intake (ledger row B to L) |
| W2 | **Append a row** to the bottom of a tab | completed photo rename (gallery sheet), closer log (Active Pipeline, Won Lost Log, Objections) |
| W3 | **Update an existing row** in place | closer log (stage changes, closing), enquiry intake, new enquiry to CRM |

Everything else the skills do against Drive (find file, copy template, read PDF) is already on the
native Google Drive connector and does not move.

## 2. Spreadsheets in scope

| Sheet | ID | Access |
|---|---|---|
| KCs Ledger 2026 (Quotes, Lead Tracker, Call Log) | `1sLw8776rK6WEd01gW0Weq-R6bdeAdduaVul8IpojUjQ` | read + write |
| Project Schedule (Job Schedule tab) | `14kpETbDJYtbRzIrxAlMMaxW1-cqKJMmPpifcJfwVpU0` | read |
| The Closer Tracker | `1D8Z6MNnICnR_KfHc3dXsIRjbx610158li_8SvTED7g0` | read + write |
| Kevy Training Log | `1O-ZjfNTdIjiWO7CSeaGyCG7rmkN5_oD0WNhDvuRjoh8` | read + write |
| Past Projects Update (gallery) | `1LpwYBNFViprmanTLfktP6VMykFyu0-0CPqVtW9Sgb60` | read + write |
| KCs Comms Logbook | `1UJLuQ36erDYFNfo-jSHKV8CxIMCUCjAAnInVxG-VlP8` | read + write |
| KCRP & KCBP Projects Ledger V2 | `1yYHwVo_WGjO2TjYeYNW6sjVfb2iGIm2gYEeRb5IgUr4` | read + write |
| Quote workbooks in Quotes 2026 S&I | dynamic, one per job | read + write |

The five fixed sheets can be allowlisted by ID. Quote workbooks cannot, so they need a folder
scoped rule instead: allow any spreadsheet whose Drive parent is the Quotes 2026 S&I folder.

## 3. Tool surface

Six tools. Deliberately narrow. Do not expose a generic "call any Sheets API endpoint" tool,
which is what `google_sheets_make_api_mutating_request` currently is and is the reason quote
generation can write anywhere in a workbook.

See the README for the implemented signatures.

`sheets_find_row` and `sheets_next_blank_row` are the ones that matter most. Today the skills do
this by pulling 50 to 80 rows at a time into context and eyeballing them. Doing the scan server
side turns several round trips and a lot of context into one small call.

## 4. Guard rails

1. **Spreadsheet allowlist.** Reject any ID not in the fixed list and not parented to Quotes 2026 S&I.
2. **Protected columns.** Reject writes to Ledger column AE (colour form link, sheet generated).
   Reject writes to column A (pre filled quote numbers).
3. **No open ended writes.** `sheets_write_cells` requires a bounded A1 range. Reject a bare tab name.
4. **Read only sheets.** Project Schedule is read only. Enforce it, do not rely on convention.
5. **Append never overwrites.** Use `values.append` with `insertDataOption=INSERT_ROWS`.
6. **Return the row number** on every write, so the skill can re read and verify placement.

## 5. Auth and hosting

**Google side.** A Google Cloud service account with the Sheets API enabled. Share each of the five
fixed sheets, plus the Quotes 2026 S&I folder, with the service account email as Editor (Viewer for
Project Schedule). The current Zapier connection authenticates as kcsbpstaff@gmail.com, so
whatever that account can see is the set to replicate.

**Claude side.** Added under Customize > Connectors as a custom connector by URL. Claude reaches it
from Anthropic's cloud, so it must be publicly resolvable over HTTPS. Two ways to protect it:
secret in the path, or request header auth.

**Hosting.** Vercel Functions, streamable HTTP transport.

### Resolved open items

- **Vercel commercial use.** Closed. Hobby is restricted to non-commercial personal use, so this
  needs Pro — and the account is already on Pro, with the $20 monthly credit untouched. Not a
  blocker.
- **Deployment protection.** New Vercel projects default to Vercel Authentication on all
  `*.vercel.app` URLs, which would put an SSO redirect in front of the connector endpoint. It must
  be disabled for this project, or the endpoint moved to a custom domain. See the README.
- **Request header auth.** Confirmed as supported but still beta, with the connector dialog not
  reliably exposing the field. The server therefore accepts the path secret, a bearer header, and
  an `X-MCP-Token` header, so whichever the dialog offers will work.

## 6. What this changes, skill by skill

Goes **fully off Zapier**: materials check, quote watchdog, enquiry intake, new enquiry to CRM,
closer log, scorecard, quote self training, completed photo rename, quote generation, quote pipeline.

Keeps **one** Zapier call each: design approval (Gmail draft with attachments), draftee assignment
(Gmail send), weekly standup prep (Xero BP).

## 7. Build order

1. Service account, API enabled, sheets shared. Test with a plain script before any MCP code.
2. Server with `sheets_read_range` and `sheets_list_tabs` only. Deploy. Add as custom connector.
3. Point **one** read only skill at it (quote watchdog is the safest) and run it live for a week.
4. Add the find and next blank tools. Repoint enquiry intake.
5. Add the write tools with guard rails. Repoint closer log, then quote generation last, since it
   writes into live quote workbooks.
6. Update each SKILL.md tool reference as you go, and delete the "KEEP ON ZAPIER, no native Sheets
   connector" notes that are scattered through them.

Do not flip everything at once. The Ledger is the CRM and a bad write is expensive.

## 8. Caveats

- Everything in sections 1 and 2 is read directly out of the skill files, so it is accurate as of
  the date of the audit. If you add skills, re audit before assuming the tool surface still covers
  them.
