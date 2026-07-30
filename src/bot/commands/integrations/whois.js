const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { domainToASCII } = require('node:url');
const { colors } = require('../../../utils/constants');
const { http, addQuiet, truncate, date, apiError, quiet } = require('./_shared.cjs');

function normalizeDomain(input) {
  let value = input.trim().toLowerCase();
  try { value = new URL(value.includes('://') ? value : `https://${value}`).hostname; } catch {}
  value = value.replace(/^www\./, '').replace(/\.$/, '');
  const ascii = domainToASCII(value);
  if (!ascii || ascii.length > 253 || !ascii.includes('.') || !/^[a-z0-9.-]+$/.test(ascii) || ascii.includes('..')) {
    throw new Error('Enter a valid public domain, such as `example.com`.');
  }
  return ascii;
}

function entityLabel(entity) {
  const rows = entity?.vcardArray?.[1] || [];
  const preferred = ['org', 'fn'];
  for (const key of preferred) {
    const row = rows.find(item => item[0] === key);
    if (row?.[3] && String(row[3]).toLowerCase() !== 'redacted for privacy') return String(row[3]);
  }
  return null;
}

function eventDate(data, action) {
  return data.events?.find(event => event.eventAction === action)?.eventDate;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up public domain registration information through RDAP')
    .addStringOption(option => option.setName('domain').setDescription('Domain name, such as example.com').setRequired(true).setMaxLength(253))
    .addBooleanOption(option => option.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const domain = normalizeDomain(interaction.options.getString('domain', true));
      const { data } = await http.get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { Accept: 'application/rdap+json, application/json' },
      });
      const registrar = data.entities?.find(entity => entity.roles?.includes('registrar'));
      const nameservers = (data.nameservers || []).map(item => item.ldhName || item.unicodeName).filter(Boolean);
      const statuses = (data.status || []).map(status => status.replaceAll('_', ' '));
      const selfLink = data.links?.find(link => link.rel === 'self')?.href;

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle(data.unicodeName || data.ldhName || domain)
        .setURL(selfLink || `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`)
        .setDescription('Public registration data supplied by the domain’s authoritative RDAP service.')
        .addFields(
          { name: 'Registrar', value: truncate(entityLabel(registrar) || registrar?.handle || 'Not published'), inline: true },
          { name: 'Created', value: date(eventDate(data, 'registration')), inline: true },
          { name: 'Expires', value: date(eventDate(data, 'expiration')), inline: true },
          { name: 'Last updated', value: date(eventDate(data, 'last changed')), inline: true },
          { name: 'DNSSEC', value: data.secureDNS?.delegationSigned ? 'Signed' : 'Not signed / unknown', inline: true },
          { name: 'Handle', value: truncate(data.handle || 'Not published'), inline: true },
          { name: 'Status', value: truncate(statuses.length ? statuses.join('\n') : 'Not published') },
          { name: 'Nameservers', value: truncate(nameservers.length ? nameservers.join('\n') : 'Not published') },
        )
        .setFooter({ text: 'RDAP only returns public registration fields; private contact data is not exposed.' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: error.message?.startsWith('Enter ') ? error.message : apiError(error, 'Could not retrieve RDAP information for that domain.') });
    }
  },

  normalizeDomain,
};
