# Deploying — the runbook

**No terminal required.** Both halves of this are browser tasks, roughly ten minutes total.
The CLI commands further down are an alternative for anyone who prefers them, not the main path.

## The short version

1. **console.cloud.google.com** — new project → enable Sheets API + Drive API → create a service
   account → Keys → Add key → JSON. Copy the service account email.
2. **Share the sheets** with that email (table in step 2 below). Or paste the email to Claude,
   which can do all six through the Google Drive connector.
3. **vercel.com/new** → import `bSTEADY81/n8n` → set **Root Directory** to `kcs-sheets-mcp`,
   **Production Branch** to `claude/kcs-sheets-mcp-server-kmac63` → add the three environment
   variables → Deploy.
4. Confirm Settings → Deployment Protection → Vercel Authentication is **Disabled**.
5. Add `https://<deployment>/mcp/<MCP_AUTH_TOKEN>` as a custom connector.

The three environment variables:

| Name | Value |
|---|---|
| `MCP_AUTH_TOKEN` | any long random string — a password manager's generator is fine |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the entire contents of the downloaded JSON key file |
| `QUOTES_FOLDER_ID` | the segment after `/folders/` in the Quotes 2026 S&I Drive URL |

`GOOGLE_SERVICE_ACCOUNT_JSON` takes the raw JSON pasted straight in — the server handles the
embedded newlines in the private key. Base64 is accepted too but is not necessary.

---

## The CLI version

Needs `gcloud` authenticated to the Google account that owns the sheets, and `vercel`
authenticated to the `bjs-projects-4a11c607` team.

```bash
git clone -b claude/kcs-sheets-mcp-server-kmac63 https://github.com/bSTEADY81/n8n
cd n8n/kcs-sheets-mcp && npm install
```

---

## 1. Google Cloud

Project IDs are globally unique, so pick something unlikely to collide.

```bash
gcloud auth login                       # as the account that owns the sheets
export GCP_PROJECT=kcs-sheets-mcp-$(date +%Y)

gcloud projects create "$GCP_PROJECT" --name="KCs Sheets MCP"
gcloud config set project "$GCP_PROJECT"

# Sheets for the data. Drive only so the server can ask a quote workbook for its
# parents and check the folder-scoped allowlist rule.
gcloud services enable sheets.googleapis.com drive.googleapis.com

gcloud iam service-accounts create kcs-sheets-mcp \
  --display-name="KCs Sheets MCP server"

export SA_EMAIL="kcs-sheets-mcp@${GCP_PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts keys create ./sa-key.json --iam-account="$SA_EMAIL"

echo "Service account: $SA_EMAIL"
```

**No IAM roles are needed.** Access to the sheets comes from Drive sharing, not from GCP IAM —
granting project roles here would do nothing. This is the step people usually get wrong.

`sa-key.json` is a live credential. It is already covered by `.gitignore`; delete it once the
Vercel env var is set.

## 2. Share the sheets

Share these with the service account email printed above:

| Sheet | Role |
|---|---|
| KCs Ledger 2026 | Editor |
| The Closer Tracker | Editor |
| Kevy Training Log | Editor |
| Past Projects Update | Editor |
| **Quotes 2026 S&I folder** (share the folder, not the files) | Editor |
| Project Schedule | **Viewer** |

Sharing the folder rather than each workbook is what makes new quote jobs work without a code
change — a new workbook inherits the permission, and the server admits it by Drive parentage.

Uncheck "Notify people" — service accounts have no inbox.

Brad can also hand the service account email back to the cloud session, which can do this sharing
through the Google Drive connector rather than by hand.

## 3. Verify Google before touching Vercel

```bash
cp .env.example .env
```

Fill in `.env`:

```bash
MCP_AUTH_TOKEN=$(openssl rand -hex 32)
GOOGLE_SERVICE_ACCOUNT_JSON=$(base64 -w0 sa-key.json)   # base64 keeps it to one line
QUOTES_FOLDER_ID=...                                     # from the folder's Drive URL
```

The folder ID is the segment after `/folders/` in
`https://drive.google.com/drive/folders/<THIS>`.

Then:

```bash
npm run smoke
```

Expect a line per sheet. It checks each one is reachable *and* that the edit capability matches
what the server expects, so a sheet shared as Viewer when it needs Editor is caught here rather
than at the first write. It never writes to a sheet.

Do not move on until this is all `ok`.

## 4. Vercel

```bash
npx vercel login
npx vercel link --scope bjs-projects-4a11c607     # run from inside kcs-sheets-mcp/

npx vercel env add MCP_AUTH_TOKEN production
npx vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production   # the base64 string
npx vercel env add QUOTES_FOLDER_ID production

npx vercel deploy --prod
```

`vercel deploy` uploads the local directory, so it does not matter that this branch is unmerged.

Then confirm deployment protection is off — a project created through the dashboard defaults to
Vercel Authentication on all `*.vercel.app` URLs, which would put an SSO redirect in front of the
endpoint and silently break the connector handshake:

```bash
npx vercel project inspect     # or: Settings > Deployment Protection
```

Vercel Authentication must read **Disabled**. The server has its own shared-secret auth.

Finally, delete the key file:

```bash
rm sa-key.json
```

## 5. Smoke the deployment

```bash
curl -sS -X POST "https://<deployment>/mcp/<MCP_AUTH_TOKEN>" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expect the six tool definitions. Two failure modes worth telling apart:

- **HTML login page** — Vercel Authentication is still on. Back to step 4.
- **`{"error":"Server misconfigured: Missing required environment variable ..."}`** — an env var
  did not land. `npx vercel env ls` and redeploy; env changes need a new deployment.
  To see which ones the server can actually find, add `?health=1` to the authenticated URL:
  `curl "https://<deployment>/mcp/<MCP_AUTH_TOKEN>?health=1"` reports each variable as
  present or missing by name. Values are never returned.
- **`{"error":"Unauthorized"}`** — the token in the URL does not match `MCP_AUTH_TOKEN`.

## 6. Add the connector

Claude → Customize → Connectors → Add custom connector:

```
https://<deployment>/mcp/<MCP_AUTH_TOKEN>
```

If the dialog offers a **Request headers** field, prefer `https://<deployment>/mcp` with
`Authorization: Bearer <MCP_AUTH_TOKEN>` — same secret, kept out of the URL and out of Vercel's
request logs. Header auth is still beta and the field is not always present, which is why the
server accepts both.

## 7. Then stop

Point **quote watchdog** at it and nothing else. Run it live for a week before repointing anything
that writes. Rollout order is in the README; the Ledger is the CRM and a bad write is expensive.
