// ============================================================
// Event: ready
// ============================================================
const { ActivityType } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    logger.success('discord', `Connected as ${client.user.tag}`);
    logger.info('status', `${client.guilds.cache.size} servers  ·  ${client.commands.size} commands  ·  presence online`);
    console.log();

    // Set rotating activity
    const activities = [
      { name: '/about | Multi-Bot', type: ActivityType.Playing },
      { name: `${client.guilds.cache.size} servers`, type: ActivityType.Watching },
      { name: '/ask | Gemma 4', type: ActivityType.Playing },
      { name: '/roblox user | Roblox Tools', type: ActivityType.Playing },
    ];

    let activityIndex = 0;
    client.user.setPresence({
      activities: [activities[0]],
      status: 'online',
    });

    setInterval(() => {
      activityIndex = (activityIndex + 1) % activities.length;
      client.user.setPresence({
        activities: [activities[activityIndex]],
        status: 'online',
      });
    }, 30000); // Rotate every 30 seconds
  },
};
