/**
 * From sheet1_daily_lines.csv: count distinct employees per canonical job (same rules as rollups).
 * Trusted = >= MIN_CONTRIBUTORS distinct employees AND not __UNALLOCATED__ (unallocated is tracked separately).
 *
 * Writes per year:
 *   sheet1_jobs_with_trust.csv — canonical job, total hours (from sheet1_totals_by_job), contributors, trusted yes/no
 *   jobs_trusted_*_contributors.csv — detailed contributor breakdown (trusted column excludes unallocated)
 *
 * Usage: node job-trust-by-contributors.js
 * Env: MIN_CONTRIBUTORS=5 (default 5)
 */
const fs = require('fs');
const path = require('path');
const TS = require('./process-timesheets.js');

const { splitJobTokens, canonicalJobId } = TS;

const MIN = Math.max(1, parseInt(process.env.MIN_CONTRIBUTORS || '5', 10) || 5);

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

function trustedFlag(contributorCount, canonicalId) {
  if (canonicalId === '__UNALLOCATED__') return 'no';
  return contributorCount >= MIN ? 'yes' : 'no';
}

function readTotalsByJob(outDir, year) {
  const p = path.join(outDir, `year_${year}`, 'sheet1_totals_by_job.csv');
  if (!fs.existsSync(p)) return null;
  const map = new Map();
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(',');
    if (idx === -1) continue;
    const cid = line.slice(0, idx);
    const hrs = parseFloat(line.slice(idx + 1));
    if (!Number.isNaN(hrs)) map.set(cid, hrs);
  }
  return map;
}

function processYear(outDir, year) {
  const dailyPath = path.join(outDir, `year_${year}`, 'sheet1_daily_lines.csv');
  if (!fs.existsSync(dailyPath)) {
    console.warn(`Skip ${year}: missing ${dailyPath}`);
    return null;
  }

  const totalsMap = readTotalsByJob(outDir, year);
  if (!totalsMap) {
    console.warn(`Skip ${year}: missing sheet1_totals_by_job.csv — run npm run process first`);
    return null;
  }

  /** canonicalId -> { employees: Set } */
  const byJob = new Map();

  const lines = fs.readFileSync(dailyPath, 'utf8').trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = parseCsvLine(line);
    if (parts.length < 7) continue;
    const employee = parts[2];
    const jobRaw = parts[4];
    const hours = parseFloat(parts[6]);
    if (!employee || Number.isNaN(hours)) continue;

    const tokens = splitJobTokens(jobRaw);
    const share = hours / tokens.length;
    for (const tok of tokens) {
      const cid = canonicalJobId(tok);
      if (!byJob.has(cid)) byJob.set(cid, { employees: new Set(), hoursSplit: 0 });
      const o = byJob.get(cid);
      o.employees.add(employee.trim());
      o.hoursSplit += share;
    }
  }

  const rows = [];
  for (const [cid, o] of byJob) {
    const n = o.employees.size;
    rows.push({
      canonical_job_id: cid,
      contributor_count: n,
      contributors: [...o.employees].sort().join('; '),
      hours_from_daily_split: o.hoursSplit,
      trusted: trustedFlag(n, cid),
    });
  }

  rows.sort((a, b) => b.contributor_count - a.contributor_count || b.hours_from_daily_split - a.hours_from_daily_split);

  const trustedCount = rows.filter((r) => r.trusted === 'yes').length;

  const sub = path.join(outDir, `year_${year}`);
  fs.mkdirSync(sub, { recursive: true });

  const hdrDetail = [
    'canonical_job_id',
    'contributor_count',
    'contributors_semicolon_separated',
    'total_hours_split_like_rollups',
    `trusted_ge_${MIN}_contributors_excl_unallocated`,
  ];
  const detailRows = rows.map((r) =>
    [
      r.canonical_job_id,
      r.contributor_count,
      `"${r.contributors.replace(/"/g, '""')}"`,
      r.hours_from_daily_split.toFixed(4),
      r.trusted,
    ].join(',')
  );

  const detailPath = path.join(sub, `jobs_trusted_${MIN}plus_contributors.csv`);
  fs.writeFileSync(detailPath, [hdrDetail.join(','), ...detailRows].join('\n'), 'utf8');

  /** Final handoff file: hours from official rollup + trusted flag */
  const hdrFinal = [
    'canonical_job_id',
    'total_hours_sheet1',
    'contributor_count',
    'contributors_semicolon_separated',
    'trusted',
  ];
  const finalRows = [];
  const seen = new Set();
  for (const [cid, hrs] of [...totalsMap.entries()].sort((a, b) => b[1] - a[1])) {
    seen.add(cid);
    const o = byJob.get(cid);
    const n = o ? o.employees.size : 0;
    const contrib = o ? [...o.employees].sort().join('; ') : '';
    finalRows.push(
      [
        cid,
        hrs.toFixed(4),
        n,
        `"${contrib.replace(/"/g, '""')}"`,
        trustedFlag(n, cid),
      ].join(',')
    );
  }
  for (const [cid, o] of byJob) {
    if (seen.has(cid)) continue;
    const cstr = [...o.employees].sort().join('; ');
    finalRows.push(
      [
        cid,
        o.hoursSplit.toFixed(4),
        o.employees.size,
        `"${cstr.replace(/"/g, '""')}"`,
        trustedFlag(o.employees.size, cid),
      ].join(',')
    );
  }

  const finalPath = path.join(sub, 'sheet1_jobs_with_trust.csv');
  fs.writeFileSync(finalPath, [hdrFinal.join(','), ...finalRows].join('\n'), 'utf8');

  console.log(
    `${year}: sheet1_jobs_with_trust.csv (${finalRows.length} jobs, ${trustedCount} trusted excl. __UNALLOCATED__)`
  );

  return { year, trustedCount, finalPath, detailPath, rows };
}

function main() {
  const dir = __dirname;
  const outDir = path.join(dir, 'output');
  const years = fs
    .readdirSync(outDir)
    .filter((n) => /^year_\d{4}$/.test(n))
    .map((n) => parseInt(n.replace('year_', ''), 10))
    .sort((a, b) => a - b);

  const summary = [];
  summary.push(`Minimum contributors for trusted (excluding __UNALLOCATED__): ${MIN}`);
  summary.push(
    `Trusted = contributor_count >= ${MIN} and canonical_job_id is not __UNALLOCATED__.`
  );
  summary.push('');

  for (const y of years) {
    const r = processYear(outDir, y);
    if (!r) continue;
    summary.push(`--- Year ${y} ---`);
    summary.push(`Trusted jobs (excl. unallocated): ${r.trustedCount}`);
    summary.push(`Primary file: year_${y}/sheet1_jobs_with_trust.csv`);
    summary.push('');
  }

  const sumPath = path.join(outDir, `jobs_trusted_${MIN}plus_summary.txt`);
  fs.writeFileSync(sumPath, summary.join('\n'), 'utf8');
  console.log(`\nSummary: ${sumPath}`);
}

main();
