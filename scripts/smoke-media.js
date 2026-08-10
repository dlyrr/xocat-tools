// ============================================================
// Media resolver smoke test
// ------------------------------------------------------------
// Checks the resolution order without touching the network: attachment option,
// link option, user avatar, message attachments/embeds/stickers, emoji and URLs
// in message text, the replied-to message, then channel history.
//
//   node scripts/smoke-media.js
// ============================================================
const { Collection } = require('discord.js');
const { findMedia, findUnicodeEmoji, appleEmojiCandidates, appleEmojiCodepoints } = require('../src/services/mediaResolver');

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function attachment(name, contentType = 'image/png') {
  return { url: `https://cdn.discordapp.com/attachments/1/2/${name}`, name, contentType, size: 1234 };
}

function messageOf({ content = '', attachments = [], embeds = [], stickers = [], reference = null, channel = null } = {}) {
  const attachmentCollection = new Collection();
  attachments.forEach((item, index) => attachmentCollection.set(String(index), item));
  const stickerCollection = new Collection();
  stickers.forEach((item, index) => stickerCollection.set(String(index), item));
  return { content, attachments: attachmentCollection, embeds, stickers: stickerCollection, reference, channel };
}

/** Minimal stand-in for a slash interaction or PrefixInteraction. */
function interactionOf({ options = {}, message = null, history = [] } = {}) {
  const historyCollection = new Collection();
  history.forEach((item, index) => historyCollection.set(String(index), item));
  const channel = { messages: { fetch: async () => historyCollection } };
  if (message && !message.channel) message.channel = channel;
  return {
    message,
    channel,
    client: { users: { fetch: async id => ({ id, username: 'someone', avatar: null, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/x.png` }) } },
    options: {
      getAttachment: name => options[name] ?? null,
      getString: name => options[name] ?? null,
      getUser: name => options[name] ?? null,
      getBoolean: name => options[name] ?? null,
    },
  };
}

async function main() {
  // 1. The attachment option always wins.
  {
    const media = await findMedia(interactionOf({ options: { file: attachment('explicit.png') } }));
    check('explicit attachment wins', media?.name === 'explicit.png' && media.source === 'attachment', JSON.stringify(media));
  }

  // 2. The link option accepts a plain URL.
  {
    const media = await findMedia(interactionOf({ options: { link: 'https://example.com/cat.gif' } }));
    check('link option accepts a URL', media?.url === 'https://example.com/cat.gif' && media.animated === true, JSON.stringify(media));
  }

  // 3. The link option accepts a custom emoji.
  {
    const media = await findMedia(interactionOf({ options: { link: '<a:party:123456789012345678>' } }));
    check('link option accepts an animated custom emoji', media?.source === 'emoji' && media.url.includes('123456789012345678.gif'), JSON.stringify(media));
  }

  // 4. The link option accepts a bare user ID.
  {
    const media = await findMedia(interactionOf({ options: { link: '123456789012345678' } }));
    check('link option accepts a user ID', media?.source === 'avatar', JSON.stringify(media));
  }

  // 5. The user option falls back to their avatar.
  {
    const user = { id: '42', username: 'nobody', avatar: 'a_animated', displayAvatarURL: options => `https://cdn.discordapp.com/avatars/42/a.${options.extension}` };
    const media = await findMedia(interactionOf({ options: { user } }));
    check('user option uses their avatar', media?.source === 'avatar' && media.url.endsWith('.gif'), JSON.stringify(media));
  }

  // 6. Attachments on the invoking (prefix) message.
  {
    const media = await findMedia(interactionOf({ message: messageOf({ content: '.deepfry', attachments: [attachment('own.png')] }) }));
    check('message attachment is found', media?.name === 'own.png', JSON.stringify(media));
  }

  // 7. Non-image attachments are skipped.
  {
    const media = await findMedia(interactionOf({
      message: messageOf({ attachments: [attachment('notes.txt', 'text/plain'), attachment('good.webp', 'image/webp')] }),
    }));
    check('non-image attachments are skipped', media?.name === 'good.webp', JSON.stringify(media));
  }

  // 8. Videos only count when the caller allows them.
  {
    const video = attachment('clip.mp4', 'video/mp4');
    const without = await findMedia(interactionOf({ message: messageOf({ attachments: [video] }) }));
    const with_ = await findMedia(interactionOf({ message: messageOf({ attachments: [video] }) }), { allowVideo: true });
    check('video is ignored unless allowVideo is set', without === null && with_?.name === 'clip.mp4', `${JSON.stringify(without)} / ${JSON.stringify(with_)}`);
  }

  // 9. Embed images (how Tenor links show up).
  {
    const media = await findMedia(interactionOf({
      message: messageOf({ embeds: [{ image: { url: 'https://media.tenor.com/abc/x.gif' } }] }),
    }));
    check('embed image is found', media?.source === 'embed' && media.url.endsWith('.gif'), JSON.stringify(media));
  }

  // 10. Stickers, skipping Lottie ones sharp cannot read.
  {
    const media = await findMedia(interactionOf({
      message: messageOf({ stickers: [{ id: '1', name: 'vector', format: 3 }, { id: '2', name: 'png', format: 1, url: 'https://cdn.discordapp.com/stickers/2.png' }] }),
    }));
    check('Lottie stickers are skipped', media?.source === 'sticker' && media.url.includes('/2.png'), JSON.stringify(media));
  }

  // 11. A custom emoji typed in the message body.
  {
    const media = await findMedia(interactionOf({ message: messageOf({ content: '.jumbo <:blobcat:987654321098765432>' }) }));
    check('custom emoji in message text is found', media?.source === 'emoji' && media.url.includes('987654321098765432.png'), JSON.stringify(media));
  }

  // 12. A unicode emoji in the message body.
  {
    const media = await findMedia(interactionOf({ message: messageOf({ content: '.deepfry 🎲' }) }));
    check('unicode emoji resolves to Apple artwork', media?.source === 'emoji' && media.url.endsWith('/img-apple-160/1f3b2.png'), JSON.stringify(media));
  }

  // 13. The replied-to message.
  {
    const replied = messageOf({ attachments: [attachment('replied.png')] });
    const invoking = messageOf({
      content: '.magik',
      reference: { messageId: '999' },
      channel: { messages: { fetch: async id => (id === '999' ? replied : null) } },
    });
    const media = await findMedia(interactionOf({ message: invoking }));
    check('reply attachment is found', media?.name === 'replied.png' && media.source.includes('reply'), JSON.stringify(media));
  }

  // 14. Channel history, for a slash command with nothing attached.
  {
    const media = await findMedia(interactionOf({ history: [messageOf({ content: 'no image here' }), messageOf({ attachments: [attachment('old.png')] })] }));
    check('channel history is scanned', media?.name === 'old.png' && media.source.includes('history'), JSON.stringify(media));
  }

  // 15. History scanning can be turned off.
  {
    const media = await findMedia(interactionOf({ history: [messageOf({ attachments: [attachment('old.png')] })] }), { historyLimit: 0 });
    check('historyLimit 0 disables scanning', media === null, JSON.stringify(media));
  }

  // 16. Nothing anywhere.
  {
    const media = await findMedia(interactionOf({}));
    check('returns null when nothing is found', media === null, JSON.stringify(media));
  }

  // 17. Apple codepoint naming.
  {
    check('keycap keeps its variation selector and pads', appleEmojiCodepoints('1️⃣') === '0031-fe0f-20e3', appleEmojiCodepoints('1️⃣'));
    check('text-presentation emoji keeps its variation selector', appleEmojiCodepoints('❤️') === '2764-fe0f', appleEmojiCodepoints('❤️'));
    check('a missing variation selector is added back', appleEmojiCodepoints('❤') === '2764-fe0f', appleEmojiCodepoints('❤'));
    check('emoji-presentation characters take no selector', appleEmojiCodepoints('😀') === '1f600', appleEmojiCodepoints('😀'));
    check('skin tones suppress the selector', appleEmojiCodepoints('⛹🏽') === '26f9-1f3fd', appleEmojiCodepoints('⛹🏽'));
    check('skin tones survive on their own', appleEmojiCodepoints('👍🏻') === '1f44d-1f3fb', appleEmojiCodepoints('👍🏻'));
    check('ZWJ sequences are joined', findUnicodeEmoji('👨‍👩‍👧')?.url.endsWith('1f468-200d-1f469-200d-1f467.png') === true, findUnicodeEmoji('👨‍👩‍👧')?.url);
    check('selectors inside a ZWJ sequence are kept', appleEmojiCodepoints('🤦‍♂️') === '1f926-200d-2642-fe0f', appleEmojiCodepoints('🤦‍♂️'));
    check('an unknown sequence falls back to its lead character', appleEmojiCandidates('👨‍👩‍👧').at(-1) === '1f468', JSON.stringify(appleEmojiCandidates('👨‍👩‍👧')));
    check('a plain emoji needs no fallbacks', appleEmojiCandidates('😀').length === 1, JSON.stringify(appleEmojiCandidates('😀')));
    check('keycaps are matched', findUnicodeEmoji('.deepfry 1️⃣')?.url.endsWith('0031-fe0f-20e3.png') === true, findUnicodeEmoji('.deepfry 1️⃣')?.url);
    check('flags are matched', findUnicodeEmoji('.deepfry 🇯🇵')?.url.endsWith('1f1ef-1f1f5.png') === true, findUnicodeEmoji('.deepfry 🇯🇵')?.url);
    check('tag sequences are matched', findUnicodeEmoji('🏴󠁧󠁢󠁳󠁣󠁴󠁿')?.url.endsWith('1f3f4-e0067-e0062-e0073-e0063-e0074-e007f.png') === true, findUnicodeEmoji('🏴󠁧󠁢󠁳󠁣󠁴󠁿')?.url);
    check('a bare digit is not an emoji', findUnicodeEmoji('.deepfry 1') === null, JSON.stringify(findUnicodeEmoji('.deepfry 1')));
  }

  // 18. Emoji substitution in rendered text.
  {
    const { splitEmoji, isPictorial, buildMarkup } = require('../src/utils/emojiText');

    const segments = splitEmoji('hurt ☹️ ok');
    check('text splits around an emoji', segments.length === 3 && segments[0].text === 'hurt ' && segments[1].emoji === '☹️' && segments[2].text === ' ok', JSON.stringify(segments));
    check('emoji are numbered in order', splitEmoji('😀 and 🎲').filter(s => s.emoji).map(s => s.index).join() === '0,1', JSON.stringify(splitEmoji('😀 and 🎲')));
    check('plain text is one segment', splitEmoji('no emoji here').length === 1, JSON.stringify(splitEmoji('no emoji here')));

    check('a picker emoji is pictorial', isPictorial('☹️') === true, '☹️');
    check('a default-emoji character is pictorial', isPictorial('😀') === true, '😀');
    check('bare punctuation is not pictorial', isPictorial('©') === false, '©');
    check('typed punctuation stays as text', splitEmoji('© ™ ‼').length === 1, JSON.stringify(splitEmoji('© ™ ‼')));

    const markup = buildMarkup(splitEmoji('a ☹️ b'), 'foreground="black"');
    check('markup wraps the whole string', markup.startsWith('<span foreground="black">') && markup.endsWith('</span>'), markup);
    check('markup swaps the emoji for a marker', markup.includes('<span background="#ff00fe">') && !markup.includes('☹'), markup);
    check('markup escapes the literal text', buildMarkup(splitEmoji('a & b <c> 😀'), '').includes('a &amp; b &lt;c&gt; '), buildMarkup(splitEmoji('a & b <c> 😀'), ''));
  }

  console.log(`\n${failures} failure(s).`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
