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
const forwardChannelId = process.env.AI_FORWARD_CHANNEL_ID;

if (!token || !clientId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingAnswers = new Map();
const ANSWER_TTL_MS = 15 * 60 * 1000;

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

function splitDiscordMessage(text, max = 1900) {
  const chunks = [];
  let remaining = String(text ?? 'No answer generated.');
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n', max);
    if (cut < Math.floor(max * 0.6)) cut = remaining.lastIndexOf(' ', max);
    if (cut < 1) cut = max;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function rememberAnswer(question, result, userId, provider) {
  const id = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  pendingAnswers.set(id, { question, result, userId, provider, expiresAt: Date.now() + ANSWER_TTL_MS });
  setTimeout(() => pendingAnswers.delete(id), ANSWER_TTL_MS).unref?.();
  return id;
}

function forwardButton(id) {
  if (!forwardChannelId) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ai-forward:${id}`).setLabel('Forward to AI channel').setStyle(ButtonStyle.Secondary)
  );
}

client.once('ready', () => console.log(`Discord bot online as ${client.user.tag}`));

async function handleAiCommand(interaction, provider, generator) {
  await interaction.deferReply();
  try {
    const question = interaction.options.getString('question', true).trim();
    const started = Date.now();
    const result = await generator(question);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const chunks = splitDiscordMessage(result);
    const id = rememberAnswer(question, result, interaction.user.id, provider);
    const row = forwardButton(id);
    const header = `**${provider} • ${elapsed}s**`;
    await interaction.editReply({ content: `${header}\n${chunks[0]}`, components: row ? [row] : [] });
    for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
  } catch (error) {
    console.error(`[discord] ${provider.toLowerCase()} failed`, error);
    const message = error?.message?.slice(0, 300) || 'Unknown error';
    await interaction.editReply(`I could not get a ${provider} response right now.\n\`${message}\``);
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

  if (!interaction.isButton() || !interaction.customId.startsWith('ai-forward:')) return;
  const id = interaction.customId.slice('ai-forward:'.length);
  const saved = pendingAnswers.get(id);
  if (!saved || saved.expiresAt < Date.now()) {
    await interaction.reply({ content: 'That AI answer has expired. Ask the question again.', ephemeral: true });
    return;
  }
  if (saved.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who asked this question can forward the answer.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const channel = await client.channels.fetch(forwardChannelId);
    if (!channel?.isTextBased()) throw new Error('AI_FORWARD_CHANNEL_ID is not a text channel');
    const chunks = splitDiscordMessage(`**${saved.provider || 'AI'} Analysis**\n**Question:** ${saved.question}\n\n${saved.result}`);
    await channel.send(chunks[0]);
    for (const chunk of chunks.slice(1)) await channel.send(chunk);
    await interaction.editReply('Forwarded to the configured AI channel.');
  } catch (error) {
    console.error('[discord] forward failed', error);
    await interaction.editReply('I could not forward the answer. Check the bot permissions and AI_FORWARD_CHANNEL_ID.');
  }
});

await registerCommands();
await client.login(token);
