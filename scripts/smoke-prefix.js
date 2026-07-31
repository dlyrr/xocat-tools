// ============================================================
// Prefix parser smoke test
// ------------------------------------------------------------
// Exercises the prefix bridge without a Discord connection: alias resolution
// (including the effect aliases that route to /image), greedy text options, and
// attachment handling.
//
//   node scripts/smoke-prefix.js
// ============================================================
const { Collection } = require('discord.js');
const {
  applyAliases,
  buildAliasRegistry,
  parseOptions,
  selectSchema,
  tokenize,
} = require('../src/services/prefixCommandService');

function loadCommands() {
  const fs = require('fs');
  const path = require('path');
  const commands = new Collection();
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const command = require(full);
        if (command?.data && command?.execute) commands.set(command.data.name, command);
      }
    }
  })(path.join(__dirname, '..', 'src', 'bot', 'commands'));
  return commands;
}

function fakeMessage(content, { attachments = [] } = {}) {
  const collection = new Collection();
  attachments.forEach((attachment, index) => collection.set(String(index), attachment));
  return {
    content,
    attachments: collection,
    channel: { messages: { fetch: async () => null } },
    client: { users: { fetch: async id => ({ id }) } },
    guild: null,
  };
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function resolve(client, content, options = {}) {
  const tokens = tokenize(content.slice(1).trim());
  const alias = applyAliases(tokens.shift().toLowerCase(), tokens, buildAliasRegistry(client));
  const command = client.commands.get(alias.name);
  if (!command) return { alias, command: null };
  const selected = selectSchema(command.data.toJSON(), alias.tokens);
  const values = await parseOptions(fakeMessage(content, options), selected.options, selected.tokens, {
    greedy: command.prefixGreedy,
  });
  return { alias, command, selected, values };
}

async function main() {
  const commands = loadCommands();
  const client = { commands };
  const registry = buildAliasRegistry(client);

  check('registry maps .deepfry to /image', registry.get('deepfry')?.name === 'image', JSON.stringify(registry.get('deepfry')));
  check('registry pre-fills the effect name', registry.get('fry')?.prepend?.[0] === 'deepfry', JSON.stringify(registry.get('fry')));
  check('registry maps .magik to /image', registry.get('magik')?.name === 'image');
  check('real commands are not shadowed by effect aliases', !registry.has('caption') && !registry.has('watermark'));
  check('explicit prefixAliases register', registry.get('birb')?.name === 'bird', JSON.stringify(registry.get('birb')));
  check('tag aliases register', registry.get('t')?.name === 'tag');

  // .deepfry with no arguments
  {
    const { alias, values } = await resolve(client, '.deepfry');
    check('.deepfry routes to image with effect=deepfry', alias.name === 'image' && values.get('effect') === 'deepfry', values?.get('effect'));
  }

  // .fry alias
  {
    const { values } = await resolve(client, '.fry');
    check('.fry resolves to the deepfry effect', values.get('effect') === 'deepfry');
  }

  // Greedy text: multi-word captions without quotes
  {
    const { values } = await resolve(client, '.meme top text, bottom text');
    check('.meme soaks up the whole caption', values.get('text') === 'top text, bottom text', values.get('text'));
  }

  // The old parser let the attachment option eat a positional token.
  {
    const { values } = await resolve(client, '.caption hello there world');
    check('.caption keeps its full text (attachment does not eat a token)', values.get('text') === 'hello there world', values.get('text'));
  }

  // Effect + greedy text through /image
  {
    const { values } = await resolve(client, '.snapchat sent from my snapchat');
    check('.snapchat passes effect and text', values.get('effect') === 'snapchat' && values.get('text') === 'sent from my snapchat', `${values.get('effect')} / ${values.get('text')}`);
  }

  // Named options still work
  {
    const { values } = await resolve(client, '.image hue amount:90');
    check('.image accepts named options', values.get('effect') === 'hue' && values.get('amount') === 90, `${values.get('effect')} / ${values.get('amount')}`);
  }

  // Attachments resolve from the message
  {
    const attachment = { url: 'https://cdn.discordapp.com/x.png', name: 'x.png', contentType: 'image/png', size: 100 };
    const { values } = await resolve(client, '.uncaption', { attachments: [attachment] });
    check('.uncaption picks up a message attachment', values.get('file')?.name === 'x.png');
  }

  // Numeric validation still applies
  {
    const { values } = await resolve(client, '.dice sides:20 count:3');
    check('.dice parses integers', values.get('sides') === 20 && values.get('count') === 3);
  }

  // Subcommand routing still works
  {
    const { selected, values } = await resolve(client, '.tag get hello');
    check('.tag get routes to the subcommand', selected.subcommand === 'get' && values.get('name') === 'hello', `${selected.subcommand} / ${values.get('name')}`);
  }

  // Last.fm aliasing must keep working
  {
    const { alias } = await resolve(client, '.fm');
    check('.fm still routes to lastfm np', alias.name === 'lastfm' && alias.tokens[0] === 'np', JSON.stringify(alias.tokens));
  }

  console.log(`\n${failures} failure(s).`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
