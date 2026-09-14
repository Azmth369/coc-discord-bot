import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { answer } from './ai.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the Clash of Clans AI analyst')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('Ask a data-backed question about the clan')
        .setRequired(true)
        .setMaxLength(1000)
    )
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
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

client.once('ready', () => {
  console.log(`Discord bot online as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'ask') return;

  await interaction.deferReply();
  try {
    const question = interaction.options.getString('question', true).trim();
    const result = await answer(question);
    const chunks = splitDiscordMessage(result);

    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp(chunk);
    }
  } catch (error) {
    console.error('[discord] ask failed', error);
    await interaction.editReply('I could not answer that right now. Check the bot logs for details.');
  }
});

await registerCommands();
await client.login(token);
