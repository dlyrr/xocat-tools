// ============================================================
// Deploy Slash Commands to Discord API
// ============================================================
require('dotenv').config();

const {
  ApplicationIntegrationType,
  InteractionContextType,
  REST,
  Routes,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const globalCommands = [];

function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith('.js')) {
      try {
        const command = require(fullPath);
        if (command.data) {
          const data = command.data.toJSON();
          globalCommands.push({
            ...data,
            integration_types: command.guildOnly
              ? [ApplicationIntegrationType.GuildInstall]
              : [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
            contexts: command.guildOnly
              ? [InteractionContextType.Guild]
              : [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
          });
        }
      } catch (err) {
        console.error(`Failed to load ${fullPath}:`, err.message);
      }
    }
  }
}

async function deploy() {
  const commandsPath = path.join(__dirname, 'src', 'bot', 'commands');
  loadCommands(commandsPath);

  console.log(`Deploying ${globalCommands.length} commands...`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Guild commands cannot contain global-only integration/context fields.
  // Keep test-guild deployment independent so a failure never blocks the
  // global commands that Discord exposes in DMs.
  if (process.env.DISCORD_GUILD_ID) {
    const guildCommands = globalCommands.map(command => {
      const { integration_types, contexts, dm_permission, ...guildCommand } = command;
      return guildCommand;
    });

    try {
      console.log('Deploying to guild (instant)...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: guildCommands }
      );
      console.log(`✅ Successfully deployed ${guildCommands.length} guild commands!`);
    } catch (error) {
      console.error('❌ Failed to deploy test-guild commands:', error);
    }
  }

  try {
    console.log('Deploying globally (may take up to 1 hour)...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: globalCommands }
    );
    console.log(`Successfully deployed ${globalCommands.length} global commands with per-command DM/server contexts.`);
  } catch (error) {
    console.error('❌ Failed to deploy global commands:', error);
    process.exitCode = 1;
  }
}

deploy();
