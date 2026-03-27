import { readCsv } from "./csv_utils.mjs";

const YES = new Set(["yes", "y", "true", "1"]);

/** Yes/No columns from Excel (Sidedraw, Stirator, …) */
export function yn(v) {
  if (v === undefined || v === null || String(v).trim() === "") return 0;
  return YES.has(String(v).trim().toLowerCase()) ? 1 : 0;
}

export function num(v, fallback = 0) {
  const s = String(v ?? "").trim();
  if (s === "") return fallback;
  const x = Number(s);
  return Number.isFinite(x) ? x : fallback;
}

export function log1p(x) {
  return Math.log1p(Math.max(0, x));
}

/**
 * New-build-only ridge features. Specialty add-ons are explicit 0/1 terms (large timeline impact).
 * Geometry: diameter + rings + rings/diameter (tall/skinny vs short/fat vs bushels-only).
 * Diameter_sq + D×R: superlinear “big bin” labor (roof, crane, staging) — linear D/R alone + log(bushels)
 * under-predicts 72–84′ class vs training anchors (e.g. 78×26, 72×25).
 * Crew: guys + guys/sqrt(d*rings) to allow “too many people on a small job” inefficiency.
 */
export function rowToFeaturesNewBuild(rec) {
  const drive = num(rec.Drive_hrs, 0);
  const d = num(rec.Diameter, 0);
  const rings = num(rec.Rings, 0);
  const bushels = num(rec.Bushels_k, 0);
  let guys = num(rec.Guys, NaN);
  if (!Number.isFinite(guys) || guys < 0) guys = 6;
  const ringsPerDia = d > 0 ? rings / d : 0;
  /** Scaled so coefficients stay O(1–100); 84′ → ~7, 30′ → ~0.9 */
  const diameterSq1000 = (d * d) / 1000;
  const dxR1000 = (d * rings) / 1000;
  /** Hours ramp up non-linearly past ~60′ (crane, roof sheets, crew coordination). 84′ → 2.4, 60′ → 0 */
  const wideDiaPast60 = Math.max(0, d - 60) / 10;
  const footprint = Math.sqrt(Math.max(0, d * rings) + 1);
  const guysOverFootprint = footprint > 0 ? guys / footprint : guys;
  /** Reference: Brock (or other); 1 when Westeel — avoids collinearity with intercept when all rows are Brock. */
  const mWest = rec.BinManufacturer === "Westeel" ? 1 : 0;
  return [
    1,
    drive,
    d,
    rings,
    ringsPerDia,
    diameterSq1000,
    dxR1000,
    wideDiaPast60,
    log1p(bushels),
    guys,
    guysOverFootprint,
    yn(rec.Sidedraw),
    yn(rec.Stirator),
    yn(rec.TopDry),
    yn(rec.DaySweep),
    yn(rec.HopperBin),
    mWest,
  ];
}

export function featureLabelsNewBuild() {
  return [
    "intercept",
    "Drive_hrs",
    "Diameter",
    "Rings",
    "Rings_per_Diameter",
    "Diameter_sq_div_1000",
    "D_times_R_div_1000",
    "max0_D_minus_60_div_10",
    "log1p_Bushels_k",
    "Guys",
    "Guys_per_sqrt_DxR",
    "Sidedraw",
    "Stirator",
    "TopDry",
    "DaySweep",
    "HopperBin",
    "Mfg_Westeel",
  ];
}

/**
 * @param {string} csvPath
 * @param {{ yearFilter?: number | null, buildNewOnly?: boolean, defaultGuys?: number } | number | null} [options]
 */
export function loadBinTrainingRecords(csvPath, options = {}) {
  if (typeof options === "number") {
    options = { yearFilter: options };
  }
  const yearFilter = options.yearFilter !== undefined ? options.yearFilter : null;
  const buildNewOnly = options.buildNewOnly === true;
  const defaultGuys = num(options.defaultGuys, 6);

  const { records } = readCsv(csvPath);
  const out = [];
  for (const rec of records) {
    const y = num(rec.Hours, NaN);
    if (!Number.isFinite(y) || y <= 0) continue;
    if (buildNewOnly && String(rec.Build ?? "").trim() !== "New") continue;
    if (yearFilter != null && String(rec.year ?? "").trim() !== "") {
      const yr = num(rec.year, NaN);
      if (Number.isFinite(yr) && yr !== yearFilter) continue;
    }
    const copy = { ...rec };
    const g = String(copy.Guys ?? "").trim();
    if (g === "" || !Number.isFinite(num(copy.Guys, NaN))) {
      copy.Guys = String(defaultGuys);
    }
    out.push(copy);
  }
  return out;
}

/** Ridge dot-product; use with beta from train (New-build model). */
export function predictNewBuildHours(beta, rec) {
  const f = rowToFeaturesNewBuild(rec);
  let h = 0;
  for (let i = 0; i < beta.length; i++) h += beta[i] * f[i];
  return Math.max(0, h);
}

/** @deprecated use predictNewBuildHours */
export function predictHours(beta, rec) {
  return predictNewBuildHours(beta, rec);
}
