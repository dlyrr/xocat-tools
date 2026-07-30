const { Worker } = require('worker_threads');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

function testRegex(pattern, text, flags) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads');
      try {
        const regex = new RegExp(workerData.pattern, workerData.flags);
        const matches = [];
        let match;
        while ((match = regex.exec(workerData.text)) !== null && matches.length < 50) {
          matches.push({ value: match[0], index: match.index, groups: match.slice(1), named: match.groups || null });
          if (!regex.global && !regex.sticky) break;
          if (match[0] === '') regex.lastIndex++;
        }
        parentPort.postMessage({ matches, capped: matches.length === 50 });
      } catch (error) { parentPort.postMessage({ error: error.message }); }
    `, { eval: true, workerData: { pattern, text, flags } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('The expression took too long and was stopped. Try a simpler pattern.'));
    }, 1000);
    worker.once('message', result => {
      clearTimeout(timer); worker.terminate();
      if (result.error) reject(new Error(result.error)); else resolve(result);
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

const truncate = (value, max) => value.length > max ? `${value.slice(0, max - 3)}...` : value;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('regex')
    .setDescription('Safely test a JavaScript regular expression against text')
    .addStringOption(o => o.setName('pattern').setDescription('Pattern without surrounding slashes').setRequired(true).setMaxLength(250))
    .addStringOption(o => o.setName('text').setDescription('Text to test').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('flags').setDescription('JavaScript flags, such as gi').setMaxLength(8))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const pattern = interaction.options.getString('pattern', true);
    const text = interaction.options.getString('text', true);
    const flags = interaction.options.getString('flags') || 'g';
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
      return interaction.reply({ content: 'Flags must be unique JavaScript regex flags: `d g i m s u v y`.', flags: 64 });
    }
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    try {
      const result = await testRegex(pattern, text, flags);
      const lines = result.matches.slice(0, 20).map((match, index) => {
        const captures = match.groups.length ? `\n   Captures: ${match.groups.map(value => value === undefined ? '(unset)' : JSON.stringify(value)).join(', ')}` : '';
        const named = match.named ? `\n   Named: ${JSON.stringify(match.named)}` : '';
        return `**${index + 1}.** index \`${match.index}\`: \`${truncate(JSON.stringify(match.value), 180)}\`${captures}${named}`;
      });
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle(`Regex test · ${result.matches.length}${result.capped ? '+' : ''} match${result.matches.length === 1 ? '' : 'es'}`)
        .setDescription(truncate(lines.join('\n') || 'No matches found.', 4000))
        .addFields({ name: 'Expression', value: `\`/${truncate(pattern.replace(/`/g, '\\`'), 900)}/${flags}\`` })
        .setFooter({ text: result.capped ? 'Results capped at 50 matches' : 'Execution isolated with a 1-second safety limit' });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply(`Regex error: ${truncate(error.message || String(error), 500)}`);
    }
  },

  testRegex,
};
