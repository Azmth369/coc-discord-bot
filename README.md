# Clash of Clans Discord Bot

A Discord bot designed to connect **Clash of Clans clan data, AI-powered analysis, and Discord** into one system.

## Overview

This project is being built as a dedicated Discord assistant for a Clash of Clans clan. It will periodically retrieve clan and member information from the **Clash of Clans API**, maintain its own synchronized database, and make that information available through Discord.

The long-term goal is to make it possible for clan members and leaders to ask natural-language questions about the clan and receive useful, data-backed answers without manually checking multiple sources.

## Core Components

- **Clash of Clans API** — provides current clan and player data.
- **Database** — stores synchronized clan/member information and, where useful, historical data.
- **Discord Bot** — provides the interface for clan members to interact with the system.
- **AI Layer** — interprets questions, retrieves relevant data, and generates natural-language analysis.

## Planned Features

- 🔄 Automatic periodic synchronization of clan and member data
- 🗄️ Dedicated database for current and historical clan information
- 🤖 AI-powered questions and answers about clan members and activity
- 📊 Member statistics and performance analysis
- 🔎 Intelligent retrieval of relevant data before generating an answer
- 💬 Discord commands and natural-language interactions
- 📈 Historical data and trend analysis
- 🧩 Extensible architecture for future dashboards, automations, and integrations

## Data Flow

```text
Clash of Clans API
        ↓
   Data Sync Service
        ↓
      Database
        ↓
 Data Retrieval / AI
        ↓
    Discord Bot
        ↓
   Clan Members
```

The bot is intended to keep its own copy of relevant clan data rather than depending on a live API request for every Discord question. This allows faster queries, historical analysis, and more flexible AI-powered retrieval.

## Project Status

🚧 **Under active development**

Development will be done incrementally, beginning with the data synchronization and database foundation, followed by the Discord and AI layers.

## Security

Secrets must never be committed to this repository. This includes:

- Clash of Clans API keys
- Discord bot tokens
- Supabase/database credentials
- AI provider API keys
- Service-role keys

Use environment variables and a local `.env` file for sensitive configuration.

## License

License to be determined as the project develops.
