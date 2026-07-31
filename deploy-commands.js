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
        // A module may export one command or an array of them (see
        // commands/images/effects.js).
        const exported = require(fullPath);
        for (const command of Array.isArray(exported) ? exported : [exported]) {
          if (!command?.data) continue;
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

// Discord rejects the entire deployment if an app exceeds this, so check it here
// rather than letting the API fail with everything unregistered.
const MAX_GLOBAL_COMMANDS = 100;

async function deploy() {
  const commandsPath = path.join(__dirname, 'src', 'bot', 'commands');
  loadCommands(commandsPath);

  const duplicates = globalCommands
    .map(command => command.name)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicates.length) {
    console.error(`Duplicate command names: ${[...new Set(duplicates)].join(', ')}`);
    console.error('Discord would reject the deployment. Rename or remove one of each pair.');
    process.exitCode = 1;
    return;
  }

  if (globalCommands.length > MAX_GLOBAL_COMMANDS) {
    console.error(`${globalCommands.length} commands exceeds Discord's limit of ${MAX_GLOBAL_COMMANDS}.`);
    console.error('Nothing was deployed — Discord rejects the whole batch, which would leave you with none.');
    console.error(`Remove ${globalCommands.length - MAX_GLOBAL_COMMANDS} command(s). The quickest lever is the`);
    console.error('PROMOTED list in src/bot/commands/images/effects.js: anything taken out of it stays');
    console.error('usable through /image and as a prefix command.');
    process.exitCode = 1;
    return;
  }

  console.log(`Deploying ${globalCommands.length} commands (${MAX_GLOBAL_COMMANDS - globalCommands.length} slots spare)...`);

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
