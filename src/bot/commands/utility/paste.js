const { SlashCommandBuilder } = require('discord.js');
const { createPaste } = require('../../../services/ezhostService');

module.exports = {
  prefixGreedy: 'content',
  prefixAliases: ['bin', 'hastebin'],
  data: new SlashCommandBuilder()
    .setName('paste')
    .setDescription('Create a paste on e-z.host')
    .addStringOption(o => o.setName('content').setDescription('The text or code to paste').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Paste title (default: Paste)').setRequired(false))
    .addStringOption(o => o.setName('language').setDescription('Syntax highlighting language').setRequired(false)
      .addChoices(
        { name: 'Plain Text', value: 'plaintext' },
        { name: 'JavaScript', value: 'javascript' },
        { name: 'Python', value: 'python' },
        { name: 'Lua', value: 'lua' },
        { name: 'HTML', value: 'html' },
        { name: 'CSS', value: 'css' },
        { name: 'JSON', value: 'json' },
        { name: 'C++', value: 'cpp' },
        { name: 'C#', value: 'csharp' },
        { name: 'Java', value: 'java' },
        { name: 'Bash', value: 'bash' },
      ))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const content = interaction.options.getString('content');
    const title = interaction.options.getString('title') || 'Paste';
    const language = interaction.options.getString('language') || 'plaintext';
    
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const result = await createPaste(title, 'Created via santi.tools', content, language);
      await interaction.editReply({ content: result.pasteUrl });
    } catch (err) {
      console.error('[PASTE] Error:', err.message);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
