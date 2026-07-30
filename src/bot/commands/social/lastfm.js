const { SlashCommandBuilder } = require('discord.js');
const { getDatabase } = require('../../../database/db');
const { handlers } = require('../../features/lastfmHandlers');

const PERIOD_CHOICES = [
  { name: 'Weekly', value: '7day' },
  { name: 'Monthly', value: '1month' },
  { name: 'Quarterly', value: '3month' },
  { name: 'Half-year', value: '6month' },
  { name: 'Yearly', value: '12month' },
  { name: 'All time', value: 'overall' },
];

function addQuiet(builder) {
  return builder.addBooleanOption(option => option
    .setName('quiet')
    .setDescription('Make the response only visible to you')
    .setRequired(false));
}

function addTarget(builder) {
  return builder.addUserOption(option => option
    .setName('user')
    .setDescription('Linked Discord user (defaults to you)')
    .setRequired(false));
}

function addPeriod(builder, defaultLabel = 'weekly') {
  return builder.addStringOption(option => option
    .setName('period')
    .setDescription(`Listening period (default: ${defaultLabel})`)
    .addChoices(...PERIOD_CHOICES)
    .setRequired(false));
}

function addLimit(builder, defaultValue = 10, max = 25) {
  return builder.addIntegerOption(option => option
    .setName('limit')
    .setDescription(`Number of results (default: ${defaultValue})`)
    .setMinValue(1)
    .setMaxValue(max)
    .setRequired(false));
}

function addArtist(builder) {
  return builder.addStringOption(option => option
    .setName('artist')
    .setDescription('Artist name; leave blank to use the latest scrobble')
    .setMaxLength(200)
    .setRequired(false));
}

function addAlbum(builder) {
  return builder.addStringOption(option => option
    .setName('album')
    .setDescription('Album name; leave blank to use the latest scrobble')
    .setMaxLength(200)
    .setRequired(false));
}

function addTrack(builder) {
  return builder.addStringOption(option => option
    .setName('track')
    .setDescription('Track name; leave blank to use the latest scrobble')
    .setMaxLength(200)
    .setRequired(false));
}

const data = new SlashCommandBuilder()
  .setName('lastfm')
  .setDescription('Last.fm profiles, listening statistics, charts, and music details')
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('set')
    .setDescription('Link or update your Last.fm username')
    .addStringOption(option => option.setName('username').setDescription('Last.fm username').setRequired(true).setMaxLength(100))))
  .addSubcommand(subcommand => addQuiet(addTarget(subcommand
    .setName('np')
    .setDescription('Show the current or most recently played track'))))
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('remove')
    .setDescription('Remove your locally stored Last.fm link')))
  .addSubcommand(subcommand => addQuiet(addTarget(subcommand
    .setName('profile')
    .setDescription('Show a linked Last.fm profile and totals'))))
  .addSubcommand(subcommand => addQuiet(addTarget(addLimit(addArtist(subcommand
    .setName('recent')
    .setDescription('Show recent scrobbles, optionally filtered by artist')), 10, 25))))
  .addSubcommand(subcommand => addQuiet(addTarget(addPeriod(subcommand
    .setName('plays')
    .setDescription('Show the scrobble count for a listening period'), 'all time'))))
  .addSubcommand(subcommand => addQuiet(addTarget(subcommand
    .setName('overview')
    .setDescription('Summarize artists, albums, and tracks from the last 1–8 days')
    .addIntegerOption(option => option.setName('days').setDescription('Number of days (default: 4)').setMinValue(1).setMaxValue(8).setRequired(false)))))
  .addSubcommand(subcommand => addQuiet(addTarget(addLimit(addPeriod(subcommand
    .setName('topartists')
    .setDescription('Show top artists for a listening period')), 10, 25))))
  .addSubcommand(subcommand => addQuiet(addTarget(addLimit(addPeriod(subcommand
    .setName('topalbums')
    .setDescription('Show top albums for a listening period')), 10, 25))))
  .addSubcommand(subcommand => addQuiet(addTarget(addLimit(addPeriod(subcommand
    .setName('toptracks')
    .setDescription('Show top tracks for a listening period')), 10, 25))))
  .addSubcommand(subcommand => addQuiet(addTarget(addPeriod(subcommand
    .setName('chart')
    .setDescription('Create a grid from your top album covers'))
    .addStringOption(option => option.setName('size').setDescription('Chart dimensions (default: 3x3)').addChoices(
      { name: '3 × 3', value: '3x3' },
      { name: '4 × 4', value: '4x4' },
      { name: '5 × 5', value: '5x5' },
      { name: '6 × 6', value: '6x6' },
    ).setRequired(false)))))
  .addSubcommand(subcommand => addQuiet(addTarget(addPeriod(subcommand
    .setName('receipt')
    .setDescription('Show top tracks in a receipt-style summary')))))
  .addSubcommand(subcommand => addQuiet(addTarget(addArtist(subcommand
    .setName('artist')
    .setDescription('Show artist information')))))
  .addSubcommand(subcommand => addQuiet(addTarget(addAlbum(addArtist(subcommand
    .setName('album')
    .setDescription('Show album information'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addTrack(addArtist(subcommand
    .setName('track')
    .setDescription('Show detailed track information'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addArtist(subcommand
    .setName('artistplays')
    .setDescription('Show a linked user’s play count for an artist')))))
  .addSubcommand(subcommand => addQuiet(addTarget(addAlbum(addArtist(subcommand
    .setName('albumplays')
    .setDescription('Show a linked user’s play count for an album'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addTrack(addArtist(subcommand
    .setName('trackplays')
    .setDescription('Show a linked user’s play count for a track'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addAlbum(addArtist(subcommand
    .setName('albumtracks')
    .setDescription('Show album tracks with a linked user’s play counts'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addAlbum(addArtist(subcommand
    .setName('cover')
    .setDescription('Show an album cover at full embed size'))))))
  .addSubcommand(subcommand => addQuiet(addTarget(addLimit(subcommand
    .setName('loved')
    .setDescription('Show a linked user’s loved tracks'), 10, 25))))
  .addSubcommand(subcommand => addQuiet(addArtist(subcommand
    .setName('whoknows')
    .setDescription('Rank linked server members by plays for an artist'))))
  .addSubcommand(subcommand => addQuiet(addAlbum(addArtist(subcommand
    .setName('whoknowsalbum')
    .setDescription('Rank linked server members by plays for an album')))))
  .addSubcommand(subcommand => addQuiet(addTrack(addArtist(subcommand
    .setName('whoknowstrack')
    .setDescription('Rank linked server members by plays for a track')))));

module.exports = {
  data,

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      getDatabase();
      const subcommand = interaction.options.getSubcommand();
      const handler = handlers[subcommand];
      if (!handler) throw new Error(`Unsupported Last.fm subcommand: ${subcommand}`);
      await handler(interaction);
    } catch (error) {
      console.error(`[LASTFM] /lastfm ${interaction.options.getSubcommand()}:`, error);
      const message = String(error?.message || 'Last.fm request failed')
        .replace(/```/g, "'''")
        .slice(0, 1500);
      await interaction.editReply({
        content: message,
        embeds: [],
        components: [],
        files: [],
      }).catch(() => {});
    }
  },
};
