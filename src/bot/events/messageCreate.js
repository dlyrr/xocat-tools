const { handlePrefixCommand } = require('../../services/prefixCommandService');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    await handlePrefixCommand(message).catch(error => {
      console.error('[PREFIX] Command handler failed:', error);
    });
  },
};
