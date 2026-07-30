// /games — Blackjack, Connect4, Cookie, RPS, TicTacToe
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { colors, emojis } = require('../../../utils/constants');

const CHALLENGE_TIMEOUT_MS = 180000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('Play mini-games')
    .addSubcommand(s => s.setName('blackjack').setDescription('Play a game of Blackjack').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('connect4').setDescription('Start a game of Connect 4').addUserOption(o => o.setName('opponent').setDescription('Who to play against').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('cookie').setDescription('Cookie clicking game - click the cookie first to win!').addUserOption(o => o.setName('opponent').setDescription('Who to race against').setRequired(false)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('rps').setDescription('Play Rock Paper Scissors').addStringOption(o => o.setName('choice').setDescription('Your choice').setRequired(true).addChoices({ name: 'Rock', value: 'rock' }, { name: 'Paper', value: 'paper' }, { name: 'Scissors', value: 'scissors' })).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('tictactoe').setDescription('Play Tic Tac Toe').addUserOption(o => o.setName('opponent').setDescription('Who to play against').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'blackjack': return playBlackjack(interaction);
      case 'connect4': return playConnect4(interaction);
      case 'cookie': return playCookie(interaction);
      case 'rps': return playRPS(interaction);
      case 'tictactoe': return playTicTacToe(interaction);
    }
  },
};

// ---- Challenge Logic ----
async function requestChallenge(interaction, opponent, gameName, quiet) {
  if (quiet) {
    await interaction.reply({ content: '❌ You cannot challenge someone while using the `/quiet` option! They wouldn\'t be able to see the message!', flags: 64 });
    return false;
  }
  if (opponent.bot) {
    await interaction.reply({ content: '❌ You cannot challenge a bot!', flags: 64 });
    return false;
  }
  if (opponent.id === interaction.user.id) {
    await interaction.reply({ content: '❌ You cannot challenge yourself!', flags: 64 });
    return false;
  }

  const embed = new EmbedBuilder()
    .setColor(colors.warning)
      .setTitle(gameName)
    .setDescription(`${interaction.user} started a ${gameName} game!\n${opponent}, do you accept the challenge?`);

  const challengeId = interaction.id;
  const acceptId = `game_accept_${challengeId}`;
  const declineId = `game_decline_${challengeId}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ embeds: [embed], components: [row], withResponse: true });
  const msg = await interaction.fetchReply();

  return new Promise((resolve) => {
    let settled = false;
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: CHALLENGE_TIMEOUT_MS
    });

    collector.on('collect', async (i) => {
      if (i.customId !== acceptId && i.customId !== declineId) {
        return;
      }

      if (i.user.id !== opponent.id) {
        return i.reply({
          content: `Only **${opponent.username}** can accept or decline this challenge.`,
          flags: 64
        }).catch(() => {});
      }

      if (settled) {
        return i.deferUpdate().catch(() => {});
      }

      settled = true;
      collector.stop(i.customId === acceptId ? 'accepted' : 'declined');

      if (i.customId === acceptId) {
        await i.update({
          content: `✅ **${opponent.username}** accepted the challenge!`,
          embeds: [],
          components: []
        }).catch(() => {});
        return resolve(true);
      }

      await i.update({
        embeds: [new EmbedBuilder().setColor(colors.error).setTitle(gameName).setDescription(`**${opponent.username}** declined the challenge.`)],
        components: []
      }).catch(() => {});
      return resolve(false);
    });

    collector.on('end', async (_, reason) => {
      if (settled) {
        return;
      }

      settled = true;
      if (reason === 'time') {
        await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(colors.error).setTitle(gameName).setDescription('The challenge timed out after 3 minutes.')],
          components: []
        }).catch(() => {});
      }
      resolve(false);
    });
  });
}

function disableRows(rows) {
  return rows.map((row) => new ActionRowBuilder().addComponents(
    row.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
  ));
}

async function expireGameMessage(message, embed, rows, timeoutText) {
  try {
    if (embed && timeoutText) {
      embed.setColor(colors.error).setDescription(timeoutText);
    }
    await message.edit({ embeds: embed ? [embed] : undefined, components: rows ? disableRows(rows) : [] });
  } catch {
    // The message may have been deleted or the interaction token may have expired.
  }
}

// ---- Rock Paper Scissors ----
async function playRPS(interaction) {
  const quiet = interaction.options.getBoolean("quiet") ?? false;
  const choices = ['rock', 'paper', 'scissors'];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  const playerChoice = interaction.options.getString('choice');
  const botChoice = choices[Math.floor(Math.random() * 3)];
  let result;
  if (playerChoice === botChoice) result = "It's a tie!";
  else if ((playerChoice === 'rock' && botChoice === 'scissors') || (playerChoice === 'paper' && botChoice === 'rock') || (playerChoice === 'scissors' && botChoice === 'paper')) result = 'You win! 🎉';
  else result = 'You lose! 😔';

  const embed = new EmbedBuilder()
    .setColor(result.includes('win') ? colors.fun : result.includes('lose') ? colors.error : colors.warning)
      .setTitle('Rock Paper Scissors')
    .addFields(
      { name: 'You', value: `${emojis[playerChoice]} ${playerChoice}`, inline: true },
      { name: 'Bot', value: `${emojis[botChoice]} ${botChoice}`, inline: true },
      { name: 'Result', value: `**${result}**`, inline: false },
    ).setTimestamp();
  await interaction.reply({
    embeds: [embed],
    flags: quiet ? 64 : undefined
  });
}

// ---- Cookie Clicker ----
async function playCookie(interaction) {
  const quiet = interaction.options.getBoolean("quiet") ?? false;
  const opponent = interaction.options.getUser('opponent');

  if (opponent) {
    const accepted = await requestChallenge(interaction, opponent, 'Cookie Clicker', quiet);
    if (!accepted) return;

    const clickEmbed = new EmbedBuilder().setColor(colors.fun).setTitle('Click now').setDescription('Click the cookie 3 times as fast as you can!');
    const activeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cookie_race').setEmoji('🍪').setLabel('CLICK!').setStyle(ButtonStyle.Success));
    
    const gameMsg = await interaction.followUp({ embeds: [clickEmbed], components: [activeRow] });

    let p1Clicks = 0, p2Clicks = 0;
    const collector = gameMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
    
    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id && i.user.id !== opponent.id) {
        return i.reply({ content: "You're not in this game!", flags: 64 });
      }
      
      if (i.user.id === interaction.user.id) p1Clicks++;
      else p2Clicks++;

      if (p1Clicks >= 3 || p2Clicks >= 3) {
        if (collector.ended) return;
        collector.stop('win');
        const winner = p1Clicks >= 3 ? interaction.user : opponent;
        const resultEmbed = new EmbedBuilder()
          .setColor(colors.fun)
        .setTitle('Game over')
      .setDescription(`Players: ${interaction.user}, ${opponent}\n${winner} wins!`)
          .setTimestamp();
        return i.update({ embeds: [resultEmbed], components: [] })
          .catch(err => console.error('Error sending winner message:', err));
      } else {
        await i.deferUpdate().catch(err => {});
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        const timeoutEmbed = new EmbedBuilder()
          .setColor(colors.error)
      .setTitle('Cookie Clicker')
          .setDescription('Game timed out! No one reached 3 clicks.');
        await gameMsg.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
      }
    });

  } else {
    const delay = Math.floor(Math.random() * 5000) + 2000;
    const embed = new EmbedBuilder().setColor(colors.warning).setTitle('Cookie Clicker').setDescription('Get ready... Click the cookie when it appears!');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cookie_wait').setLabel('Wait...').setStyle(ButtonStyle.Secondary).setDisabled(true));
    await interaction.reply({
      embeds: [embed],
      components: [row],
      withResponse: true,
      flags: quiet ? 64 : undefined
    });
    const msg = await interaction.fetchReply();

    setTimeout(async () => {
      const activeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cookie_click').setEmoji('🍪').setLabel('CLICK!').setStyle(ButtonStyle.Success));
      const clickEmbed = new EmbedBuilder().setColor(colors.fun).setTitle('Click now').setDescription('Click the cookie!');
      
      await interaction.editReply({ embeds: [clickEmbed], components: [activeRow] }).catch(()=>{});
      const start = Date.now(); // Start timing ONLY after the API call to show the button has completed
      try {
        const i = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 10000 });
        const time = Date.now() - start;
          const resultEmbed = new EmbedBuilder().setColor(colors.fun).setTitle('Cookie clicked').setDescription(`**${i.user.tag}** clicked in **${time}ms**!`).setTimestamp();
        await i.update({ embeds: [resultEmbed], components: [] });
      } catch {
      const timeoutEmbed = new EmbedBuilder().setColor(colors.error).setTitle('Too slow').setDescription('Nobody clicked the cookie in time!');
        await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(()=>{});
      }
    }, delay);
  }
}

// ---- Blackjack ----
async function playBlackjack(interaction) {
  const quiet = interaction.options.getBoolean("quiet") ?? false;
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];
  for (const s of suits) for (const v of values) deck.push({ suit: s, value: v });
  deck = deck.sort(() => Math.random() - 0.5);

  const hand = (cards) => cards.map(c => `${c.value}${c.suit}`).join(' ');
  const score = (cards) => {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.value === 'A') { aces++; total += 11; }
      else if (['K', 'Q', 'J'].includes(c.value)) total += 10;
      else total += parseInt(c.value);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  };

  const playerCards = [deck.pop(), deck.pop()];
  const dealerCards = [deck.pop(), deck.pop()];

  const buildEmbed = (reveal = false) => {
    const pScore = score(playerCards);
    const dScore = reveal ? score(dealerCards) : '?';
    const dHand = reveal ? hand(dealerCards) : `${dealerCards[0].value}${dealerCards[0].suit} ??`;
    return new EmbedBuilder().setColor(colors.fun).setTitle('Blackjack')
      .addFields(
        { name: `Your Hand (${pScore})`, value: hand(playerCards) },
        { name: `Dealer (${dScore})`, value: dHand },
      ).setTimestamp();
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
  );

  if (score(playerCards) === 21) {
        const embed = buildEmbed(true).setTitle('Blackjack — you win').setColor(colors.fun);
    return interaction.reply({
      embeds: [embed],
      flags: quiet ? 64 : undefined
    });
  }

  await interaction.reply({
    embeds: [buildEmbed()],
    components: [row],
    withResponse: true,
    flags: quiet ? 64 : undefined
  });
  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000, filter: i => i.user.id === interaction.user.id });

  collector.on('collect', async (i) => {
    if (i.customId === 'bj_hit') {
      playerCards.push(deck.pop());
      if (score(playerCards) > 21) {
        collector.stop('bust');
        const embed = buildEmbed(true).setTitle('Bust — you lose').setColor(colors.error);
        return i.update({ embeds: [embed], components: [] });
      }
      if (score(playerCards) === 21) {
        collector.stop('21');
        while (score(dealerCards) < 17) dealerCards.push(deck.pop());
        const dealerScore = score(dealerCards);
        let title;
        let color;
        if (dealerScore > 21 || dealerScore < 21) {
          title = dealerScore > 21 ? '🎉 Dealer Busts! You Win!' : '🎉 You Win!';
          color = colors.fun;
        } else {
          title = '🤝 Push! (Tie)';
          color = colors.warning;
        }
        const embed = buildEmbed(true).setTitle(title).setColor(color);
        return i.update({ embeds: [embed], components: [] });
      }
      await i.update({ embeds: [buildEmbed()], components: [row] });
    } else {
      collector.stop('stand');
      while (score(dealerCards) < 17) dealerCards.push(deck.pop());
      const pS = score(playerCards), dS = score(dealerCards);
      let title, color;
      if (dS > 21) { title = 'Dealer busts — you win'; color = colors.fun; }
      else if (pS > dS) { title = 'You win'; color = colors.fun; }
      else if (pS < dS) { title = '😔 You Lose!'; color = colors.error; }
      else { title = '🤝 Push! (Tie)'; color = colors.warning; }
      const embed = buildEmbed(true).setTitle(title).setColor(color);
      await i.update({ embeds: [embed], components: [] });
    }
  });
  collector.on('end', (_, reason) => { if (reason === 'time') msg.edit({ components: [] }).catch(() => {}); });
}

// ---- Tic Tac Toe ----
async function playTicTacToe(interaction) {
  const quiet = interaction.options.getBoolean("quiet") ?? false;
  const opponent = interaction.options.getUser('opponent');

  const accepted = await requestChallenge(interaction, opponent, 'Tic Tac Toe', quiet);
  if (!accepted) return;

  const board = Array(9).fill(null);
  let turn = interaction.user.id;
  const players = { [interaction.user.id]: '❌', [opponent.id]: '⭕' };

  const buildBoard = () => {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const row = new ActionRowBuilder();
      for (let j = 0; j < 3; j++) {
        const idx = i * 3 + j;
        row.addComponents(new ButtonBuilder()
          .setCustomId(`ttt_${idx}`)
          .setLabel(board[idx] || '‎')
          .setStyle(board[idx] ? (board[idx] === '❌' ? ButtonStyle.Danger : ButtonStyle.Primary) : ButtonStyle.Secondary)
          .setDisabled(!!board[idx]));
      }
      rows.push(row);
    }
    return rows;
  };

  const checkWin = () => {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
    if (board.every(c => c)) return 'tie';
    return null;
  };

    const embed = new EmbedBuilder().setColor(colors.fun).setTitle('Tic Tac Toe')
    .setDescription(`${interaction.user} ❌ vs ${opponent} ⭕\n\nTurn: <@${turn}>`);
  
  const gameMsg = await interaction.followUp({
    embeds: [embed],
    components: buildBoard()
  });

  const collector = gameMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });
  collector.on('collect', async (i) => {
    if (i.user.id !== turn) return i.reply({ content: "Not your turn!", flags: 64 });
    const idx = parseInt(i.customId.split('_')[1]);
    board[idx] = players[turn];
    const winner = checkWin();
    if (winner) {
      collector.stop();
      const title = winner === 'tie' ? '🤝 Tie Game!' : `🎉 ${winner} Wins!`;
      embed.setDescription(`${interaction.user} ❌ vs ${opponent} ⭕\n\n${title}`).setColor(winner === 'tie' ? colors.warning : colors.fun);
      await i.update({ embeds: [embed], components: [] }).catch(() => {});
        return interaction.followUp({ embeds: [new EmbedBuilder().setColor(winner === 'tie' ? colors.warning : colors.fun).setTitle('Tic Tac Toe over').setDescription(title)] });
    }
    turn = turn === interaction.user.id ? opponent.id : interaction.user.id;
    embed.setDescription(`${interaction.user} ❌ vs ${opponent} ⭕\n\nTurn: <@${turn}>`);
    await i.update({ embeds: [embed], components: buildBoard() }).catch(() => {});
  });
  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      await expireGameMessage(gameMsg, embed, buildBoard(), `${interaction.user} ❌ vs ${opponent} ⭕\n\nGame timed out waiting for <@${turn}>.`);
    }
  });
}

// ---- Connect 4 ----
async function playConnect4(interaction) {
  const quiet = interaction.options.getBoolean("quiet") ?? false;
  const opponent = interaction.options.getUser('opponent');

  const accepted = await requestChallenge(interaction, opponent, 'Connect 4', quiet);
  if (!accepted) return;

  const ROWS = 6, COLS = 7;
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  let turn = 1; // 1 = interaction.user, 2 = opponent
  const pieces = { 0: '⚫', 1: '🔴', 2: '🟡' };
  const players = { 1: interaction.user, 2: opponent };

  const renderBoard = () => board.map(row => row.map(c => pieces[c]).join('')).join('\n') + '\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';

  const dropPiece = (col, player) => {
    for (let r = ROWS - 1; r >= 0; r--) { if (board[r][col] === 0) { board[r][col] = player; return r; } }
    return -1;
  };

  const checkWin = (r, c, p) => {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (let i = 1; i < 4; i++) { const nr = r+dr*i, nc = c+dc*i; if (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]===p) count++; else break; }
      for (let i = 1; i < 4; i++) { const nr = r-dr*i, nc = c-dc*i; if (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]===p) count++; else break; }
      if (count >= 4) return true;
    }
    return false;
  };

  const buildButtons = () => {
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();
    for (let i = 0; i < 4; i++) row1.addComponents(new ButtonBuilder().setCustomId(`c4_${i}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(board[0][i] !== 0));
    for (let i = 4; i < 7; i++) row2.addComponents(new ButtonBuilder().setCustomId(`c4_${i}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(board[0][i] !== 0));
    return [row1, row2];
  };

    const embed = new EmbedBuilder().setColor(colors.fun).setTitle('Connect 4')
    .setDescription(`${renderBoard()}\n\nTurn: ${players[turn]} ${pieces[turn]}`);
  
  const gameMsg = await interaction.followUp({
    embeds: [embed],
    components: buildButtons()
  });

  const collector = gameMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on('collect', async (i) => {
    if (i.user.id !== players[turn].id) return i.reply({ content: "Not your turn!", flags: 64 });
    const col = parseInt(i.customId.split('_')[1]);
    const row = dropPiece(col, turn);
    if (row === -1) return i.reply({ content: 'Column is full!', flags: 64 });
    if (checkWin(row, col, turn)) {
      collector.stop();
        embed.setDescription(`${renderBoard()}\n\n${players[turn]} wins!`).setColor(colors.fun);
      await i.update({ embeds: [embed], components: [] }).catch(() => {});
          return interaction.followUp({ embeds: [new EmbedBuilder().setColor(colors.fun).setTitle('Connect 4 over').setDescription(`${players[turn]} wins!`)] });
    }
    if (board.every(r => r.every(c => c !== 0))) {
      collector.stop();
        embed.setDescription(`${renderBoard()}\n\nIt's a draw.`).setColor(colors.warning);
      await i.update({ embeds: [embed], components: [] }).catch(() => {});
          return interaction.followUp({ embeds: [new EmbedBuilder().setColor(colors.warning).setTitle('Connect 4 over').setDescription("It's a draw.")] });
    }
    turn = turn === 1 ? 2 : 1;
    embed.setDescription(`${renderBoard()}\n\nTurn: ${players[turn]} ${pieces[turn]}`);
    await i.update({ embeds: [embed], components: buildButtons() }).catch(() => {});
  });
  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      await expireGameMessage(gameMsg, embed, buildButtons(), `${renderBoard()}\n\nGame timed out waiting for ${players[turn]}.`);
    }
  });
}
