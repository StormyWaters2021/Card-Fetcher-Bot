function normalize(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPropAliasMap(propAliases = {}) {
  // maps normalized alias -> normalized canonical property name
  const map = new Map();

  for (const [canonicalRaw, aliasesRaw] of Object.entries(propAliases || {})) {
    const canonical = normalize(canonicalRaw);
    if (!canonical) continue;

    // canonical should resolve to itself
    map.set(canonical, canonical);

    const aliases = Array.isArray(aliasesRaw) ? aliasesRaw : [aliasesRaw];
    for (const a of aliases) {
      const alias = normalize(a);
      if (!alias) continue;
      map.set(alias, canonical);
    }
  }

  return map;
}

function resolvePropAlias(propNorm, aliasMap) {
  if (!aliasMap) return propNorm;
  return aliasMap.get(propNorm) || propNorm;
}


function keyNoSpace(str = "") {
  return normalize(str).replace(/\s+/g, "");
}

function compareNumeric(value, operator, target) {
  const num = Number(value);
  const tgt = Number(target);
  if (isNaN(num) || isNaN(tgt)) return false;

  switch (operator) {
    case ">": return num > tgt;
    case "<": return num < tgt;
    case ">=": return num >= tgt;
    case "<=": return num <= tgt;
    case "=": return num === tgt;
    default: return false;
  }
}

function advancedSearch(cards, rawQuery, opts = {}) {
  const aliasMap =
    opts && opts.propAliases
      ? buildPropAliasMap(opts.propAliases)
      : null;

  const parts = rawQuery.split("|").map(p => p.trim()).filter(Boolean);
  let results = cards;

  for (const part of parts) {
    const negated = part.startsWith("!");
    const cleanPart = negated ? part.slice(1) : part;

    const match = cleanPart.match(/^([^:<>=]+)\s*(>=|<=|>|<|:)\s*(.+)$/);

    if (match) {
      const [, propRaw, operatorRaw, valueRaw] = match;

      // normalize then resolve alias -> canonical property name
      const propNorm = normalize(propRaw);
      const prop = resolvePropAlias(propNorm, aliasMap);

      const value = normalize(valueRaw);
      const operator = operatorRaw === ":" ? "=" : operatorRaw;

      results = results.filter(card => {
        const cardKeys = Object.keys(card);
        const key = cardKeys.find(k => normalize(k) === prop);
        if (!key) return false;

        const raw = card[key];

        if (operator === "=") {
          const cv = normalize(raw);
          const isMatch = cv.includes(value);
          return negated ? !isMatch : isMatch;
        } else {
          const isMatch = compareNumeric(raw, operator, value);
          return negated ? !isMatch : isMatch;
        }
      });

    } else {
      const term = normalize(cleanPart);
      const termKey = keyNoSpace(cleanPart);

      results = results.filter(card => {
        const n = normalize(card.name);
        const nk = keyNoSpace(card.name);
        const isMatch = n.includes(term) || nk.includes(termKey);
        return negated ? !isMatch : isMatch;
      });
    }
  }

  return results;
}

function strictNameSearch(cards, query) {
  const qKey = keyNoSpace(query);
  const exact = cards.filter(c => keyNoSpace(c.name) === qKey);
  return exact.length ? exact : [];
}

module.exports = {
  normalize,
  advancedSearch,
  strictNameSearch,
};