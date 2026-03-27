/**
 * Infer equipment flags from Ship To Name + invoice / tracking description (Yes/No for 2025 CSV).
 * Heuristic only — review edge cases in the sheet.
 */

/**
 * @param {string} shipTo
 * @param {string} description
 * @returns {{ sidedraw: string, stirator: string, topDry: string, daySweep: string, hopperBin: string }}
 */
function parseBinEquipmentFlags(shipTo, description) {
  const t = `${String(shipTo ?? "")}\n${String(description ?? "")}`;
  const lower = t.toLowerCase();

  const hopperBin = /\bhopper\b/i.test(t);

  const stirator =
    /\bstirator\b/i.test(t) ||
    /\bstir\s*[-]?\s*bin\b/i.test(lower) ||
    /\bstir\s+bin\b/i.test(lower) ||
    (/\bstir\b/i.test(t) && /\bbin\b/i.test(lower));

  const topDry =
    /\btop\s*[-]?\s*dry\b/i.test(t) ||
    /\btopdry\b/i.test(lower) ||
    /\btop\s+dry\b/i.test(lower);

  const sidedraw = /\bside\s*[-]?\s*draw\b/i.test(t) || /\bsidedraw\b/i.test(lower);

  const daySweep =
    /\bday\s*[-]?\s*sweep\b/i.test(t) ||
    /\bdaysweep\b/i.test(lower) ||
    /\bday\s+sweep\b/i.test(lower);

  const yn = (v) => (v ? "Yes" : "No");

  return {
    sidedraw: yn(sidedraw),
    stirator: yn(stirator),
    topDry: yn(topDry),
    daySweep: yn(daySweep),
    hopperBin: yn(hopperBin),
  };
}

module.exports = { parseBinEquipmentFlags };
