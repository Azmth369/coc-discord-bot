import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import { answer, tell } from './ai.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const ponyoAlertChannelId = process.env.PONYO_ALERT_CHANNEL_ID;

if (!token || !clientId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingAnswers = new Map();
const conversationMemory = new Map();
const ANSWER_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const MAX_MEMORY_TURNS = 5;
const PAGINATION_THRESHOLD = 1800;
const PAGE_SIZE = PAGINATION_THRESHOLD;
const MAX_LIST_ITEMS_PER_PAGE = 10;

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the fast Sarvam Clash of Clans analyst')
    .addStringOption(option => option
      .setName('question')
      .setDescription('Ask a data-backed question about the clan')
      .setRequired(true)
      .setMaxLength(1000))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('tell')
    .setDescription('Ask the deeper Gemini Clash of Clans analyst')
    .addStringOption(option => option
      .setName('question')
      .setDescription('Ask a data-backed question about the clan')
      .setRequired(true)
      .setMaxLength(1000))
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
}

function isListItem(line) {
  return /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
}

function numberListBlocks(text) {
  const lines = String(text ?? '').split('\n');
  let inList = false;
  let number = 0;
  return lines.map(line => {
    if (!isListItem(line)) {
      inList = false;
      number = 0;
      return line;
    }
    const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!inList) {
      inList = true;
      number = 1;
    } else {
      number += 1;
    }
    return `${number}. ${body}`;
  }).join('\n');
}

function splitDiscordMessage(text, max = PAGE_SIZE) {
  const normalized = numberListBlocks(String(text ?? 'No answer generated.').trim());
  const lines = normalized.split('\n');
  const pages = [];
  let current = [];
  let listItems = 0;

  const flush = () => {
    const value = current.join('\n').trim();
    if (value) pages.push(value);
    current = [];
    listItems = 0;
  };

  for (const line of lines) {
    const listItem = isListItem(line);
    if (listItem && listItems >= MAX_LIST_ITEMS_PER_PAGE) flush();
    if (current.length && current.join('\n').length + line.length + 1 > max) flush();

    current.push(line);
    if (listItem) listItems += 1;
    else if (line.trim()) listItems = 0;
  }

  flush();
  return pages.length ? pages : ['No answer generated.'];
}

function memoryKey(interaction) {
  return `${interaction.guildId || 'dm'}:${interaction.channelId || 'unknown'}:${interaction.user.id}`;
}

function getConversationContext(key) {
  const entry = conversationMemory.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    conversationMemory.delete(key);
    return [];
  }
  return entry.turns;
}

function buildContextualQuestion(question, turns) {
  if (!turns.length) return question;
  const history = turns.map((turn, index) =>
    `TURN ${index + 1}\nUSER: ${turn.question}\nASSISTANT: ${turn.answer}`
  ).join('\n\n');
  return `RECENT CONVERSATION CONTEXT (use this only to resolve follow-ups such as they/them/their/those/that player/that war; answer the CURRENT QUESTION, not the old questions):\n${history}\n\nCURRENT QUESTION: ${question}`;
}

function rememberConversation(key, question, answerText) {
  const existing = getConversationContext(key);
  const turns = [...existing, {
    question,
    answer: String(answerText || '').slice(0, 4000)
  }].slice(-MAX_MEMORY_TURNS);
  conversationMemory.set(key, { turns, expiresAt: Date.now() + MEMORY_TTL_MS });
}

function rememberAnswer(question, result, userId, provider, elapsed) {
  const id = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  pendingAnswers.set(id, { question, result, userId, provider, elapsed, page: 0, expiresAt: Date.now() + ANSWER_TTL_MS });
  setTimeout(() => pendingAnswers.delete(id), ANSWER_TTL_MS).unref?.();
  return id;
}

function viewerRow(id, page, total) {
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(new ButtonBuilder().setCustomId(`ai-page:${id}:less`).setLabel('See less').setStyle(ButtonStyle.Secondary));
  }
  if (page < total - 1) {
    row.addComponents(new ButtonBuilder().setCustomId(`ai-page:${id}:more`).setLabel('See more').setStyle(ButtonStyle.Secondary));
  }
  return row;
}

function pageContent(provider, elapsed, chunks, page) {
  return `**${provider} • ${elapsed}s**\n${chunks[page]}`;
}

function classifyProviderError(provider, error) {
  const raw = String(error?.providerBody || error?.message || 'Unknown error');
  const status = error?.status ?? 'unknown';
  const lower = raw.toLowerCase();

  if (/context window|prompt_tokens|max_tokens|exceeds the model context|too many tokens|context length|request.*large|payload.*large/i.test(raw)) {
    return {
      kind: 'context_window',
      title: `${provider} context window exceeded`,
      userMessage: `${provider} could not process that request because too much data was sent to it. Please use /tell (Gemini) for this question.`
    };
  }
  if (status === 429 || /rate.?limit|quota|too many requests|limit exceeded|tokens?.*limit/i.test(lower)) {
    return {
      kind: 'quota_rate_limit',
      title: `${provider} quota/rate limit reached`,
      userMessage: `${provider} is temporarily unavailable because its API limit was reached. Please use /tell (Gemini) for now.`
    };
  }
  if (/api.?key|unauthorized|authentication|invalid.*key|forbidden/i.test(lower) || status === 401 || status === 403) {
    return {
      kind: 'authentication',
      title: `${provider} authentication problem`,
      userMessage: `${provider} is temporarily unavailable due to an API configuration problem. Please use /tell (Gemini) for now.`
    };
  }
  if ([408, 500, 502, 503, 504].includes(Number(status))) {
    return {
      kind: 'temporary_provider_error',
      title: `${provider} temporary API error`,
      userMessage: `${provider} is temporarily unavailable. Please use /tell (Gemini) for now.`
    };
  }
  return {
    kind: 'unknown',
    title: `${provider} request failed`,
    userMessage: `I could not get a ${provider} response right now. Please try /tell (Gemini) instead.`
  };
}

async function sendPonyoAlert({ interaction, provider, question, error, classification, elapsed }) {
  if (!ponyoAlertChannelId) return;
  try {
    const channel = await client.channels.fetch(ponyoAlertChannelId);
    if (!channel?.isTextBased()) throw new Error('PONYO_ALERT_CHANNEL_ID is not a text channel');

    const rawDetails = String(error?.providerBody || error?.message || 'Unknown error');
    const details = rawDetails.length > 3500 ? `${rawDetails.slice(0, 3500)}\n...[truncated]` : rawDetails;
    const user = interaction.user;
    const guild = interaction.guild;
    const lines = [
      '🚨 **Ponyo AI Provider Alert**',
      `**Provider:** ${provider}`,
      `**Problem:** ${classification.title}`,
      `**Category:** ${classification.kind}`,
      `**HTTP status:** ${error?.status ?? 'unknown'}`,
      `**Command:** /${interaction.commandName}`,
      `**User:** ${user?.tag || user?.username || user?.id} (${user?.id || 'unknown'})`,
      `**Guild:** ${guild?.name || 'DM'} (${guild?.id || 'unknown'})`,
      `**Channel:** ${interaction.channel?.name || interaction.channelId || 'unknown'} (${interaction.channelId || 'unknown'})`,
      `**Elapsed before failure:** ${elapsed}s`,
      `**Question:** ${question}`,
      `**Time:** ${new Date().toISOString()}`,
      '',
      '**Provider error details (private alert channel):**',
      '```text',
      details,
      '```'
    ];
    await channel.send(lines.join('\n').slice(0, 1950));
  } catch (alertError) {
    console.error('[discord] Ponyo alert failed', alertError);
  }
}

client.once('ready', () => console.log(`Discord bot online as ${client.user.tag}`));

async function handleAiCommand(interaction, provider, generator) {
  await interaction.deferReply();
  const started = Date.now();
  let question = '';
  try {
    question = interaction.options.getString('question', true).trim();
    const key = memoryKey(interaction);
    const turns = getConversationContext(key);
    const contextualQuestion = buildContextualQuestion(question, turns);
    const result = await generator(contextualQuestion);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    rememberConversation(key, question, result);
    const chunks = splitDiscordMessage(result);
    const id = rememberAnswer(question, result, interaction.user.id, provider, elapsed);
    const components = chunks.length > 1 ? [viewerRow(id, 0, chunks.length)] : [];
    await interaction.editReply({ content: pageContent(provider, elapsed, chunks, 0), components });
  } catch (error) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const classification = classifyProviderError(provider, error);
    console.error(`[discord] ${provider.toLowerCase()} failed`, error);
    await sendPonyoAlert({ interaction, provider, question, error, classification, elapsed });
    await interaction.editReply(classification.userMessage);
  }
}

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ask') {
      await handleAiCommand(interaction, 'Sarvam', answer);
      return;
    }
    if (interaction.commandName === 'tell') {
      await handleAiCommand(interaction, 'Gemini', tell);
      return;
    }
  }

  if (!interaction.isButton() || !interaction.customId.startsWith('ai-page:')) return;
  const [, id, direction] = interaction.customId.split(':');
  const saved = pendingAnswers.get(id);
  if (!saved || saved.expiresAt < Date.now()) {
    await interaction.reply({ content: 'That AI answer has expired. Ask the question again.', ephemeral: true });
    return;
  }
  if (saved.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who asked this question can expand or collapse its answer.', ephemeral: true });
    return;
  }

  const chunks = splitDiscordMessage(saved.result);
  const current = Number(saved.page || 0);
  const delta = direction === 'more' ? 1 : -1;
  const page = Math.max(0, Math.min(chunks.length - 1, current + delta));
  saved.page = page;
  saved.expiresAt = Date.now() + ANSWER_TTL_MS;
  await interaction.update({
    content: pageContent(saved.provider, saved.elapsed || '—', chunks, page),
    components: [viewerRow(id, page, chunks.length)]
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of conversationMemory) if (value.expiresAt < now) conversationMemory.delete(key);
}, 10 * 60 * 1000).unref?.();

await registerCommands();
await client.login(token);
