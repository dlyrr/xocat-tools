const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { colors } = require('../../../utils/constants');

const SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const FORMATS = ['png', 'jpeg', 'webp', 'gif'];

function addTargetOptions(subcommand) {
  return subcommand
    .addUserOption(option => option
      .setName('user')
      .setDescription('User whose avatar you want to view')
      .setRequired(false))
    .addIntegerOption(option => option
      .setName('size')
      .setDescription('Image width in pixels (default: 4096)')
      .setRequired(false)
      .addChoices(...SIZES.map(size => ({ name: `${size}px`, value: size }))))
    .addStringOption(option => option
      .setName('format')
      .setDescription('File format (default: keeps animation for animated avatars)')
      .setRequired(false)
      .addChoices(...FORMATS.map(format => ({ name: format.toUpperCase(), value: format }))))
    .addBooleanOption(option => option
      .setName('quiet')
      .setDescription('Make the response only visible to you')
      .setRequired(false));
}

/** Build the CDN options from the size/format choices, if any were given. */
function imageOptions(interaction) {
  const size = interaction.options.getInteger('size') ?? 4096;
  const format = interaction.options.getString('format');
  const options = { size, forceStatic: false };
  if (format) {
    options.extension = format;
    // Asking for a still format only makes sense with animation turned off.
    if (format !== 'gif') options.forceStatic = true;
  }
  return options;
}

function createAvatarReply(title, avatarUrl) {
  const embed = new EmbedBuilder()
    .setColor(colors.muted)
    .setTitle(title.slice(0, 256))
    .setImage(avatarUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open avatar in browser')
      .setStyle(ButtonStyle.Link)
      .setURL(avatarUrl)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  prefixAliases: ['pfp', 'icon'],
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("View a user's account or server avatar")
    .addSubcommand(subcommand => addTargetOptions(subcommand
      .setName('user')
      .setDescription("View a user's account avatar")))
    .addSubcommand(subcommand => addTargetOptions(subcommand
      .setName('server')
      .setDescription("View a user's server-specific avatar"))),

  async execute(interaction) {
    const scope = interaction.options.getSubcommand();
    const requestedUser = interaction.options.getUser('user') || interaction.user;
    const quiet = interaction.options.getBoolean('quiet') ?? false;

    if (scope === 'server' && !interaction.guild) {
      return interaction.reply({
        content: 'Server avatars can only be viewed inside a server.',
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    const options = imageOptions(interaction);

    if (scope === 'server') {
      const member = await interaction.guild.members.fetch({ user: requestedUser.id, force: true }).catch(() => null);
      if (!member) {
        return interaction.editReply(`${requestedUser.username} is not a member of this server.`);
      }

      const avatarUrl = member.avatarURL(options);
      if (!avatarUrl) {
        return interaction.editReply(`${member.displayName} does not have a server-specific avatar here.`);
      }

      return interaction.editReply(createAvatarReply(member.displayName, avatarUrl));
    }

    const avatarUrl = requestedUser.displayAvatarURL(options);
    return interaction.editReply(createAvatarReply(requestedUser.username, avatarUrl));
  },
};
