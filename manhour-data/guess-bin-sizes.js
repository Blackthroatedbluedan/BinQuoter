/**
 * "For fun" guess: map trusted job total hours (2023/2024) to a plausible bin size
 * using 2025 measured builds from "2025 Man Hour Data - 2025 Bin Hours.csv".
 *
 * Method:
 *   • Sort 2025 rows by reported Hours (real builds).
 *   • For each target hour total H: linearly interpolate Diameter, Rings, Bushels between
 *     the two bracketing builds; extrapolate below/above using the nearest segment slope.
 *   • Optional: if canonical TEXT_* loosely matches a 2025 Customer name, note a name match.
 *
 * Not engineering advice — heuristic for analysis exploration only.
 *
 * Usage: node guess-bin-sizes.js
 */
const fs = require('fs');
const path = require('path');

const DATA_2025 = path.join(__dirname, '2025 Man Hour Data - 2025 Bin Hours.csv');
const OUT_DIR = path.join(__dirname, 'output');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function load2025Builds() {
  const raw = fs.readFileSync(DATA_2025, 'utf8');
  const lines = raw.split(/\r?\n/);
  const builds = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^,+$/.test(line.replace(/,/g, ''))) continue;
    if (/total bin hours/i.test(line)) break;
    const p = parseCsvLine(line);
    if (p.length < 8) continue;
    const yearCol = p.length >= 15 ? parseInt(String(p[14] ?? '').trim(), 10) : NaN;
    if (Number.isFinite(yearCol) && yearCol !== 2025) continue;
    const customer = String(p[0] || '').trim();
    const diameter = parseFloat(p[4]);
    const rings = parseFloat(p[5]);
    const bushels = parseFloat(p[6]);
    const hours = parseFloat(p[7]);
    if (Number.isNaN(hours) || hours <= 0) continue;
    if (Number.isNaN(diameter) || diameter <= 0) continue;
    builds.push({
      customer,
      hours,
      diameter,
      rings: Number.isNaN(rings) ? 0 : rings,
      bushels: Number.isNaN(bushels) ? 0 : bushels,
      build: String(p[2] || '').trim(),
      manufacturer: String(p[3] || '').trim(),
    });
  }
  builds.sort((a, b) => a.hours - b.hours);
  return builds;
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

/** Interpolate/extrapolate bin specs for target hours H using sorted builds by hours. */
function guessFromHours(H, sorted) {
  if (!sorted.length) return null;
  const n = sorted.length;
  if (n === 1) {
    const b = sorted[0];
    return {
      diameter: b.diameter,
      rings: Math.round(b.rings),
      bushels: b.bushels,
      method: 'single_2025_anchor',
      ref: b.customer,
    };
  }

  if (H <= sorted[0].hours) {
    const a = sorted[0];
    const b = sorted[1];
    const t = (H - a.hours) / (b.hours - a.hours);
    return {
      diameter: Math.max(6, lerp(a.diameter, b.diameter, t)),
      rings: Math.max(0, Math.round(lerp(a.rings, b.rings, t))),
      bushels: Math.max(0, lerp(a.bushels, b.bushels, t)),
      method: 'extrapolated_below_smallest_2025_build',
      ref: `${a.customer}→${b.customer}`,
    };
  }
  if (H >= sorted[n - 1].hours) {
    const a = sorted[n - 2];
    const b = sorted[n - 1];
    const t = (H - a.hours) / (b.hours - a.hours);
    return {
      diameter: lerp(a.diameter, b.diameter, t),
      rings: Math.max(0, Math.round(lerp(a.rings, b.rings, t))),
      bushels: Math.max(0, lerp(a.bushels, b.bushels, t)),
      method: 'extrapolated_above_largest_2025_build',
      ref: `${a.customer}→${b.customer}`,
    };
  }

  for (let i = 0; i < n - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (H >= a.hours && H <= b.hours) {
      const t = (H - a.hours) / (b.hours - a.hours);
      return {
        diameter: lerp(a.diameter, b.diameter, t),
        rings: Math.round(lerp(a.rings, b.rings, t)),
        bushels: lerp(a.bushels, b.bushels, t),
        method: 'interpolated_between_2025_builds',
        ref: `${a.customer} (${a.hours}h) ↔ ${b.customer} (${b.hours}h)`,
      };
    }
  }

  const nearest = sorted.reduce((best, b) =>
    Math.abs(b.hours - H) < Math.abs(best.hours - H) ? b : best
  );
  return {
    diameter: nearest.diameter,
    rings: Math.round(nearest.rings),
    bushels: nearest.bushels,
    method: 'nearest_hours_neighbor',
    ref: nearest.customer,
  };
}

function looseNameMatch(canonicalId, builds) {
  const id = String(canonicalId);
  if (!/^TEXT_/i.test(id) && !/[a-z]{3,}/i.test(id)) return null;
  let probe = id
    .replace(/^TEXT_/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (probe.length < 3) return null;
  const aliases = { maltheb: 'maltheb', ians: 'greydanus', grafton: 'greydanus' };
  if (aliases[probe.split(/\s+/)[0]]) probe = aliases[probe.split(/\s+/)[0]];

  for (const b of builds) {
    const c = b.customer.toLowerCase();
    if (c && (probe.includes(c) || c.includes(probe.slice(0, Math.min(probe.length, 6))))) {
      return b;
    }
  }
  return null;
}

function esc(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function loadTrustedJobs(year) {
  const p = path.join(OUT_DIR, `year_${year}`, 'sheet1_jobs_with_trust.csv');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 5) continue;
    if (parts[4].trim().toLowerCase() !== 'yes') continue;
    rows.push({
      canonical_job_id: parts[0],
      total_hours: parseFloat(parts[1]),
      contributors: parts[3],
    });
  }
  return rows;
}

function main() {
  if (!fs.existsSync(DATA_2025)) {
    console.error('Missing:', DATA_2025);
    process.exit(1);
  }

  const builds = load2025Builds();
  const hMin = builds[0]?.hours;
  const hMax = builds[builds.length - 1]?.hours;

  const outLines = [
    [
      'source_year',
      'canonical_job_id',
      'total_hours_sheet1',
      'guess_diameter_ft',
      'guess_rings',
      'guess_bushels_thousand',
      'guess_method',
      'bracket_or_ref',
      'optional_name_match_2025',
    ].join(','),
  ];

  const txt = [
    'Guess bin sizes for trusted jobs (heuristic)',
    `2025 calibration builds: ${builds.length} rows, hours range ${hMin?.toFixed(2)} – ${hMax?.toFixed(2)}`,
    '',
  ];

  for (const year of [2023, 2024]) {
    const jobs = loadTrustedJobs(year);
    txt.push(`--- Year ${year} (${jobs.length} trusted jobs) ---`);
    for (const j of jobs) {
      const H = j.total_hours;
      const g = guessFromHours(H, builds);
      const nameHit = looseNameMatch(j.canonical_job_id, builds);
      const nameNote = nameHit
        ? `similar: ${nameHit.customer} (${nameHit.diameter}' x ${nameHit.rings}r, ${nameHit.hours}h)`
        : '';

      outLines.push(
        [
          year,
          j.canonical_job_id,
          H.toFixed(4),
          g ? g.diameter.toFixed(2) : '',
          g ? g.rings : '',
          g ? g.bushels.toFixed(2) : '',
          g ? g.method : '',
          esc(g ? g.ref : ''),
          esc(nameNote),
        ].join(',')
      );

      if (g) {
        txt.push(
          `  ${j.canonical_job_id}  ${H.toFixed(1)}h  →  ~${g.diameter.toFixed(1)} ft dia, ~${g.rings} rings, ~${g.bushels.toFixed(1)}k bu  [${g.method}]`
        );
      }
    }
    txt.push('');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvPath = path.join(OUT_DIR, 'guess_bin_sizes_trusted_jobs.csv');
  fs.writeFileSync(csvPath, outLines.join('\n'), 'utf8');

  const txtPath = path.join(OUT_DIR, 'guess_bin_sizes_README.txt');
  fs.writeFileSync(
    txtPath,
    [
      'GUESS BIN SIZES (for fun / exploration)',
      '',
      'Uses 2025 Man Hour Data - 2025 Bin Hours.csv as a calibration curve:',
      'hours on the job vs diameter / rings / bushels from real 2025 builds.',
      '',
      'For each trusted job in sheet1_jobs_with_trust (2023 & 2024), total Sheet1 hours',
      'are mapped along that curve: interpolate between two bracketing builds, or',
      'extrapolate using the slope of the nearest segment if outside the 2025 range.',
      '',
      'This is NOT structural engineering. Use for rough what-if and storyboarding only.',
      '',
      `Output: ${csvPath}`,
      '',
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(path.join(OUT_DIR, 'guess_bin_sizes_preview.txt'), txt.join('\n'), 'utf8');

  console.log(`Wrote ${csvPath}`);
  console.log(`Wrote ${txtPath}`);
  console.log(`Wrote ${path.join(OUT_DIR, 'guess_bin_sizes_preview.txt')}`);
}

main();
