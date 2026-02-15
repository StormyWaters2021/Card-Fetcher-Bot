const fetch = require("node-fetch");
const { EmbedBuilder } = require("discord.js");

function createDeckModule(config) {
  const DECK_API_BASE = config.deckApiBase;
  const DECK_SHARE_BASE = config.deckShareBase;

  const HEADER_PILE = config.headerPile || null;
  const FOOTER_PILE = config.footerPile || null;

  const DECK_EMBED_ORDER = Array.isArray(config.deckTypeOrder)
	? config.deckTypeOrder
	: [];

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

  function normalizeKey(s) {
    return String(s || "").trim().toLowerCase();
  }

  function makeOrderIndex(orderArr) {
    const map = new Map();
    for (let i = 0; i < orderArr.length; i++) {
      const k = normalizeKey(orderArr[i]);
      if (!k) continue;
      if (!map.has(k)) map.set(k, i);
    }
    return map;
  }

  const TYPE_ORDER_INDEX = makeOrderIndex(DECK_EMBED_ORDER);

  function compareTypeNames(a, b) {
    const ak = normalizeKey(a);
    const bk = normalizeKey(b);
    const ai = TYPE_ORDER_INDEX.has(ak) ? TYPE_ORDER_INDEX.get(ak) : Number.POSITIVE_INFINITY;
    const bi = TYPE_ORDER_INDEX.has(bk) ? TYPE_ORDER_INDEX.get(bk) : Number.POSITIVE_INFINITY;

    // first: explicit order
    if (ai !== bi) return ai - bi;

    // second: alphabetical fallback
    return String(a).localeCompare(String(b));
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

	const typeNames = Array.from(byType.keys()).sort(compareTypeNames);

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

  // ✅ UPDATED: preserves pile order, pins header left + footer right, balances by line count
  function splitBlocksTwoColumns(blocks) {
    function countBlockLines(block) {
      const lines = String(block || "").split("\n");
      // trim trailing empties so weight matches what you see
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return Math.max(1, lines.length);
    }

    // Header is blocks[0] only when it exists (your block builder pushes it first)
    const hasHeader = Boolean(HEADER_PILE) && blocks.length > 0;
    // Footer is last only when it exists (your block builder pushes it last)
    const hasFooter = Boolean(FOOTER_PILE) && blocks.length > 1;

    const headerBlock = hasHeader ? blocks[0] : null;
    const footerBlock = hasFooter ? blocks[blocks.length - 1] : null;

    const middleStart = hasHeader ? 1 : 0;
    const middleEnd = hasFooter ? blocks.length - 1 : blocks.length;
    const middle = blocks.slice(middleStart, middleEnd);

    const fixedLeftW = headerBlock ? countBlockLines(headerBlock) : 0;
    const fixedRightW = footerBlock ? countBlockLines(footerBlock) : 0;

    const weights = middle.map(countBlockLines);
    const totalMiddle = weights.reduce((a, b) => a + b, 0);
    const totalAll = fixedLeftW + fixedRightW + totalMiddle;

    // We want LEFT close to half of overall total, but header is forced into LEFT already
    const targetLeftFromMiddle = Math.max(0, Math.floor(totalAll / 2) - fixedLeftW);
    const target = Math.min(targetLeftFromMiddle, totalMiddle);

    // Subset-sum DP to choose which middle blocks go LEFT (preserves order when building output)
    const dp = Array(target + 1).fill(-1);
    const prev = Array(target + 1).fill(-1);
    dp[0] = -2; // reachable marker

    for (let i = 0; i < weights.length; i++) {
      const wi = weights[i];
      for (let s = target; s >= wi; s--) {
        if (dp[s] === -1 && dp[s - wi] !== -1) {
          dp[s] = i;
          prev[s] = s - wi;
        }
      }
    }

    // Best achievable sum closest to target
    let best = target;
    while (best >= 0 && dp[best] === -1) best--;

    // Reconstruct chosen indices for LEFT (among middle blocks)
    const leftIdx = new Set();
    let s = best;
    while (s > 0) {
      const i = dp[s];
      if (i < 0) break;
      leftIdx.add(i);
      s = prev[s];
    }

    // Build columns in ORIGINAL ORDER with pinned header/footer
    let left = headerBlock ? headerBlock : "";
    let right = "";

    for (let i = 0; i < middle.length; i++) {
      if (leftIdx.has(i)) left += middle[i];
      else right += middle[i];
    }

    if (footerBlock) right += footerBlock;

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
      blocks.push(
        buildFlatBlock(
          `${HEADER_PILE} (${piles.get(HEADER_PILE).reduce((s, x) => s + x.qty, 0)})`,
          piles.get(HEADER_PILE)
        )
      );
    }

    for (const pileName of pileOrder) {
      if (pileName === HEADER_PILE) continue;
      if (pileName === FOOTER_PILE) continue;
      const list = piles.get(pileName) || [];
      if (!list.length) continue;
      blocks.push(...buildTypeBlocks(pileName, list));
    }

    if (FOOTER_PILE && piles.has(FOOTER_PILE)) {
      blocks.push(
        buildFlatBlock(
          `${FOOTER_PILE} (${piles.get(FOOTER_PILE).reduce((s, x) => s + x.qty, 0)})`,
          piles.get(FOOTER_PILE)
        )
      );
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