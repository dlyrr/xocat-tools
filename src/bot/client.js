// ============================================================
// Discord.js Client Setup
// ============================================================
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Command collection
  client.commands = new Collection();

  // Load commands recursively from the commands directory
  const commandsPath = path.join(__dirname, 'commands');
  const commandCount = loadCommands(client, commandsPath);
  logger.success('commands', `${commandCount} slash commands loaded`);

  // Load event handlers
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }

  return client;
}

function loadCommands(client, dir) {
  let loaded = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loaded += loadCommands(client, fullPath);
    } else if (entry.name.endsWith('.js')) {
      try {
        // A module may export one command or an array of them (see
        // commands/images/effects.js).
        const exported = require(fullPath);
        for (const command of Array.isArray(exported) ? exported : [exported]) {
          if (command?.data && command?.execute) {
            client.commands.set(command.data.name, command);
            loaded += 1;
          }
        }
      } catch (err) {
        logger.error('commands', `Failed to load ${entry.name}`, err);
      }
    }
  }
  return loaded;
}

module.exports = { createClient };
