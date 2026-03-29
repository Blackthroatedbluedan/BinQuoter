/**
 * Browser-side ridge model prediction — replaces Gemini API calls.
 * Loads model.json coefficients and runs the same dot-product as
 * manhour-data/model/features_bin.mjs.
 */

import modelData from '../manhour-data/artifacts/model.json';
import { JOBS } from '../data';
import { Job, PredictionParams, ManHourPrediction, RecommendationParams, BinRecommendation, QuoteParams, QuoteResult } from '../types';

// ── Bushels formula (matches lib/bushelsCornByManufacturer.js) ──

const COEF = 0.652;
const INNER = 0.42;
const D_TERM = 0.26;
const FT_BROCK = 3.5;
const FT_WESTEEL = 3.67;

export function bushelsCornThousands(diameterFt: number, ringCount: number, manufacturer = "Brock"): number {
  const m = (manufacturer ?? "").trim().toLowerCase();
  const f = m.includes("westeel") ? FT_WESTEEL : FT_BROCK;
  const D = diameterFt;
  const N = ringCount;
  const inner = D - INNER;
  const raw = inner * inner * (f * N + D_TERM * D) * COEF;
  return Math.round((raw / 1000) * 100) / 100;
}

// ── Feature vector (matches model/features_bin.mjs rowToFeaturesNewBuild) ──

function yn(v: boolean | string | undefined | null): number {
  if (v === true || v === "Yes" || v === "yes" || v === "Y" || v === "y") return 1;
  return 0;
}

function buildFeatureVector(
  diameter: number,
  rings: number,
  bushelsK: number,
  guys: number,
  driveHours: number,
  sidedraw: boolean,
  stirator: boolean,
  topDry: boolean,
  daySweep: boolean,
  hopperBin: boolean,
  manufacturer = "Brock",
): number[] {
  const d = diameter;
  const ringsPerDia = d > 0 ? rings / d : 0;
  const diameterSq1000 = (d * d) / 1000;
  const dxR1000 = (d * rings) / 1000;
  const wideDiaPast60 = Math.max(0, d - 60) / 10;
  const footprint = Math.sqrt(Math.max(0, d * rings) + 1);
  const guysOverFootprint = footprint > 0 ? guys / footprint : guys;
  const mWest = (manufacturer ?? "").toLowerCase().includes("westeel") ? 1 : 0;

  return [
    1,                           // intercept
    driveHours,                  // Drive_hrs
    d,                           // Diameter
    rings,                       // Rings
    ringsPerDia,                 // Rings_per_Diameter
    diameterSq1000,              // Diameter_sq_div_1000
    dxR1000,                     // D_times_R_div_1000
    wideDiaPast60,               // max0_D_minus_60_div_10
    Math.log1p(Math.max(0, bushelsK)), // log1p_Bushels_k
    guys,                        // Guys
    guysOverFootprint,           // Guys_per_sqrt_DxR
    yn(sidedraw),                // Sidedraw
    yn(stirator),                // Stirator
    yn(topDry),                  // TopDry
    yn(daySweep),                // DaySweep
    yn(hopperBin),               // HopperBin
    mWest,                       // Mfg_Westeel
  ];
}

function dotProduct(beta: number[], features: number[]): number {
  let h = 0;
  for (let i = 0; i < beta.length; i++) h += beta[i] * features[i];
  return Math.max(0, h);
}

// ── Nearest neighbor lookup ──

interface ScoredJob {
  job: Job;
  dist: number;
}

const FLAG_KEYS = ['sidedraw', 'stirator', 'topDry', 'daySweep', 'hopperBin'] as const;

function jobDistance(
  input: { diameter: number; rings: number; sidedraw: boolean; stirator: boolean; topDry: boolean; daySweep: boolean; hopperBin: boolean; manufacturer?: string },
  hist: Job,
): number {
  const dD = input.diameter - hist.diameter;
  const dR = input.rings - hist.rings;
  let dist = 1.0 * (dD * dD) + 2.0 * (dR * dR);
  for (const flag of FLAG_KEYS) {
    if ((input[flag] ? 1 : 0) !== (hist[flag] ? 1 : 0)) dist += 5.0;
  }
  const mfgInput = (input.manufacturer ?? "Brock").trim();
  const mfgHist = (hist.manufacturer ?? "Brock").trim();
  if (mfgInput !== mfgHist) dist += 3.0;
  return dist;
}

function findNearestJobs(
  input: { diameter: number; rings: number; sidedraw: boolean; stirator: boolean; topDry: boolean; daySweep: boolean; hopperBin: boolean; manufacturer?: string },
  jobs: Job[],
  n = 3,
): ScoredJob[] {
  const scored: ScoredJob[] = jobs
    .filter(j => j.manHours > 0)
    .map(job => ({ job, dist: jobDistance(input, job) }));
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, n);
}

// ── Public API (drop-in replacement for geminiService) ──

const beta: number[] = (modelData as { beta: number[] }).beta;

export function getManHourPrediction(jobs: Job[], params: PredictionParams): ManHourPrediction {
  const allJobs = jobs.length > 0 ? jobs : JOBS;
  const bushelsK = bushelsCornThousands(params.diameter, params.rings, "Brock");

  const features = buildFeatureVector(
    params.diameter, params.rings, bushelsK,
    params.crewSize, params.driveHours,
    params.sidedraw, params.stirator, params.topDry, params.daySweep, params.hopperBin,
  );
  const predicted = dotProduct(beta, features);

  const nearest = findNearestJobs(params, allJobs, 3);
  const neighborAvg = nearest.length > 0
    ? nearest.reduce((s, n) => s + n.job.manHours, 0) / nearest.length
    : predicted;

  const comparables = nearest.map(n =>
    `${n.job.customer}: ${n.job.diameter}×${n.job.rings} = ${n.job.manHours.toFixed(0)} hrs (${n.job.buildType})`
  ).join("; ");

  return {
    predictedHours: Math.round(predicted * 10) / 10,
    reasoning: `Ridge model v3 prediction based on ${(modelData as { trainingRows: number }).trainingRows} historical builds. `
      + `Nearest comparables: ${comparables}. `
      + `Neighbor average: ${neighborAvg.toFixed(0)} hrs.`,
  };
}

// ── Cost constants ──
const BILLING_RATE = 60;
const LABOURER_WAGE = 24;
const FOREMAN_WAGE = 40;
const HOTEL_RATE = 160;
const HOTEL_PPL_PER_ROOM = 2;
const HOTEL_DRIVE_THRESHOLD = 1.5;
const DIESEL_RATE_PER_KM = 0.55;
const AVG_SPEED_KMH = 80;
const MACHINE_RENTAL_PER_DAY = 250;
const WORK_HOURS_PER_DAY = 10;

export function getJobQuote(jobs: Job[], params: QuoteParams): QuoteResult {
  const allJobs = jobs.length > 0 ? jobs : JOBS;
  const crewSize = params.labourers + params.foremen;
  const bushelsK = bushelsCornThousands(params.diameter, params.rings, params.manufacturer);

  const features = buildFeatureVector(
    params.diameter, params.rings, bushelsK,
    crewSize, params.driveHours,
    params.sidedraw, params.stirator, params.topDry, params.daySweep, params.hopperBin,
    params.manufacturer,
  );
  const predicted = dotProduct(beta, features);
  const buildDays = Math.ceil(predicted / (crewSize * WORK_HOURS_PER_DAY));

  const laborRevenue = predicted * BILLING_RATE;

  const internalCostPerHour = (params.labourers * LABOURER_WAGE) + (params.foremen * FOREMAN_WAGE);
  const internalLabor = (predicted / crewSize) * internalCostPerHour;

  const needsHotel = params.driveHours > HOTEL_DRIVE_THRESHOLD;
  const hotelRooms = needsHotel ? Math.ceil(crewSize / HOTEL_PPL_PER_ROOM) : 0;
  const hotelNights = needsHotel ? Math.max(0, buildDays - 1) : 0;
  const hotelCost = hotelRooms * hotelNights * HOTEL_RATE;

  const oneWayKm = params.driveHours * AVG_SPEED_KMH;
  const roundTripKm = oneWayKm * 2;
  const dieselTrips = needsHotel ? 1 : buildDays;
  const totalKm = roundTripKm * dieselTrips;
  const dieselCost = totalKm * DIESEL_RATE_PER_KM;

  const machineCost = params.machineRental ? buildDays * MACHINE_RENTAL_PER_DAY : 0;

  const driveTrips = needsHotel ? 2 : buildDays * 2;
  const totalDriveHours = driveTrips * params.driveHours;
  const internalDriveLabor = totalDriveHours * internalCostPerHour;

  // $60/hr is the all-in billing rate — hotel, diesel, machine come out of that, not added on top
  const totalQuote = laborRevenue;
  const totalInternalCost = internalLabor + internalDriveLabor + hotelCost + dieselCost + machineCost;
  const grossMargin = totalQuote - totalInternalCost;
  const marginPct = totalQuote > 0 ? (grossMargin / totalQuote) * 100 : 0;

  const nearest = findNearestJobs(
    { diameter: params.diameter, rings: params.rings, sidedraw: params.sidedraw, stirator: params.stirator, topDry: params.topDry, daySweep: params.daySweep, hopperBin: params.hopperBin, manufacturer: params.manufacturer },
    allJobs, 3,
  );
  const comparables = nearest.map(n =>
    `${n.job.customer}: ${n.job.diameter}×${n.job.rings} = ${n.job.manHours.toFixed(0)} hrs`
  ).join("; ");

  return {
    predictedHours: Math.round(predicted * 10) / 10,
    buildDays,
    bushelsK,
    laborRevenue,
    hotelCost,
    dieselCost,
    machineCost,
    totalQuote,
    internalLabor,
    internalDriveLabor: internalDriveLabor,
    totalInternalCost,
    grossMargin,
    marginPct,
    needsHotel,
    hotelRooms,
    hotelNights,
    totalKm,
    crewSize,
    reasoning: `Comparables: ${comparables}.`,
  };
}

export function getBinRecommendation(jobs: Job[], params: RecommendationParams): BinRecommendation {
  const allJobs = jobs.length > 0 ? jobs : JOBS;

  const BIN_CONFIGS: { diameter: number; rings: number }[] = [];
  for (const d of [15, 18, 21, 24, 27, 30, 33, 36, 42, 45, 48, 54, 60, 72, 78, 84]) {
    for (let r = 4; r <= 30; r++) {
      const bu = bushelsCornThousands(d, r);
      if (bu >= params.desiredBushels * 0.8 && bu <= params.desiredBushels * 2.0) {
        BIN_CONFIGS.push({ diameter: d, rings: r });
      }
    }
  }

  if (BIN_CONFIGS.length === 0) {
    for (const d of [60, 72, 78, 84]) {
      BIN_CONFIGS.push({ diameter: d, rings: 26 });
    }
  }

  let bestConfig = BIN_CONFIGS[0];
  let bestHours = Infinity;
  let bestBu = 0;

  for (const cfg of BIN_CONFIGS) {
    const bu = bushelsCornThousands(cfg.diameter, cfg.rings);
    if (bu < params.desiredBushels) continue;

    const features = buildFeatureVector(
      cfg.diameter, cfg.rings, bu, 6, 1,
      params.sidedraw, params.stirator, params.topDry, params.daySweep, params.hopperBin,
    );
    const hrs = dotProduct(beta, features);

    if (hrs < bestHours) {
      bestHours = hrs;
      bestConfig = cfg;
      bestBu = bu;
    }
  }

  if (bestBu === 0) bestBu = bushelsCornThousands(bestConfig.diameter, bestConfig.rings);
  if (bestHours === Infinity) {
    const features = buildFeatureVector(
      bestConfig.diameter, bestConfig.rings, bestBu, 6, 1,
      params.sidedraw, params.stirator, params.topDry, params.daySweep, params.hopperBin,
    );
    bestHours = dotProduct(beta, features);
  }

  const nearest = findNearestJobs(
    { ...bestConfig, sidedraw: params.sidedraw, stirator: params.stirator, topDry: params.topDry, daySweep: params.daySweep, hopperBin: params.hopperBin },
    allJobs,
    3,
  );
  const comparables = nearest.map(n =>
    `${n.job.customer}: ${n.job.diameter}×${n.job.rings} = ${n.job.manHours.toFixed(0)} hrs`
  ).join("; ");

  return {
    recommendedDiameter: bestConfig.diameter,
    recommendedRings: bestConfig.rings,
    predictedHours: Math.round(bestHours * 10) / 10,
    reasoning: `Smallest bin meeting ${params.desiredBushels}k bu capacity with fewest labor hours. `
      + `${bestConfig.diameter}ft × ${bestConfig.rings} rings = ${bestBu.toFixed(1)}k bu. `
      + `Comparables: ${comparables}.`,
  };
}
