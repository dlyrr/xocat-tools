// ============================================================
// Shared option builders for image commands
// ------------------------------------------------------------
// Named with a .cjs extension so the command loader (which only picks up .js)
// skips it, matching the convention already used by integrations/_shared.cjs.
// ============================================================

/**
 * Add the three interchangeable ways to point at an image. All are optional:
 * when none is given, the media resolver falls back to the invoking message,
 * the message being replied to, and then recent channel history.
 */
function addSourceOptions(builder, { verb = 'edit' } = {}) {
  return builder
    .addAttachmentOption(o => o
      .setName('file')
      .setDescription(`The image or GIF to ${verb} (defaults to the most recent one in the channel)`)
      .setRequired(false))
    .addStringOption(o => o
      .setName('link')
      .setDescription('An image URL, custom emoji, or user ID to use instead of an attachment')
      .setRequired(false)
      .setMaxLength(500))
    .addUserOption(o => o
      .setName('user')
      .setDescription("Use this user's avatar as the image")
      .setRequired(false));
}

function addQuietOption(builder) {
  return builder.addBooleanOption(o => o
    .setName('quiet')
    .setDescription('Make the response only visible to you')
    .setRequired(false));
}

module.exports = { addQuietOption, addSourceOptions };
