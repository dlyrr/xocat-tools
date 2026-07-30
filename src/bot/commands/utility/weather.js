// /weather — Weather dashboard
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { getCurrentWeather, getWindDirection } = require('../../../services/weatherService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Check current weather with a visual dashboard')
    .addStringOption(o => o.setName('location').setDescription('City name').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      const location = interaction.options.getString('location');
      const w = await getCurrentWeather(location);
      const windDir = getWindDirection(w.windDeg);
      const sunrise = `<t:${w.sunrise}:t>`;
      const sunset = `<t:${w.sunset}:t>`;

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle(`Weather in ${w.city}, ${w.country}`)
        .setDescription(`**${w.weather.description.charAt(0).toUpperCase() + w.weather.description.slice(1)}**`)
        .setThumbnail(w.icon)
        .addFields(
          { name: 'Temperature', value: `**${w.temp}°F** (feels like ${w.feelsLike}°F)\nMin: ${w.tempMin}°F | Max: ${w.tempMax}°F`, inline: true },
          { name: 'Wind', value: `${w.windSpeed} mph ${windDir}`, inline: true },
          { name: 'Humidity', value: `${w.humidity}%`, inline: true },
          { name: 'Clouds', value: `${w.clouds}%`, inline: true },
          { name: 'Visibility', value: `${(w.visibility / 1000).toFixed(1)} km`, inline: true },
          { name: 'Sun', value: `Rise: ${sunrise}\nSet: ${sunset}`, inline: true },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `Could not fetch weather: ${err.message}` });
    }
  },
};

