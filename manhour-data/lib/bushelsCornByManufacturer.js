/**
 * Corn capacity (full bushels) from diameter × ring count.
 * Westeel MFC: 44-inch sheets → ~3.67 ft effective height per sheet (same as prior Westeel-only helper).
 * Brock NC / default: 42-inch rings → 3.5 ft per ring.
 *
 * Form: (D - 0.42)^2 * (ftPerRing * N + 0.26 * D) * 0.652
 */

const COEF = 0.652;
const INNER = 0.42;
const D_TERM = 0.26;
const FT_WESTEEL = 3.67;
const FT_BROCK = 3.5;

function ftPerRingFromManufacturer(manufacturer) {
  const m = String(manufacturer ?? "").trim().toLowerCase();
  if (m.includes("westeel")) return FT_WESTEEL;
  return FT_BROCK;
}

/**
 * @param {number} diameterFt
 * @param {number} ringCount
 * @param {string} [manufacturer] Brock vs Westeel (empty → Brock-style)
 * @returns {number} bushels (full count)
 */
function bushelsCornInSheets(diameterFt, ringCount, manufacturer) {
  const D = diameterFt;
  const N = ringCount;
  const f = ftPerRingFromManufacturer(manufacturer);
  const inner = D - INNER;
  return inner * inner * (f * N + D_TERM * D) * COEF;
}

/**
 * @param {number} diameterFt
 * @param {number} ringCount
 * @param {string} [manufacturer]
 * @returns {number} thousands of bushels (2 decimals)
 */
function bushelsCornThousands(diameterFt, ringCount, manufacturer) {
  const raw = bushelsCornInSheets(diameterFt, ringCount, manufacturer);
  return Math.round((raw / 1000) * 100) / 100;
}

/** Legacy: always Westeel 44" coefficients. */
function bushelsCornWesteel44InSheets(diameterFt, ringCount) {
  return bushelsCornInSheets(diameterFt, ringCount, "Westeel");
}

function bushelsCornWesteel44Thousands(diameterFt, ringCount) {
  return bushelsCornThousands(diameterFt, ringCount, "Westeel");
}

module.exports = {
  bushelsCornInSheets,
  bushelsCornThousands,
  bushelsCornWesteel44InSheets,
  bushelsCornWesteel44Thousands,
  ftPerRingFromManufacturer,
  FT_WESTEEL,
  FT_BROCK,
};
