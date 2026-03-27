/**
 * Run the full repair + rollup pipeline, merge per-year Sheet1 dailies into one master CSV,
 * and write a remainder report for manual review (true blanks, odd symbols, cross-fill leftovers).
 *
 * Order matches fix-all: Sheet2 stub → Joel/Brad → partial cross-fill → Job# sync → process → audit.
 *
 * Usage: node assemble-all.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TS = require('./process-timesheets.js');

const dir = __dirname;

const PIPELINE = [
  'add-missing-sheet2.js',
  'fix-sheet1-blanks.js',
  'fix-sheet1-partial-crossfill.js',
  'sync-sheet1-rollup-key.js',
  'process-timesheets.js',
  'job-trust-by-contributors.js',
];

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function escCsv(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function suspiciousNote(jobRaw, customer) {
  const j = String(jobRaw || '');
  const c = String(customer || '');
  const s = `${j}\n${c}`;
  const notes = [];
  if (/[\u201c\u201d\u2018\u2019""]/.test(s)) notes.push('curly_or_smart_quotes');
  if (/\?\s*$/.test(j.trim()) || /^\?+$/.test(j.trim()) || /^\?+$/.test(c.trim())) notes.push('question_mark');
  if (s.replace(/\s/g, '').length >= 40 && /\s/.test(s)) notes.push('long_phrase_check_typos');
  if (/[^\x00-\x7F]/.test(s) && !/[\u201c\u201d\u2018\u2019]/.test(s)) notes.push('non_ascii');
  return notes.join(';');
}

function mergeDailyLines(outDir) {
  const yearDirs = fs
    .readdirSync(outDir)
    .filter((n) => /^year_\d{4}$/.test(n))
    .map((n) => parseInt(n.replace('year_', ''), 10))
    .sort((a, b) => a - b);

  const mergedPath = path.join(outDir, 'assembled_sheet1_daily_all_years.csv');
  const outLines = [];
  let header = null;
  let n = 0;
  for (const y of yearDirs) {
    const p = path.join(outDir, `year_${y}`, 'sheet1_daily_lines.csv');
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
    if (!lines.length) continue;
    if (!header) {
      header = lines[0];
      outLines.push(header);
    }
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      outLines.push(lines[i]);
      n++;
    }
  }
  fs.writeFileSync(mergedPath, outLines.join('\n'), 'utf8');
  console.log(`\nWrote ${mergedPath} (${n} data rows across ${yearDirs.length} year folder(s))`);
}

function writeRemainderReview() {
  const outDir = path.join(dir, 'output');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));
  const years = [...new Set(files.map((f) => TS.deriveYearFromFilename(f)))].sort((a, b) => a - b);
  const { denseRows, forEachSheet1DayRow, isInBuildingSeason } = TS;

  const reviewPath = path.join(outDir, 'remainder_for_review.csv');
  const lines = [
    'category,file,year,excel_row,date,job_raw,customer,hours,in_building_season,notes',
  ];

  for (const y of years) {
    for (const f of files) {
      if (TS.deriveYearFromFilename(f) !== y) continue;
      const fp = path.join(dir, f);
      const wb = XLSX.readFile(fp, { cellDates: false });
      const sname = sheet1Name(wb);
      const sheet = wb.Sheets[sname];
      if (!sheet || !sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rows = denseRows(sheet);

      forEachSheet1DayRow(rows, y, (ctx) => {
        const work = (ctx.hours != null && ctx.hours > 0) || ctx.hasStart;
        if (!work) return;
        const j = String(ctx.jobRaw || '').trim();
        const c = String(ctx.customer || '').trim();
        const inSeas = isInBuildingSeason(ctx.dateKey);
        const excelRow = range.s.r + ctx.ri + 1;
        const h = ctx.hours != null ? ctx.hours : '';

        if (!j && !c) {
          lines.push(
            [
              inSeas ? 'both_blank_building_season' : 'both_blank_off_season',
              escCsv(f),
              y,
              excelRow,
              ctx.dateKey,
              escCsv(''),
              escCsv(''),
              h,
              inSeas ? 'yes' : 'no',
              escCsv('no job or customer on work row'),
            ].join(',')
          );
          return;
        }

        const note = suspiciousNote(j, c);
        if (note) {
          lines.push(
            [
              'suspicious_symbols_or_spelling_hint',
              escCsv(f),
              y,
              excelRow,
              ctx.dateKey,
              escCsv(j),
              escCsv(c),
              h,
              inSeas ? 'yes' : 'no',
              escCsv(note),
            ].join(',')
          );
        }
      });
    }
  }

  const unPath = path.join(outDir, 'partial_crossfill_unresolved.csv');
  if (fs.existsSync(unPath)) {
    const unLines = fs.readFileSync(unPath, 'utf8').trim().split(/\r?\n/);
    for (let i = 1; i < unLines.length; i++) {
      if (!unLines[i].trim()) continue;
      lines.push(
        [
          'partial_crossfill_unresolved_line',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          escCsv(unLines[i]),
        ].join(',')
      );
    }
    fs.copyFileSync(unPath, path.join(outDir, 'remainder_partial_crossfill_unresolved_copy.csv'));
  }

  fs.writeFileSync(reviewPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${reviewPath}`);
  console.log(`Wrote ${path.join(outDir, 'remainder_partial_crossfill_unresolved_copy.csv')} (snapshot)`);
}

function main() {
  for (const script of PIPELINE) {
    console.log(`\n=== node ${script} ===\n`);
    execSync(`node ${script}`, { cwd: dir, stdio: 'inherit', shell: true });
  }

  const outDir = path.join(dir, 'output');
  mergeDailyLines(outDir);
  writeRemainderReview();

  console.log('\n=== node audit-workbook-sheets.js ===\n');
  execSync('node audit-workbook-sheets.js', { cwd: dir, stdio: 'inherit', shell: true });
  console.log('\n=== node count-blanks.js ===\n');
  execSync('node count-blanks.js', { cwd: dir, stdio: 'inherit', shell: true });

  const readme = path.join(outDir, 'ASSEMBLED_DATA_README.txt');
  fs.writeFileSync(
    readme,
    [
      'Assembled outputs from npm run assemble',
      '',
      'assembled_sheet1_daily_all_years.csv — all employees / dates / job_raw / customer / hours (Node rollups use job OR customer).',
      'output/year_YYYY/ — per-year sheet1_daily_lines, sheet1_totals_by_job, sheet2, audit.',
      'remainder_for_review.csv — browsable gaps and hints:',
      '  both_blank_* — no allocation text on a work row',
      '  suspicious_* — quotes, ?, long tokens, non-ASCII (check for typos / hidden characters)',
      '  partial_crossfill_unresolved_line — full CSV line from partial cross-fill (column notes); snapshot copy: remainder_partial_crossfill_unresolved_copy.csv',
      '',
      'Excel Sheet2 still keys off Sheet1 column C; sync-sheet1-rollup-key copies Customer→Job# when C was empty so formulas can sum those hours.',
      '',
      'Human-readable review: OUTPUT_REVIEW_GUIDE.md',
      'Integration / analysis handoff: docs/ANALYSIS_PIPELINE_HANDOFF.txt',
      '',
    ].join('\n'),
    'utf8'
  );
  console.log(`\nWrote ${readme}`);
  console.log('\nAssemble complete.');
}

main();
