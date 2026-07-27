# Google Chat → Claude integration (n8n workflow)

This folder contains a ready-to-import n8n workflow that connects **Google Chat** to
**Claude** (Anthropic's AI assistant). Once set up, anyone in a Google Chat space can
@mention the bot and Claude replies automatically in the space within a few seconds.

**How it works:**

```
Google Chat message → n8n Webhook → Claude API → reply posted back into the chat
```

The workflow handles three situations:

1. **New message** — the message text is sent to Claude and Claude's answer is posted
   back into the space as the reply.
2. **Bot added to a space** — a short welcome message is posted.
3. **Anything else** (bot removed, etc.) — acknowledged silently.

---

## What you need before starting

| Requirement | Notes |
|---|---|
| A running n8n instance | n8n Cloud (easiest) or self-hosted. It must be reachable from the internet over HTTPS. |
| An Anthropic API key | Create one at https://console.anthropic.com → API Keys. |
| A **Google Workspace** account | Google Chat apps can only be configured from a Google Workspace account (e.g. `you@yourcompany.com.au`). A personal `@gmail.com` account **cannot** create Chat apps — this is a Google restriction. |

---

## Step 1 — Import the workflow into n8n

1. In n8n, go to **Workflows → Add workflow → Import from file**.
2. Select `google-chat-claude-workflow.json` from this folder.

## Step 2 — Add your Anthropic API key

1. Open the **Ask Claude** node.
2. Under **Credential for Header Auth**, click **Create new credential**.
3. Set:
   - **Name**: `x-api-key`
   - **Value**: your Anthropic API key (starts with `sk-ant-...`)
4. Save. (This uses n8n's generic *Header Auth* credential — the key is stored
   encrypted in n8n, not in the workflow file.)

## Step 3 — Activate and copy the webhook URL

1. Toggle the workflow **Active** (top-right switch).
2. Open the **Google Chat Webhook** node and copy the **Production URL**.
   It looks like: `https://your-n8n-instance/webhook/google-chat-claude`

## Step 4 — Create the Google Chat app

Do this signed in with your **Google Workspace** account:

1. Go to https://console.cloud.google.com and create (or select) a project.
2. **APIs & Services → Library** → search **Google Chat API** → **Enable**.
3. On the Google Chat API page, open the **Configuration** tab and fill in:
   - **App name**: e.g. `Claude`
   - **Avatar URL**: any square image URL (e.g. your company logo)
   - **Description**: e.g. `AI assistant powered by Claude`
   - **Interactive features**: enabled
   - **Functionality**: tick *Receive 1:1 messages* and *Join spaces and group conversations*
   - **Connection settings**: choose **HTTP endpoint URL** and paste the n8n
     Production URL from Step 3
   - **Visibility**: make it available to your domain or to specific people
4. Save.

## Step 5 — Test it

1. In Google Chat, start a direct message with the app (search for its name), or add
   it to a space via *Space settings → Apps & integrations → Add apps*.
2. Send it a message (in a space, @mention it: `@Claude what's a good subject line
   for a quote follow-up email?`).
3. Claude's reply should appear in the chat within a few seconds.

---

## Customising

- **Change Claude's personality / instructions**: open the **Ask Claude** node and
  edit the `system` text inside the JSON body (e.g. "You are the assistant for KC's
  Roofing & Patios; keep answers short and tradie-friendly").
- **Change the model**: in the same JSON body, swap `claude-sonnet-5` for another
  model ID (e.g. `claude-haiku-4-5-20251001` for cheaper/faster replies, or
  `claude-opus-5` for harder questions).
- **Longer replies**: raise `max_tokens` (1024 ≈ roughly 700 words).

## Limitations & notes

- Google Chat requires the reply within ~30 seconds; the Claude call is capped at
  25 s in the workflow, which is plenty for normal questions.
- Each message is answered independently — the bot does not remember earlier
  messages in the conversation. (Conversation memory can be added later with an
  n8n AI Agent + memory node keyed on the Chat space ID.)
- Replies are plain text. Google Chat supports basic formatting (*bold* with
  asterisks), which Claude will use naturally.

## Troubleshooting

- **No reply in chat**: check the workflow's **Executions** list in n8n — a red
  execution shows exactly which node failed.
- **401 from Anthropic**: the Header Auth credential name must be exactly
  `x-api-key` and the value a valid API key.
- **Google says "app not responding"**: the workflow must be **Active** and the
  URL in the Chat app configuration must be the **Production** webhook URL
  (not the Test URL).
