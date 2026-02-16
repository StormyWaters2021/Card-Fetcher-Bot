const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const createDeckModule = require("./deck");
const { advancedSearch, normalize } = require("./search");

// ============================
// LOAD CONFIG
// ============================

const CONFIG_FILE = process.env.CONFIG || "config.json";
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, CONFIG_FILE), "utf-8")
);

if (!config.token) {
  console.error("FATAL: No token found in config.");
  process.exit(1);
}

const { token, game, noMatchMessages } = config;

const SET_INDEX_URL = "https://www.tcgbuilder.net/setsIndex.json";

function imageUrlFor(card) {
  return `https://tcgbuilder.net/images/${game}/${encodeURIComponent(card.image)}`;
}

const deckModule = createDeckModule(config);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ============================
// CARD CACHE
// ============================

let CARD_DB = [];
let CARD_BY_ID = new Map();

function nameKey(str) {
  return normalize(str).replace(/\s+/g, "");
}

async function loadCardDB() {
  try {
    const res = await fetch(SET_INDEX_URL);
    if (!res.ok) return;

    const index = await res.json();
    const setFiles = index[game];
    if (!setFiles) return;

    const merged = [];

    for (const file of setFiles) {
      try {
        const r = await fetch(`https://www.tcgbuilder.net/${file}`);
        if (!r.ok) continue;
        const cards = await r.json();
        if (Array.isArray(cards)) merged.push(...cards);
      } catch {}
    }

    merged.forEach((card) => {
      card.__nameKey = nameKey(card.name);
      card.__setName = card.setName || card.Set || card.set || "Unknown Set";
    });

    CARD_DB = merged;

    // Build GUID -> card lookup map (deck data is keyed by card GUID)
    CARD_BY_ID = new Map();
    for (const c of CARD_DB) {
      if (c?.id) CARD_BY_ID.set(String(c.id).toLowerCase(), c);
    }

    console.log(
      `[${game}] Loaded ${CARD_DB.length} cards. (id map: ${CARD_BY_ID.size})`
    );
  } catch (err) {
    console.error("Card DB load failed:", err);
  }
}

// ============================
// FUZZY SEARCH
// ============================

function levenshtein(a, b) {
  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[b.length][a.length];
}

function strictThenFuzzy(query) {
  const key = nameKey(query);

  const exact = CARD_DB.filter((c) => c.__nameKey === key);
  if (exact.length) return { matches: exact, fuzzy: false };

  let best = null;
  let bestScore = Infinity;

  for (const c of CARD_DB) {
    const dist = levenshtein(key, c.__nameKey);
    if (dist < bestScore) {
      bestScore = dist;
      best = c;
    }
  }

  if (best && bestScore <= 2) {
    return {
      matches: CARD_DB.filter((c) => c.__nameKey === best.__nameKey),
      fuzzy: true,
      suggestion: best.name,
    };
  }

  return { matches: [] };
}

// ============================
// READY
// ============================

client.once("ready", async () => {
  console.log(`[${game}] Logged in as ${client.user.tag}`);
  await loadCardDB();
});

// ============================
// MESSAGE HANDLER
// ============================

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  // --------------------------
  // DECK HANDLER
  // --------------------------

  const deckMatch = content.match(/\[deck:\s*(.+?)\]/i);
  if (deckMatch) {
    let input = deckMatch[1].trim();

    // allow paste of share URL forms
    // https://www.tcgbuilder.net/?game=...&deck=CODE
    const qMatch = input.match(/[?&]deck=([A-Za-z0-9_-]+)/i);
    if (qMatch) input = qMatch[1];

    // allow /deck/CODE just in case
    const pathMatch = input.match(/\/deck\/([A-Za-z0-9_-]+)/i);
    if (pathMatch) input = pathMatch[1];
	 const gameMatch = deckMatch[1].match(/[?&]game=([A-Za-z0-9_-]+)/i);
	  if (gameMatch) {
		const urlGame = gameMatch[1];
		if (String(urlGame).toLowerCase() !== String(game).toLowerCase()) {
		  return msg.reply(
			`That deck link is for game **${urlGame}**, but this bot is configured for **${game}**.`
		  );
		}
	  }

    const code = input.trim();
    if (!code) return msg.reply("Invalid deck code.");

    try {
      const result = await deckModule.fetchDeck(code);

      if (!result) {
        return msg.reply(`No deck found for code **${code}**.`);
      }

      if (!CARD_DB.length || !CARD_BY_ID.size) {
        return msg.reply("Card database not ready.");
      }

      const embed = deckModule.buildDeckEmbed(code, result, CARD_BY_ID);

      if (!embed) {
        return msg.reply(
          `Deck **${code}** was found, but it contained no entries I can display.`
        );
      }

      return msg.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Deck handler failed:", err);
      return msg.reply(
        `Deck lookup for **${code}** failed while building/sending the embed. Check bot console logs for details.`
      );
    }
  }

  // --------------------------
  // CARD SEARCH
  // --------------------------

  const bracketMatch = content.match(/(?<!\[)\[(.+?)\](?!\])(?!(\())/);
  if (!bracketMatch) return;

  const query = bracketMatch[1].trim();
  if (!query) return;

  if (!CARD_DB.length) {
    return msg.reply("Card database not ready.");
  }

  // --------------------------
  // ADVANCED SEARCH
  // --------------------------

  if (query.includes("|")) {
    const results = advancedSearch(CARD_DB, query, {
  propAliases: config.advancedSearchAliases || {},
});

    if (!results.length) {
		
      return msg.reply(`No results found for **${query}**.`);
    }

// If advanced search returns exactly one result, embed it like strict/fuzzy search
if (results.length === 1) {
  const card = results[0];

  const sameNameGroup = CARD_DB.filter((c) => c.__nameKey === card.__nameKey);

  const fullImageUrl = imageUrlFor(card);
  const websiteUrl = fullImageUrl;

  const embed = new EmbedBuilder()
    .setTitle(card.name)
    .setURL(websiteUrl)
    .setThumbnail(fullImageUrl)
    .setDescription(`${card.Type || card.type || "Unknown Type"}\n\n*${card.Text || ""}*`)
    .setColor(0xc00000);

  const embeds = [embed];

  if (sameNameGroup.length > 1) {
    const links = sameNameGroup
      .slice(1)
      .map((c) => `[${c.__setName}](<${imageUrlFor(c)}>)`)
      .join(", ");

    embeds.push(
      new EmbedBuilder().setDescription(`*See also: ${links}*`).setColor(0x555555)
    );
  }

  return msg.reply({ embeds });
}

    const MAX_RESULTS = 5;
    const shown = results.slice(0, MAX_RESULTS);

const lines = shown.map((c) => {
  const setName = c.__setName || c.set || c.setName || "Unknown Set";
  const label = `${c.name} (${setName})`;
  const imgUrl = imageUrlFor(c);
  return `• [${label}](<${imgUrl}>)`;
});

    let response = lines.join("\n");

    if (results.length > MAX_RESULTS) {
      response += `\n\nAdditional results found. Please narrow your search or visit [TCGBuilder.net](https://tcgbuilder.net/) for more advanced searching.`;
    }

    return msg.reply(response);
  }

  // --------------------------
  // STRICT / FUZZY SEARCH
  // --------------------------

  const result = strictThenFuzzy(query);

  if (!result.matches.length) {
    return msg.reply(
      `No card named **${query}** found.\n${
        noMatchMessages[Math.floor(Math.random() * noMatchMessages.length)]
      }`
    );
  }

  const card = result.matches[0];

  const sameNameGroup = CARD_DB.filter((c) => c.__nameKey === card.__nameKey);

  const fullImageUrl = imageUrlFor(card);
  const websiteUrl = fullImageUrl; 

  const embed = new EmbedBuilder()
    .setTitle(card.name)
    .setURL(websiteUrl)
    .setThumbnail(fullImageUrl)
    .setDescription(`${card.Type || card.type || "Unknown Type"}\n\n*${card.Text || ""}*`)
    .setColor(0xc00000);

  const embeds = [embed];

  if (sameNameGroup.length > 1) {
    const links = sameNameGroup
      .slice(1)
      .map((c) => `[${c.__setName}](<${imageUrlFor(c)}>)`)
      .join(", ");

    embeds.push(
      new EmbedBuilder().setDescription(`*See also: ${links}*`).setColor(0x555555)
    );
  }

  if (result.fuzzy && result.suggestion) {
    embed.setFooter({
      text: `Did you mean: ${result.suggestion}?`,
    });
  }

  return msg.reply({ embeds });
});

client.login(token);
console.log(`[${game}] Bot starting...`);