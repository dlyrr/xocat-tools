const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { colors } = require('../../../utils/constants');

function addTargetOptions(subcommand) {
  return subcommand
    .addUserOption(option => option
      .setName('user')
      .setDescription('User whose avatar you want to view')
      .setRequired(false))
    .addBooleanOption(option => option
      .setName('quiet')
      .setDescription('Make the response only visible to you')
      .setRequired(false));
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

    if (scope === 'server') {
      const member = await interaction.guild.members.fetch({ user: requestedUser.id, force: true }).catch(() => null);
      if (!member) {
        return interaction.editReply(`${requestedUser.username} is not a member of this server.`);
      }

      const avatarUrl = member.avatarURL({ size: 4096, forceStatic: false });
      if (!avatarUrl) {
        return interaction.editReply(`${member.displayName} does not have a server-specific avatar here.`);
      }

      return interaction.editReply(createAvatarReply(member.displayName, avatarUrl));
    }

    const avatarUrl = requestedUser.displayAvatarURL({ size: 4096, forceStatic: false });
    return interaction.editReply(createAvatarReply(requestedUser.username, avatarUrl));
  },
};
