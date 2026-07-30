const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { dbAll, dbGet, dbRun } = require('../database/db');
const { colors } = require('../utils/constants');

function getPoll(id) {
  const poll = dbGet('SELECT * FROM polls WHERE id = ?', [id]);
  if (!poll) return null;
  try {
    poll.choices = JSON.parse(poll.choices_json);
  } catch {
    poll.choices = [];
  }
  return poll;
}

function pollPayload(poll, disabled = false) {
  const counts = dbAll(
    'SELECT choice_index, COUNT(*) AS count FROM poll_votes WHERE poll_id = ? GROUP BY choice_index',
    [poll.id]
  );
  const countMap = new Map(counts.map(row => [Number(row.choice_index), Number(row.count)]));
  const total = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const expired = Boolean(poll.expires_at && poll.expires_at <= Date.now());
  const lines = poll.choices.map((choice, index) => {
    const count = countMap.get(index) || 0;
    const percentage = total ? Math.round((count / total) * 100) : 0;
    const filled = Math.round(percentage / 10);
    return `**${index + 1}. ${choice}**\n${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${count} vote${count === 1 ? '' : 's'} · ${percentage}%`;
  });

  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle(poll.question)
    .setDescription(lines.join('\n\n'))
    .addFields({
      name: 'Poll settings',
      value: `${poll.multiple ? 'Multiple choices allowed' : 'One choice per person'} · ${poll.anonymous ? 'Anonymous' : 'Standard'}${poll.expires_at ? ` · ${expired ? 'Ended' : `Ends <t:${Math.floor(poll.expires_at / 1000)}:R>`}` : ' · No expiration'}`,
    })
    .setFooter({ text: `Poll #${poll.id} · ${total} total vote${total === 1 ? '' : 's'}` })
    .setTimestamp(poll.created_at);

  const rows = [];
  for (let start = 0; start < poll.choices.length; start += 5) {
    const row = new ActionRowBuilder();
    poll.choices.slice(start, start + 5).forEach((choice, offset) => {
      const index = start + offset;
      row.addComponents(new ButtonBuilder()
        .setCustomId(`poll_vote:${poll.id}:${index}`)
        .setLabel(`${index + 1}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || expired));
    });
    rows.push(row);
  }
  return { embeds: [embed], components: rows };
}

async function handlePollButton(interaction) {
  const match = interaction.customId.match(/^poll_vote:(\d+):(\d+)$/);
  if (!match) return false;
  const poll = getPoll(Number(match[1]));
  const choiceIndex = Number(match[2]);
  if (!poll || !poll.choices[choiceIndex]) {
    await interaction.reply({ content: 'This poll no longer exists.', flags: 64 });
    return true;
  }
  if (poll.expires_at && poll.expires_at <= Date.now()) {
    await interaction.update(pollPayload(poll, true));
    return true;
  }

  const existing = dbGet(
    'SELECT choice_index FROM poll_votes WHERE poll_id = ? AND user_id = ? AND choice_index = ?',
    [poll.id, interaction.user.id, choiceIndex]
  );
  if (existing) {
    dbRun('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND choice_index = ?', [poll.id, interaction.user.id, choiceIndex]);
  } else {
    if (!poll.multiple) dbRun('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', [poll.id, interaction.user.id]);
    dbRun(
      'INSERT INTO poll_votes (poll_id, user_id, choice_index, created_at) VALUES (?, ?, ?, ?)',
      [poll.id, interaction.user.id, choiceIndex, Date.now()]
    );
  }
  await interaction.update(pollPayload(poll));
  return true;
}

module.exports = { getPoll, handlePollButton, pollPayload };
