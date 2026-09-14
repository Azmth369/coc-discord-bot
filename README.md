# Clash of Clans Discord AI Bot

A production-oriented Discord assistant combining **Clash of Clans API data, a dedicated Supabase database, targeted retrieval, deterministic analytics, and two AI providers**.

## Commands

- `/ask` → **Sarvam AI** for the normal, faster everyday clan analysis path.
- `/tell` → **Gemini** for the deeper Gemini analysis path.

Both commands use the same database retrieval and analytics layer, so they answer from the same Clash of Clans data rather than from unrelated general knowledge.

## Architecture

```text
Clash of Clans API
        │
        ▼
 Sync scheduler ──────► Dedicated Supabase
  (write key)             │
                          │ read-only
                          ▼
                  Retrieval + Analytics
                     │           │
                     ▼           ▼
                 Sarvam AI    Gemini AI
                     │           │
                     └─────┬─────┘
                           ▼
                        Discord
                 /ask            /tell
                           │
                           └── Forward button → configured AI channel
```

This project is independent of the existing CoC watcher database. The sync layer owns the CoC API and Supabase service-role credentials; Discord/AI only reads through the anonymous/read-only key.

## Features

### Data collection
- Clan/member data
- Current war polling
- War-log history
- Normalized war members and attacks
- CWL seasons, rounds, individual CWL wars, members and attacks
- Capital raid seasons
- Player snapshots for historical trends
- Sync status/error logging
- Configurable polling intervals
- One-time importer for legacy attack-log exports

### AI retrieval
Questions are classified before retrieval so the model receives relevant data instead of an uncontrolled database dump.

Examples:

```text
/ask question:"who has the lowest donations?"
/ask question:"who didn't attack in the current war?"
/ask question:"how are we doing in the current war?"
/tell question:"summarize our wars against Dark Land"
/tell question:"show me the attacks from our war against XYZ"
/ask question:"what happened in March 2026?"
```

Retrieval follows the intended safe-expansion strategy:

1. Match the question to a data domain.
2. Retrieve the narrowest useful context.
3. If a named opponent search returns nothing, expand to recent war history.
4. Give the selected context to the requested AI provider.
5. The provider must never invent missing statistics, attacks, dates, opponents or outcomes.

### Two AI providers

`/ask` uses Sarvam's OpenAI-compatible Chat Completions API and defaults to `sarvam-105b-conversations`, a conversational variant intended for real-time dialogue. `SARVAM_MODEL` can override it.

`/tell` uses the Gemini REST API with the existing model fallback/retry chain. `GEMINI_MODEL` controls the preferred Gemini model.

### Deterministic analytics
The application calculates evidence such as missed attacks and player trends in code before AI interpretation. This reduces hallucination risk for straightforward numerical questions.

### Discord forwarding
Both `/ask` and `/tell` responses can show a **Forward to AI channel** button. Set `AI_FORWARD_CHANNEL_ID` to the target text-channel ID. The answer is kept temporarily in memory and can only be forwarded by the user who requested it.

## Legacy attack-log import

If you have an older `attack_log` CSV export, do **not** upload the raw CSV into GitHub or commit it to the repository because it can contain player names and tags.

The repository includes a one-time importer that converts the old mixed format into the current split schema:

- `context=capital` → `capital_attacks` plus a lightweight `capital_raids` event record
- `context=war` → `war_attacks` plus a lightweight `wars` event record
- Existing rows are safely upserted using the same conflict keys as the live sync, so running the importer again does not intentionally create duplicate attack rows.
- Missing fields such as historical attack timestamps, war results, or Capital summary totals are left unknown rather than invented.

Run it from the project environment after placing the CSV somewhere accessible to that environment:

```bash
npm run import:legacy -- /path/to/attack_log_rows.csv
```

The importer uses `SUPABASE_SERVICE_ROLE_KEY`, so run it only in the trusted sync environment. Never put that key into Discord/client-side code.

## Environment

Configure:

- `COC_API_TOKEN`
- `COC_CLAN_TAG`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — sync and trusted one-time imports only
- `SUPABASE_ANON_KEY` — Discord/AI read-only access
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- optional `DISCORD_GUILD_ID` for instant guild command registration
- optional `AI_FORWARD_CHANNEL_ID`
- `SARVAM_API_KEY` — required for `/ask`
- optional `SARVAM_MODEL` (defaults to `sarvam-105b-conversations`)
- `GEMINI_API_KEY` — required for `/tell`
- optional `GEMINI_MODEL`

Never commit secrets or raw player data exports.

## Supabase setup

Create a **separate Supabase project** for this bot and run `supabase/schema.sql` in its SQL editor.

The schema enables RLS and provides `anon` SELECT policies for the AI data tables. The service-role key is used only by the synchronization process and must never be placed in Discord or client-side code.

## Run locally

```bash
npm install
npm start
```

`npm start` launches both the Discord bot and sync scheduler. A lightweight HTTP health endpoint is available at `/health` on `PORT` (default `3000`).

Run only the sync scheduler:

```bash
npm run sync
```

Run one complete sync pass:

```bash
npm run sync:once
```

## Security model

```text
CoC API token ──► sync service ──write──► Supabase
                                         ▲
                                         │
                           read-only anon key
                                         │
                                  AI + Discord
```

Do not give the Discord bot the Supabase service-role key.
