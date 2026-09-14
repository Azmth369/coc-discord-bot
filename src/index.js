import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { answer } from './ai.js';
import { syncOnce } from './sync.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the Clash of Clans AI analyst')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true))
    .toJSON()
];

async function registerCommand() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commands });
}

client.once('ready', () => console.log(`Discord bot online as ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'ask') return;
  await interaction.deferReply();
  try {
    const result = await answer(interaction.options.getString('question', true));
    await interaction.editReply(result.slice(0, 1900));
  } catch (error) {
    console.error(error);
    await interaction.editReply(`I couldn't answer that right now: ${error.message}`);
  }
});

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
}

await registerCommand();
client.login(process.env.DISCORD_TOKEN);

const clanMs = Number(process.env.CLAN_POLL_MS || 600000);
const warMs = Number(process.env.WAR_POLL_MS || 120000);
const playerMs = Number(process.env.PLAYER_POLL_MS || 1800000);

setInterval(() => syncOnce().catch(console.error), clanMs);
setInterval(() => syncOnce().catch(console.error), warMs);
setInterval(() => syncOnce().catch(console.error), playerMs);

await syncOnce();
