# Clash of Clans Discord Bot

A dedicated Discord assistant that combines **Clash of Clans API data, a separate Supabase database, intelligent retrieval, and AI-powered answers**.

## Architecture

```text
                 ┌──────────────────────┐
                 │ Clash of Clans API   │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   Sync Service       │
                 │   (write access)     │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │  Dedicated Supabase   │
                 │ current + historical │
                 │       data           │
                 └──────────┬───────────┘
                            │ read-only
                            ▼
                 ┌──────────────────────┐
                 │    AI Retrieval      │
                 │ keyword/context      │
                 │       routing        │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │    Discord Bot       │
                 │       /ask           │
                 └──────────────────────┘
```

The Discord/AI runtime is intentionally separate from the existing CoC watcher system. The sync process owns the CoC API credentials and writes to this project's database. The Discord/AI runtime uses the database through a read-only key and cannot modify production data.

## Current implementation

### Data layer

- Clan and member synchronization from the CoC API
- Current-war synchronization
- War-log synchronization
- Capital raid synchronization
- Player snapshots for historical analysis
- CWL table/schema reserved for the next sync phase
- Sync run status/error logging

### AI layer

The AI does not blindly send the whole database to the model. It first classifies the question and loads the smallest useful context, expanding into history when the question requires trends or past activity.

Examples:

```text
"who has the lowest donations?"
        ↓
member context

"who didn't attack in the current war?"
        ↓
war + member context

"how did our activity change in March?"
        ↓
member + historical snapshot context
```

The model is instructed to answer only from the supplied context and to explicitly state when the database does not contain enough evidence.

### Discord

The first command is:

```text
/ask question:<your question>
```

The command handles Discord's message-length limit by splitting longer answers into multiple messages.

## Running

Install dependencies:

```bash
npm install
```

Create your local environment file from `.env.example` and fill in the secrets.

Run the Discord bot:

```bash
npm start
```

Run the synchronization service:

```bash
npm run sync
```

For production, run the bot and sync process as separate processes/services so a Discord restart does not stop data collection and vice versa.

## Supabase setup

Run `supabase/schema.sql` in the **separate Supabase project** created for this bot.

Do not give the Discord/AI process the `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is only for synchronization. The AI/Discord side is designed to use the anonymous or a dedicated read-only key with appropriate database policies.

## Secrets

Never commit:

- CoC API tokens
- Discord bot tokens
- Supabase service-role keys
- AI API keys

Use environment variables or your hosting platform's secret manager.

## Roadmap

1. Complete robust CoC synchronization, including CWL and richer war/attack records.
2. Add structured AI retrieval tools for wars, attacks, players, capital raids, and historical trends.
3. Add Discord channel/category routing for selected AI responses.
4. Add permissions and leader-only/admin commands.
5. Add scheduled summaries and automatic war/CWL alerts.

## Project status

🚧 **Foundation in active development**
