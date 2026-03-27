/**
 * Synonym / typo normalization for Job# and Customer matching across sheets.
 * Rules from ops: malthebs↔malcoms, picton↔parks, charles↔rivetts, djongs↔youngfield,
 * dan king vs jan king, grafton family names, etc.
 */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primary numeric job id(s) for matching combined cells like 6605/6657 */
function extractJobNumbers(s) {
  const m = String(s || '').match(/\d{3,5}/g);
  return m ? [...new Set(m)] : [];
}

/**
 * Returns a canonical entity key for fuzzy matching, or null if unknown.
 * Multiple patterns can map to the same key.
 */
function canonicalEntityKey(s) {
  const raw = String(s || '');
  const n = normalize(raw);

  if (!n) return null;

  // Kings: Jan vs Dan (never treat "Jan King" as Dan)
  if (/jan\s*king/i.test(raw) || /\bjan\s+king\b/i.test(n)) return 'cust_king_jan';
  if (/dan\s*king/i.test(raw) || /\bdan\s+king\b/i.test(n)) return 'cust_king_dan';
  if (/\bdan\s*kings\b/i.test(n)) return 'cust_king_dan';
  if (/\bkings\b/i.test(raw) && !/jan/i.test(raw)) return 'cust_king_dan';

  // Malcoms / typos (incl. "maltheb" missing s)
  if (/malthebs?|maltheb\b|malcom|malcolm|malcombe/i.test(n)) return 'cust_malcoms';

  // Picton / Pickton / Parks / Dan Parks
  if (/picton|pickton/i.test(n)) return 'loc_picton_parks';
  if (/dan\s*parks?/i.test(n)) return 'loc_picton_parks';
  if (/(?<![a-z])parks(?![a-z])/i.test(raw) && !/car\s*parks?/i.test(n)) return 'loc_picton_parks';

  // Nappanee ↔ Millspring (same site / customer family)
  if (/nappanee|millspring/i.test(n)) return 'loc_nappanee_millspring';

  // Charles / Rivetts
  if (/charles|rivett/i.test(n)) return 'cust_charles_rivetts';

  // DeJongs / Youngfield / djongs typo / "Youngfeild" misspelling
  if (/djong|dejong|youngfield|youngfeild/i.test(n)) return 'cust_youngfield';

  // Grafton / Ians / Greydaunis
  if (/grafton|greydaun|grey\s*daun|\bians?\b/i.test(n)) return 'loc_grafton_family';

  // Grams ↔ Dave Graham
  if (/^grams$/i.test(raw.trim())) return 'cust_dave_graham';
  if (/\bdave\s*graham\b/i.test(n)) return 'cust_dave_graham';

  return null;
}

/** True if two strings refer to the same entity (synonyms, typos, or same job #). */
function entitiesMatch(a, b) {
  const na = extractJobNumbers(a);
  const nb = extractJobNumbers(b);
  if (na.length && nb.length && na.some((x) => nb.includes(x))) return true;

  const ka = canonicalEntityKey(a);
  const kb = canonicalEntityKey(b);
  if (ka && kb && ka === kb) return true;

  return false;
}

/**
 * Suggest canonical display for obvious typos in a cell (conservative).
 * Returns { value, changed } — only changes when we recognize a known typo form.
 */
function maybeCorrectTypo(s, field /* 'job' | 'customer' */) {
  const raw = String(s || '');
  const n = normalize(raw);

  // Malthebs → Malcoms
  if (/malthebs/i.test(raw)) {
    return { value: raw.replace(/malthebs/gi, 'Malcoms'), changed: true };
  }
  if (/\bmaltheb\b/i.test(raw)) {
    return { value: raw.replace(/\bmaltheb\b/gi, 'Malcoms'), changed: true };
  }

  // djongs → DeJongs (match sheet style)
  if (/djongs/i.test(raw)) {
    return { value: raw.replace(/djongs/gi, 'DeJongs'), changed: true };
  }

  if (field === 'customer' && /greydaunis/i.test(raw)) {
    return { value: raw.replace(/greydaunis/gi, 'Greydaunis'), changed: true };
  }

  if (/pickton/i.test(raw)) {
    return { value: raw.replace(/pickton/gi, 'Picton'), changed: true };
  }
  if (/youngfeild/i.test(raw)) {
    return { value: raw.replace(/youngfeild/gi, 'Youngfield'), changed: true };
  }

  if (field === 'customer' && /^\s*grams\s*$/i.test(raw)) {
    return { value: 'Dave Graham', changed: true };
  }

  return { value: raw, changed: false };
}

module.exports = {
  normalize,
  extractJobNumbers,
  canonicalEntityKey,
  entitiesMatch,
  maybeCorrectTypo,
};
