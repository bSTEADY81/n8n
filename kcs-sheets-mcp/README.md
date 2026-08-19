# KCs Sheets MCP Server

A self-hosted remote MCP server that gives the KC's skills scoped Google Sheets access, so
Sheets calls stop going through Zapier and stop costing per call.

Sheets only. Gmail send, Gmail attachment drafts and Xero BP stay on Zapier — native Gmail
cannot do the first two, and those flows are low volume anyway.

## Tool surface

Six tools. No generic "call any Sheets endpoint" tool, deliberately — that passthrough is why
quote generation can currently write anywhere in a workbook.

| Tool | Inputs | Google API |
|---|---|---|
| `sheets_list_tabs` | `spreadsheetId` | `spreadsheets.get` (fields: `sheets.properties`) |
| `sheets_read_range` | `spreadsheetId`, `ranges[]`, `render: VALUE \| FORMULA` | `values.batchGet` |
| `sheets_find_row` | `spreadsheetId`, `tab`, `column`, `value`, `direction`, `match`, `startRow` | `values.batchGet`, matched server side |
| `sheets_next_blank_row` | `spreadsheetId`, `tab`, `column`, `startRow` | `values.batchGet`, scanned server side |
| `sheets_write_cells` | `spreadsheetId`, `updates[{range, values}]`, `valueInputOption` | `values.batchUpdate` |
| `sheets_append_row` | `spreadsheetId`, `tab`, `values[]`, `valueInputOption` | `values.append` with `insertDataOption=INSERT_ROWS` |

`sheets_find_row` and `sheets_next_blank_row` are the ones that pay for themselves. The skills
currently pull 50–80 rows into context and eyeball them; these do the scan server side and
return a row number, which matters most on the Ledger now it runs past 1,700 rows.

`sheets_find_row` extras beyond the spec, both driven by what the skills actually match on:

- `match` — `insensitive` (default; right for emails and quote numbers), `exact`, `contains`.
- `matchCount` and `allMatchRows` — the enquiry duplicate check needs to know a second hit exists,
  not just that one was found.

## Guard rails

Enforced in code, not in prose the skill has to remember.

1. **Spreadsheet allowlist.** The five fixed sheets are pinned by ID in `src/config.ts`. Quote
   workbooks cannot be, so they are admitted by Drive parentage: any spreadsheet whose parent is
   the Quotes 2026 S&I folder. A Drive lookup failure rejects rather than admits.
2. **Protected columns.** Ledger column `AE` (sheet-generated colour form link) and column `A`
   (pre-filled quote numbers) reject in-place writes, scoped to the `Quotes` tab. Appends are
   exempt — a new row cannot clobber a pre-filled value.
3. **No open-ended writes.** `sheets_write_cells` requires a range that names a tab and pins both
   corners: `Quotes!B12:L12` passes, `Quotes`, `Quotes!B:L` and `B12:L12` do not. Values that
   overflow the declared range are rejected before the call leaves the server.
4. **Read-only sheets.** Project Schedule is `access: 'read'`. Writes to it fail regardless of what
   the service account is shared as.
5. **Append never overwrites.** `values.append` always uses `insertDataOption=INSERT_ROWS`.
6. **Every write returns its row number**, so the skill can re-read and verify placement — which
   enquiry intake already requires.

Plus sanity ceilings in `LIMITS` (`src/guards.ts`) so a malformed call cannot ask Google for a
million cells.

## Setup

### 1. Google side

1. Create a Google Cloud project and enable the **Google Sheets API** and the **Google Drive API**
   (Drive is needed for the folder-parentage rule and nothing else — the server only ever asks
   Drive for `parents` and `capabilities`).
2. Create a service account and download its JSON key.
3. Share, as the service account's email:
   - **Editor**: KCs Ledger 2026, The Closer Tracker, Kevy Training Log, Past Projects Update,
     and the **Quotes 2026 S&I folder** (folder-level, so new quote workbooks inherit it).
   - **Viewer**: Project Schedule.

   The current Zapier connection authenticates as `kcsbpstaff@gmail.com`, so whatever that account
   can see is the set to replicate.

4. Verify before writing any connector config:

   ```bash
   cp .env.example .env      # fill it in
   npm run smoke
   ```

   `scripts/smoke.mjs` imports nothing from `src/`. A pass means the Google side is right,
   independently of the server. It is read-only and never writes to a sheet.

### 2. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MCP_AUTH_TOKEN` | yes | Long random string. `openssl rand -hex 32`. Used as both the path secret and the accepted bearer token. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | either | The whole downloaded key file, raw JSON or base64. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` | or these | Split form. `GOOGLE_PRIVATE_KEY` may contain literal `\n`. |
| `QUOTES_FOLDER_ID` | yes | Drive folder ID for Quotes 2026 S&I. |
| `EXTRA_SHEET_IDS` | no | Comma-separated escape hatch for one-off spreadsheets. Normally empty. |

### 3. Deploy

```bash
npx vercel link
npx vercel env add MCP_AUTH_TOKEN production
npx vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production
npx vercel env add QUOTES_FOLDER_ID production
npx vercel deploy --prod
```

`npx vercel dev` runs it locally at `http://localhost:3000/mcp/<token>`.

> **Check the plan first.** Vercel's fair use guidelines restrict Hobby teams to non-commercial
> personal use, and define commercial as any deployment used "for the purpose of financial gain of
> anyone involved in any part of the production of the project". Internal tooling for a trading
> business is squarely that, so this needs a **Pro** team. Confirm at
> `vercel.com/<team>/~/settings/billing` before going live. Cloudflare Workers' free tier carries no
> equivalent restriction if you would rather not pay — only `api/mcp.ts` is Vercel-specific,
> everything under `src/` is portable.

> **Turn Vercel Authentication off for this project.** New Vercel projects default to
> `ssoProtection: all_except_custom_domains`, which puts an SSO redirect in front of every
> `*.vercel.app` URL. Claude reaches the connector from Anthropic's cloud with no Vercel session, so
> it would get the login page instead of a JSON-RPC response and the connector would never finish
> handshaking. Fix it one of three ways, in order of preference:
>
> 1. Project → Settings → Deployment Protection → **Vercel Authentication: Disabled**. The server
>    has its own shared-secret auth, so this is not leaving it open.
> 2. Put it on a custom domain — `all_except_custom_domains` already exempts those.
> 3. Leave protection on and use a Protection Bypass for Automation token, appending
>    `x-vercel-protection-bypass` to the connector URL. Most fiddly; two secrets to rotate instead
>    of one.

### 4. Add as a Claude connector

Customize → Connectors → Add custom connector, by URL:

```
https://<your-deployment>/mcp/<MCP_AUTH_TOKEN>
```

The secret lives in the path, which works with a plain URL add today. If your connector dialog
shows a **Request headers** field, prefer that: point it at `https://<your-deployment>/mcp` and set
`Authorization: Bearer <MCP_AUTH_TOKEN>`. Header auth is still beta and has been rolling out
unevenly, so use whichever your dialog actually offers — the server accepts both, plus an
`X-MCP-Token` header as a third fallback.

Rotate by changing `MCP_AUTH_TOKEN` and updating the connector URL. The path secret appears in
Vercel's request logs, so treat rotation as routine rather than incident-only.

## Rolling it out

Do not flip everything at once. The Ledger is the CRM and a bad write is expensive.

1. Deploy read-only first — `sheets_read_range` and `sheets_list_tabs` are the tools to trust first.
2. Point **quote watchdog** at it and run it live for a week. It is the safest: read-only, daily,
   and its output is a report you can eyeball against the sheet.
3. Then repoint **enquiry intake** onto `sheets_find_row` and `sheets_next_blank_row`.
4. Then the writes: **closer log** first, **quote generation** last, since it writes into live
   quote workbooks.
5. Update each `SKILL.md` tool reference as you go, and delete the "KEEP ON ZAPIER, no native
   Sheets connector" notes scattered through them.

### Skill → tool mapping

| Skill | Replaces | With |
|---|---|---|
| materials check | Zapier range read + tab list | `sheets_list_tabs`, `sheets_read_range` |
| quote watchdog | paged ledger reads | `sheets_read_range`, `sheets_next_blank_row` |
| enquiry intake | duplicate check + blank-row hunt + row write | `sheets_find_row`, `sheets_next_blank_row`, `sheets_write_cells` |
| new enquiry to CRM | same as above | same as above |
| closer log | tab list + row append + row update | `sheets_list_tabs`, `sheets_append_row`, `sheets_write_cells` |
| scorecard | range reads | `sheets_read_range` |
| quote self training | formula reads + log append | `sheets_read_range` (`render: FORMULA`), `sheets_append_row` |
| completed photo rename | gallery row append | `sheets_append_row` |
| quote generation | `google_sheets_make_api_mutating_request` | `sheets_write_cells` (bounded ranges only) |
| quote pipeline | formula reads for HIP render | `sheets_read_range` (`render: FORMULA`) |

Still one Zapier call each: design approval (Gmail draft with attachments), draftee assignment
(Gmail send), weekly standup prep (Xero BP).

## Development

```bash
npm install
npm test          # 66 tests, no network
npm run build     # tsc --noEmit
```

Tests cover A1 parsing, the auth comparison, every guard rail, each tool against a fake Sheets
client, and an end-to-end MCP session over an in-memory transport. Nothing in the suite touches
Google or Vercel.

## Layout

```
api/mcp.ts          Vercel handler: auth, stateless streamable HTTP transport
src/server.ts       MCP server factory
src/tools.ts        The six tools
src/guards.ts       Allowlist, protected columns, bounded ranges, read-only sheets, limits
src/config.ts       Spreadsheet registry and environment parsing
src/sheetsClient.ts Sheets and Drive REST calls
src/googleAuth.ts   Service account JWT to access token, cached per instance
src/a1.ts           A1 notation parsing
src/auth.ts         Constant-time shared-secret check
scripts/smoke.mjs   Standalone Google-side verification, imports nothing from src/
```

## Known gaps

- The allowlist is compiled in. Adding a sixth fixed sheet means a code change (or a stopgap entry
  in `EXTRA_SHEET_IDS`, which grants read+write with no protected columns).
- Column-level protection is per spreadsheet and optionally per tab. It does not do row ranges, so
  it cannot express "column A is protected below row 1".
- `sheets_find_row` and `sheets_next_blank_row` scan at most 5,000 rows per call and say so in the
  response (`scanTruncated`). The Ledger at ~1,700 rows has plenty of headroom; re-run with a
  higher `startRow` if that ever changes.
- If a skill needs to re-audit its Sheets usage after this, re-read section 1 of the build spec
  before assuming the six tools still cover it.
