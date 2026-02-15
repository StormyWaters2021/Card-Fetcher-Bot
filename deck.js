const fetch = require("node-fetch");
const { EmbedBuilder } = require("discord.js");

function createDeckModule(config) {
  const DECK_API_BASE = config.deckApiBase;
  const DECK_SHARE_BASE = config.deckShareBase;

  const HEADER_PILE = config.headerPile || null;
  const FOOTER_PILE = config.footerPile || null;

  async function fetchDeck(code) {
    try {
      const res = await fetch(DECK_API_BASE + code);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("Deck fetch failed:", e);
      return null;
    }
  }

  function normType(t) {
    const s = String(t || "").trim();
    return s || "Unknown Type";
  }

  function buildFlatBlock(title, list) {
    const cards = [...list].sort((a, b) => a.label.localeCompare(b.label));
    let out = `**${title}**\n`;
    for (const c of cards) out += `${c.qty}x ${c.label}\n`;
    out += "\n";
    return out;
  }

  function buildTypeBlocks(pileName, list) {
    const byType = new Map();
    for (const item of list) {
      const t = normType(item.type);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(item);
    }

    const typeNames = Array.from(byType.keys()).sort((a, b) => a.localeCompare(b));

    const blocks = [];
    for (const typeName of typeNames) {
      const cards = byType.get(typeName).sort((a, b) => a.label.localeCompare(b.label));
      let out = `**${pileName} — ${typeName}**\n`;
      for (const c of cards) out += `${c.qty}x ${c.label}\n`;
      out += "\n";
      blocks.push(out);
    }
    return blocks;
  }

  function splitBlocksTwoColumns(blocks) {
    let left = "";
    let right = "";
    let lw = 0;
    let rw = 0;

    for (const b of blocks) {
      const w = b.length;
      if (lw <= rw) {
        left += b;
        lw += w;
      } else {
        right += b;
        rw += w;
      }
    }

    // embed field value limit
    if (left.length > 1024) left = left.slice(0, 1021) + "…";
    if (right.length > 1024) right = right.slice(0, 1021) + "…";

    return { left: left.trim() || "—", right: right.trim() || "—" };
  }

  function buildDeckEmbed(deckCode, deckData, cardById) {
    const entries = Object.entries(deckData || {});
    if (!entries.length) return null;

    // pileName -> array of { qty, label, type }
    const piles = new Map();
    const pileOrder = [];
    const seen = new Set();

    for (const [cardIdRaw, info] of entries) {
      const cardId = String(cardIdRaw).toLowerCase();
      const card = cardById?.get(cardId);

      const label = card?.name ?? `[Missing card: ${cardIdRaw}]`;
      const type = card?.Type || card?.type || "Unknown Type";

      const group =
        info?.group && typeof info.group === "object"
          ? info.group
          : { Main: info?.count ?? 1 };

      for (const [pileName, qtyRaw] of Object.entries(group)) {
        const qty = Number(qtyRaw);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        if (!piles.has(pileName)) piles.set(pileName, []);
        piles.get(pileName).push({ qty, label, type });

        if (!seen.has(pileName)) {
          seen.add(pileName);
          pileOrder.push(pileName);
        }
      }
    }

    // Build blocks in desired order:
    // header pile block (flat) -> middle piles (type blocks) -> footer pile block (flat)
    const blocks = [];

    if (HEADER_PILE && piles.has(HEADER_PILE)) {
      blocks.push(buildFlatBlock(`${HEADER_PILE} (${piles.get(HEADER_PILE).reduce((s,x)=>s+x.qty,0)})`, piles.get(HEADER_PILE)));
    }

    for (const pileName of pileOrder) {
      if (pileName === HEADER_PILE) continue;
      if (pileName === FOOTER_PILE) continue;
      const list = piles.get(pileName) || [];
      if (!list.length) continue;
      blocks.push(...buildTypeBlocks(pileName, list));
    }

    if (FOOTER_PILE && piles.has(FOOTER_PILE)) {
      blocks.push(buildFlatBlock(`${FOOTER_PILE} (${piles.get(FOOTER_PILE).reduce((s,x)=>s+x.qty,0)})`, piles.get(FOOTER_PILE)));
    }

    if (!blocks.length) return null;

    const { left, right } = splitBlocksTwoColumns(blocks);

    const embed = new EmbedBuilder()
      .setTitle(`Deck ${deckCode}`)
      .setURL(DECK_SHARE_BASE + deckCode)
      .setColor(0x0099ff);

    // Two columns + spacer to force next content onto next row
    embed.addFields(
      { name: "\u200B", value: left, inline: true },
      { name: "\u200B", value: right, inline: true },
      { name: "\u200B", value: "\u200B", inline: true }
    );

    const uniqueCards = entries.length;
    const totalCopies = Array.from(piles.values()).flat().reduce((s, x) => s + x.qty, 0);
    embed.setFooter({ text: `Cards: ${uniqueCards} • Copies: ${totalCopies}` });

    return embed;
  }

  return { fetchDeck, buildDeckEmbed };
}

module.exports = createDeckModule;