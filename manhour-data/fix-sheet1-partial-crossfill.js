/**
 * For Sheet1 rows in building season with work: if Job# XOR Customer is filled,
 * copy the missing field from another employee's row on the same date where both match
 * (numeric job, synonym/alias, or fuzzy typo). Optionally correct known typos in cells.
 *
 * If no same-day full pair: mirror the lone field into both columns (customer preferred if it is
 * the only value filled), then typo-fix. Remaining failures go to partial_crossfill_unresolved.csv.
 *
 * Usage: node fix-sheet1-partial-crossfill.js
 *        node fix-sheet1-partial-crossfill.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TS = require('./process-timesheets.js');
const A = require('./lib/aliases.js');

const {
  deriveYearFromFilename,
  denseRows,
  forEachSheet1DayRow,
  isInBuildingSeason,
} = TS;

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function filePriority(name) {
  const b = name.toLowerCase();
  if (/^joel/.test(b)) return 0;
  if (/bradley|^brad\b/.test(b)) return 1;
  if (/\bdan\s*m\b/.test(b)) return 2;
  return 10;
}

function sortCandidates(arr) {
  return [...arr].sort((a, b) => {
    const pa = filePriority(a.file);
    const pb = filePriority(b.file);
    if (pa !== pb) return pa - pb;
    return a.file.localeCompare(b.file);
  });
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}

function fuzzyEntitiesMatch(a, b) {
  if (A.entitiesMatch(a, b)) return true;
  const na = A.normalize(a);
  const nb = A.normalize(b);
  if (na.length < 4 || nb.length < 4) return false;
  return levenshtein(na, nb) <= 2;
}

/** Ontario public holiday calendar dates (yyyy-mm-dd); extend when adding new years. */
const ONTARIO_STAT_DATE_KEYS = new Set([
  '2023-01-01',
  '2023-02-20',
  '2023-04-07',
  '2023-05-22',
  '2023-07-01',
  '2023-08-07',
  '2023-09-04',
  '2023-10-09',
  '2023-12-25',
  '2023-12-26',
  '2024-01-01',
  '2024-02-19',
  '2024-03-29',
  '2024-05-20',
  '2024-07-01',
  '2024-08-05',
  '2024-09-02',
  '2024-10-14',
  '2024-12-25',
  '2024-12-26',
  '2025-01-01',
  '2025-02-17',
  '2025-04-18',
  '2025-05-19',
  '2025-07-01',
  '2025-08-04',
  '2025-09-01',
  '2025-10-13',
  '2025-12-25',
  '2025-12-26',
]);

function mirrorAndTypoFix(jobRaw, customer, preferCustomer) {
  const hasJ = !!String(jobRaw || '').trim();
  const hasC = !!String(customer || '').trim();
  let base;
  if (hasC && !hasJ) base = String(customer).trim();
  else if (hasJ && !hasC) base = String(jobRaw).trim();
  else if (hasC && hasJ) base = preferCustomer ? String(customer).trim() : String(jobRaw).trim();
  else return null;
  let v = base;
  v = A.maybeCorrectTypo(v, 'job').value;
  v = A.maybeCorrectTypo(v, 'customer').value;
  return { jobAfter: v, custAfter: v };
}

function findFillFromCandidates(hasJ, hasC, jobPart, custPart, candidates) {
  const sorted = sortCandidates(candidates);
  for (const c of sorted) {
    const cj = String(c.jobRaw || '').trim();
    const cc = String(c.customer || '').trim();
    if (!cj || !cc) continue;

    if (hasJ && !hasC) {
      const numsP = A.extractJobNumbers(jobPart);
      const numsC = A.extractJobNumbers(cj);
      if (numsP.length && numsC.length && numsP.some((x) => numsC.includes(x))) {
        return { job: jobPart, customer: cc, source: c.file, how: 'job#' };
      }
      if (fuzzyEntitiesMatch(jobPart, cj)) {
        return { job: jobPart, customer: cc, source: c.file, how: 'job_text' };
      }
      if (fuzzyEntitiesMatch(jobPart, cc)) {
        return { job: jobPart, customer: cc, source: c.file, how: 'job_vs_customer_col' };
      }
    }

    if (!hasJ && hasC) {
      if (fuzzyEntitiesMatch(custPart, cc)) {
        return { job: cj, customer: custPart, source: c.file, how: 'customer' };
      }
      if (fuzzyEntitiesMatch(custPart, cj)) {
        return { job: cj, customer: custPart, source: c.file, how: 'cross_field' };
      }
    }
  }
  return null;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));
  const years = [...new Set(files.map((f) => deriveYearFromFilename(f)))].sort((a, b) => a - b);

  const backupDir = path.join(dir, 'backup_before_partial_crossfill');
  const unresolved = [
    'file,year,excel_row,date,job,customer,reason',
  ];
  const logLines = [
    'file,year,excel_row,date,field_filled,job_before,customer_before,job_after,customer_after,source_file,how',
  ];

  if (!dryRun) fs.mkdirSync(backupDir, { recursive: true });

  /**
   * Omit from unresolved CSV: Pete; Shop/OFF; stat (ST job); Ontario stat holiday date;
   * job# with Customer blank (single entry is acceptable).
   */
  const excludeFromUnresolvedReport = (fn, jobRaw, customer, dateKey) => {
    if (/^pete /i.test(fn)) return true;
    const j = String(jobRaw || '').trim();
    const c = String(customer || '').trim();
    if (j && !c) return true;
    if (!j && c) return true;
    if (/^shop$/i.test(j) || /^shop$/i.test(c)) return true;
    if (/^off$/i.test(j) || /^off$/i.test(c)) return true;
    if (/^st$/i.test(j) || /^st$/i.test(c)) return true;
    if (dateKey && ONTARIO_STAT_DATE_KEYS.has(dateKey)) return true;
    return false;
  };

  for (const y of years) {
    const pairsByDate = {};

    for (const f of files) {
      if (deriveYearFromFilename(f) !== y) continue;
      const fp = path.join(dir, f);
      const wb = XLSX.readFile(fp, { cellDates: false });
      const sheet = wb.Sheets[sheet1Name(wb)];
      if (!sheet || !sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rows = denseRows(sheet);

      forEachSheet1DayRow(rows, y, (ctx) => {
        if (!isInBuildingSeason(ctx.dateKey)) return;
        const j = String(ctx.jobRaw || '').trim();
        const c = String(ctx.customer || '').trim();
        if (j && c) {
          if (!pairsByDate[ctx.dateKey]) pairsByDate[ctx.dateKey] = [];
          pairsByDate[ctx.dateKey].push({
            file: f,
            absR: range.s.r + ctx.ri,
            jobRaw: ctx.jobRaw,
            customer: ctx.customer,
          });
        }
      });
    }

    for (const f of files) {
      if (deriveYearFromFilename(f) !== y) continue;
      const fp = path.join(dir, f);
      const wb = XLSX.readFile(fp, { cellDates: false });
      const sname = sheet1Name(wb);
      const sheet = wb.Sheets[sname];
      if (!sheet || !sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rows = denseRows(sheet);

      let changeCount = 0;

      forEachSheet1DayRow(rows, y, (ctx) => {
        if (!isInBuildingSeason(ctx.dateKey)) return;
        const hasJ = !!String(ctx.jobRaw || '').trim();
        const hasC = !!String(ctx.customer || '').trim();
        const work = (ctx.hours != null && ctx.hours > 0) || ctx.hasStart;
        if (!work) return;

        if (hasJ && hasC) {
          const tj = A.maybeCorrectTypo(ctx.jobRaw, 'job');
          const tc = A.maybeCorrectTypo(ctx.customer, 'customer');
          if (tj.changed || tc.changed) {
            const absR = range.s.r + ctx.ri;
            if (!dryRun) {
              if (tj.changed) setCell(sheet, absR, ctx.jobCol, tj.value);
              if (tc.changed) setCell(sheet, absR, ctx.custCol, tc.value);
            }
            changeCount++;
            logLines.push(
              [
                f,
                y,
                absR + 1,
                ctx.dateKey,
                'typo',
                `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
                `"${String(ctx.customer).replace(/"/g, '""')}"`,
                `"${String(tj.value).replace(/"/g, '""')}"`,
                `"${String(tc.value).replace(/"/g, '""')}"`,
                '',
                'typo_fix',
              ].join(',')
            );
          }
          return;
        }

        if (!hasJ && !hasC) return;

        const absR = range.s.r + ctx.ri;
        let jobPart = ctx.jobRaw;
        let custPart = ctx.customer;

        if (hasC && !hasJ) {
          const tc = A.maybeCorrectTypo(custPart, 'customer');
          if (tc.changed) {
            if (!dryRun) setCell(sheet, absR, ctx.custCol, tc.value);
            custPart = tc.value;
            changeCount++;
            logLines.push(
              [
                f,
                y,
                absR + 1,
                ctx.dateKey,
                'typo',
                `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
                `"${String(ctx.customer).replace(/"/g, '""')}"`,
                `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
                `"${String(tc.value).replace(/"/g, '""')}"`,
                '',
                'typo_customer_only',
              ].join(',')
            );
          }
        }
        if (hasJ && !hasC) {
          const tj = A.maybeCorrectTypo(jobPart, 'job');
          if (tj.changed) {
            if (!dryRun) setCell(sheet, absR, ctx.jobCol, tj.value);
            jobPart = tj.value;
            changeCount++;
            logLines.push(
              [
                f,
                y,
                absR + 1,
                ctx.dateKey,
                'typo',
                `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
                `"${String(ctx.customer).replace(/"/g, '""')}"`,
                `"${String(tj.value).replace(/"/g, '""')}"`,
                `"${String(ctx.customer).replace(/"/g, '""')}"`,
                '',
                'typo_job_only',
              ].join(',')
            );
          }
        }

        const hasJNow = !!String(jobPart || '').trim();
        const hasCNow = !!String(custPart || '').trim();
        if (hasJNow && hasCNow) return;
        if (!hasJNow && !hasCNow) return;

        const pool = (pairsByDate[ctx.dateKey] || []).filter(
          (p) => !(p.file === f && p.absR === absR)
        );

        if (!pool.length) {
          if (hasJNow && !hasCNow) return;

          const mirrored = mirrorAndTypoFix(jobPart, custPart, true);
          if (!mirrored) {
            if (!excludeFromUnresolvedReport(f, jobPart, custPart, ctx.dateKey)) {
              unresolved.push(
                `${f},${y},${absR + 1},${ctx.dateKey},"${String(jobPart).replace(/"/g, '""')}","${String(
                  custPart
                ).replace(/"/g, '""')}",no_pairs_mirror_empty`
              );
            }
            return;
          }
          const { jobAfter, custAfter } = mirrored;
          const how = 'no_pairs_mirror_from_customer';
          if (!dryRun) {
            setCell(sheet, absR, ctx.jobCol, jobAfter);
            setCell(sheet, absR, ctx.custCol, custAfter);
          }
          changeCount++;
          logLines.push(
            [
              f,
              y,
              absR + 1,
              ctx.dateKey,
              'customer',
              `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
              `"${String(ctx.customer).replace(/"/g, '""')}"`,
              `"${String(jobAfter).replace(/"/g, '""')}"`,
              `"${String(custAfter).replace(/"/g, '""')}"`,
              '',
              how,
            ].join(',')
          );
          return;
        }

        const fill = findFillFromCandidates(
          hasJNow,
          hasCNow,
          jobPart,
          custPart,
          pool
        );

        if (!fill) {
          if (!excludeFromUnresolvedReport(f, jobPart, custPart, ctx.dateKey)) {
            unresolved.push(
              `${f},${y},${absR + 1},${ctx.dateKey},"${String(jobPart).replace(/"/g, '""')}","${String(
                custPart
              ).replace(/"/g, '""')}",no_alias_or_job_match`
            );
          }
          return;
        }

        let jobAfter = String(fill.job).trim();
        let custAfter = String(fill.customer).trim();
        jobAfter = A.maybeCorrectTypo(jobAfter, 'job').value;
        custAfter = A.maybeCorrectTypo(custAfter, 'customer').value;

        if (!dryRun) {
          setCell(sheet, absR, ctx.jobCol, jobAfter);
          setCell(sheet, absR, ctx.custCol, custAfter);
        }
        changeCount++;
        logLines.push(
          [
            f,
            y,
            absR + 1,
            ctx.dateKey,
            hasJNow ? 'customer' : 'job',
            `"${String(ctx.jobRaw).replace(/"/g, '""')}"`,
            `"${String(ctx.customer).replace(/"/g, '""')}"`,
            `"${String(jobAfter).replace(/"/g, '""')}"`,
            `"${String(custAfter).replace(/"/g, '""')}"`,
            fill.source,
            fill.how,
          ].join(',')
        );
      });

      if (changeCount > 0 && !dryRun) {
        fs.copyFileSync(fp, path.join(backupDir, f));
        XLSX.writeFile(wb, fp, { bookType: 'xlsx', compression: true });
        console.log(`Updated ${f} (${changeCount} change(s))`);
      } else if (changeCount > 0 && dryRun) {
        console.log(`[dry-run] ${f}: ${changeCount} change(s)`);
      }
    }
  }

  const outDir = path.join(dir, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'partial_crossfill_log.csv'), logLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'partial_crossfill_unresolved.csv'), unresolved.join('\n'), 'utf8');
  console.log(`\nLog: ${path.join(outDir, 'partial_crossfill_log.csv')}`);
  console.log(`Unresolved: ${path.join(outDir, 'partial_crossfill_unresolved.csv')}`);
  if (dryRun) console.log('Dry run — no files modified.');
  else if (unresolved.length > 1) console.log(`Backups: ${backupDir}`);
}

function setCell(sheet, r0, c0, value) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  if (value == null || String(value) === '') {
    delete sheet[addr];
    return;
  }
  sheet[addr] = { t: 's', v: String(value) };
}

main();
