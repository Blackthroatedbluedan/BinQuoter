/**
 * Corn bushels (thousands) — same formula as BinData/lib/bushelsCornByManufacturer.js
 */
const COEF = 0.652;
const INNER = 0.42;
const D_TERM = 0.26;
const FT_BROCK = 3.5;
const FT_WESTEEL = 3.67;

export function bushelsCornThousands(diameterFt, ringCount, manufacturer = "Brock") {
  const m = String(manufacturer ?? "").trim().toLowerCase();
  const f = m.includes("westeel") ? FT_WESTEEL : FT_BROCK;
  const D = diameterFt;
  const N = ringCount;
  const inner = D - INNER;
  const raw = inner * inner * (f * N + D_TERM * D) * COEF;
  return Math.round((raw / 1000) * 100) / 100;
}

/** @deprecated use bushelsCornThousands(d, r, "Brock") */
export function bushelsCornThousandsBrock(diameterFt, ringCount) {
  return bushelsCornThousands(diameterFt, ringCount, "Brock");
}
