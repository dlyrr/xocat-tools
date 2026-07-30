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
      .setDescription('User whose banner you want to view')
      .setRequired(false))
    .addBooleanOption(option => option
      .setName('quiet')
      .setDescription('Make the response only visible to you')
      .setRequired(false));
}

function createBannerReply(title, bannerUrl) {
  const embed = new EmbedBuilder()
    .setColor(colors.muted)
    .setTitle(title.slice(0, 256))
    .setImage(bannerUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open banner in browser')
      .setStyle(ButtonStyle.Link)
      .setURL(bannerUrl)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("View a user's account or server banner")
    .addSubcommand(subcommand => addTargetOptions(subcommand
      .setName('user')
      .setDescription("View a user's account banner")))
    .addSubcommand(subcommand => addTargetOptions(subcommand
      .setName('server')
      .setDescription("View a user's server-specific banner"))),

  async execute(interaction) {
    const scope = interaction.options.getSubcommand();
    const requestedUser = interaction.options.getUser('user') || interaction.user;
    const quiet = interaction.options.getBoolean('quiet') ?? false;

    if (scope === 'server' && !interaction.guild) {
      return interaction.reply({
        content: 'Server banners can only be viewed inside a server.',
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    if (scope === 'server') {
      const member = await interaction.guild.members.fetch({ user: requestedUser.id, force: true }).catch(() => null);
      if (!member) {
        return interaction.editReply(`${requestedUser.username} is not a member of this server.`);
      }

      const bannerUrl = member.bannerURL({ size: 4096, forceStatic: false });
      if (!bannerUrl) {
        return interaction.editReply(`${member.displayName} does not have a server-specific banner here.`);
      }

      return interaction.editReply(createBannerReply(member.displayName, bannerUrl));
    }

    const user = await interaction.client.users.fetch(requestedUser.id, { force: true });
    const bannerUrl = user.bannerURL({ size: 4096, forceStatic: false });
    if (!bannerUrl) {
      return interaction.editReply(`${user.username} does not have a profile banner.`);
    }

    return interaction.editReply(createBannerReply(user.username, bannerUrl));
  },
};
