# Deployment

Live at **https://kcs-sheets-mcp.vercel.app**, Vercel project `kcs-sheets-mcp` on team
`bjs-projects-4a11c607`.

Every push to `claude/kcs-sheets-mcp-server-kmac63` redeploys automatically, in about 16
seconds. There is no manual deploy step and no CLI involved.

| Setting | Value |
|---|---|
| Git repository | `bSTEADY81/n8n` |
| Root Directory | `kcs-sheets-mcp` |
| Production Branch | `claude/kcs-sheets-mcp-server-kmac63` |
| Framework Preset | Other |
| Node.js | 24.x |

## Authentication

The server authenticates to Google as a **user**, via an OAuth refresh token — not as a
service account. It therefore reaches every sheet that account can already see, which is why
nothing needs sharing with it. The allowlist in `src/config.ts` is the access boundary, not
Drive permissions.

Granted scopes, as reported by Google rather than assumed:

- `https://www.googleapis.com/auth/spreadsheets` — read and write
- `https://www.googleapis.com/auth/drive.readonly` — folder parentage and workbook lookup only

Callers present the shared secret as `?k=` or `?token=` in the query string, as a path segment
(`/mcp/<secret>`), as `Authorization: Bearer`, or as `X-MCP-Token`. The connector uses `?k=`.

## Environment variables

Set on the Vercel project, so they survive redeploys. Changing one requires a new deployment
to take effect.

| Name | Purpose |
|---|---|
| `MCP_SHARED_SECRET` | The shared secret. `MCP_AUTH_TOKEN` is accepted as an alias. |
| `GOOGLE_CLIENT_ID` | OAuth client |
| `GOOGLE_CLIENT_SECRET` | OAuth client |
| `GOOGLE_REFRESH_TOKEN` | The grant the server exchanges for access tokens |

`QUOTES_FOLDER_ID` is not set, so the Quotes 2026 S&I folder is resolved by name once per
instance and cached. Set it to skip that lookup.

A service account is supported as an alternative — see the README — but is not what runs here.

## Health check

```bash
curl "https://kcs-sheets-mcp.vercel.app/api/mcp?k=<secret>&health=1"
```

Reports each environment variable as present or missing **by name only**, plus the Google
scopes actually granted and whether they permit writing. No secret value is ever returned. It
sits behind the same auth as everything else.

This is the first thing to run when something looks wrong. It distinguishes a missing variable
from a bad secret from a scope problem in one call.

## Rotating the shared secret

1. Vercel → Settings → Environments → Production → `MCP_SHARED_SECRET` → Edit
2. Redeploy — environment changes only apply to new deployments
3. Update the connector URL's `k=` value to match

The value is stored as Sensitive and cannot be read back out of Vercel, so rotation is the
recovery path if it is ever lost.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Client reports "token expired" / asks to re-authorize | A 401. There is no OAuth flow here — the secret is wrong or being sent in a form the server does not read. Check the connector URL against the auth section above. |
| `Server misconfigured: Missing required environment variable` | Run the health check; it names which one. |
| `REFUSED: ... not in the allowlist` | Working as intended. Add the sheet to `FIXED_SHEETS` in `src/config.ts` and push. |
| Google 403 on a write | Scope. Check `canWriteSheets` in the health output. |
| Build fails with "root directory does not exist" | Production Branch is pointing somewhere without `kcs-sheets-mcp`. |

## Adding a spreadsheet

Edit `FIXED_SHEETS` in `src/config.ts`, push. There is no environment variable for this and no
runtime configuration — the allowlist is compiled in deliberately, so every change to what the
server can reach is a reviewable commit.
