/**
 * Count Sheet1 rows with blank Job# + Customer but work present.
 * Also counts XOR partials (only Job# or only Customer) for building vs off-season.
 * "Important" blanks = building season only (Apr 15 – Dec 10). Off-season blanks are non-billable for metrics.
 * Of important blanks, how many could be filled from Joel/Brad for that date.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TS = require('./process-timesheets.js');

const {
  deriveYearFromFilename,
  denseRows,
  forEachSheet1DayRow,
  parseSheet1Daily,
  buildImputeMap,
  findJoelFileForYear,
  findBradFileForYear,
  isInBuildingSeason,
} = TS;

const SEASON_RULE = 'Apr 15 – Dec 10 (inclusive)';

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function pickRef(dateKey, targetFile, joelF, bradF, joelByDate, bradByDate) {
  const has = (o) =>
    o && (String(o.jobRaw || '').trim() || String(o.customer || '').trim());
  if (targetFile === joelF) {
    const b = bradByDate[dateKey];
    if (has(b)) return true;
    return false;
  }
  if (targetFile === bradF) {
    const j = joelByDate[dateKey];
    if (has(j)) return true;
    return false;
  }
  if (has(joelByDate[dateKey])) return true;
  if (has(bradByDate[dateKey])) return true;
  return false;
}

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));
const years = [...new Set(files.map((f) => deriveYearFromFilename(f)))].sort((a, b) => a - b);

let seasonBlanks = 0;
let seasonFixable = 0;
let seasonUnfixable = 0;
let offSeasonBlanks = 0;
let seasonPartialXor = 0;
let offSeasonPartialXor = 0;
const byFile = [];

for (const y of years) {
  const joelF = findJoelFileForYear(files, y);
  const bradF = findBradFileForYear(files, y);

  let joelByDate = {};
  let bradByDate = {};

  if (joelF) {
    const wb = XLSX.readFile(path.join(dir, joelF), { cellDates: false });
    const sh = wb.Sheets[sheet1Name(wb)];
    const { daily } = parseSheet1Daily(sh, denseRows(sh), joelF, {
      year: y,
      employeeLabel: 'Joel',
      skipSecondPass: true,
      imputeMapDan: null,
      imputeMapJoel: null,
    });
    joelByDate = buildImputeMap(daily);
  }
  if (bradF) {
    const wb = XLSX.readFile(path.join(dir, bradF), { cellDates: false });
    const sh = wb.Sheets[sheet1Name(wb)];
    const { daily } = parseSheet1Daily(sh, denseRows(sh), bradF, {
      year: y,
      employeeLabel: 'Brad',
      skipSecondPass: true,
      imputeMapDan: null,
      imputeMapJoel: null,
    });
    bradByDate = buildImputeMap(daily);
  }

  for (const f of files) {
    if (deriveYearFromFilename(f) !== y) continue;
    const fp = path.join(dir, f);
    const wb = XLSX.readFile(fp, { cellDates: false });
    const sheet = wb.Sheets[sheet1Name(wb)];
    if (!sheet || !sheet['!ref']) continue;
    const rows = denseRows(sheet);

    let sb = 0,
      sfx = 0,
      su = 0,
      ob = 0,
      spx = 0,
      ospx = 0;
    forEachSheet1DayRow(rows, y, (ctx) => {
      const hasJ = !!String(ctx.jobRaw || '').trim();
      const hasC = !!String(ctx.customer || '').trim();
      const work = (ctx.hours != null && ctx.hours > 0) || ctx.hasStart;
      if (!work) return;

      if (hasJ !== hasC) {
        if (isInBuildingSeason(ctx.dateKey)) spx++;
        else ospx++;
        return;
      }

      const missing = !hasJ && !hasC;
      if (!missing) return;

      if (!isInBuildingSeason(ctx.dateKey)) {
        ob++;
        return;
      }

      sb++;
      if (pickRef(ctx.dateKey, f, joelF, bradF, joelByDate, bradByDate)) sfx++;
      else su++;
    });
    if (sb > 0 || ob > 0 || spx > 0 || ospx > 0) {
      byFile.push({
        f,
        y,
        buildingSeasonBlanks: sb,
        buildingSeasonFixable: sfx,
        buildingSeasonUnfixable: su,
        offSeasonBlanksIgnored: ob,
        buildingSeasonPartialXor: spx,
        offSeasonPartialXor: ospx,
      });
    }
    seasonBlanks += sb;
    seasonFixable += sfx;
    seasonUnfixable += su;
    offSeasonBlanks += ob;
    seasonPartialXor += spx;
    offSeasonPartialXor += ospx;
  }
}

const fixedLog = path.join(dir, 'output', 'sheet1_job_fill_log.csv');
let fixedCount = 0;
if (fs.existsSync(fixedLog)) {
  const lines = fs.readFileSync(fixedLog, 'utf8').trim().split(/\r?\n/);
  fixedCount = Math.max(0, lines.length - 1);
}

const out = {
  rule: SEASON_RULE,
  buildingSeason: {
    blanks: seasonBlanks,
    fixableFromJoelOrBrad: seasonFixable,
    stillNeedManualOrOtherSource: seasonUnfixable,
  },
  offSeason: {
    blanksIgnored: offSeasonBlanks,
    note: 'Not counted toward billable / Sheet2 quality gaps',
  },
  partialXor: {
    note: 'Work row with only Job# or only Customer (not both empty)',
    buildingSeason: seasonPartialXor,
    offSeason: offSeasonPartialXor,
  },
  sheet1JobFillLogRows: fixedCount,
  byFile,
};

const reportPath = path.join(dir, 'output', 'building_season_blank_report.txt');
const txt = [
  `Building season: ${SEASON_RULE}`,
  '',
  'Blanks (work row, no Job# and no Customer):',
  `  During building season (matters for billable data): ${seasonBlanks}`,
  `    - fixable from Joel/Brad same day: ${seasonFixable}`,
  `    - need manual / other source: ${seasonUnfixable}`,
  `  Off-season (ignored for metrics): ${offSeasonBlanks}`,
  '',
  `Partial XOR (only Job# or only Customer, work row):`,
  `  Building season: ${seasonPartialXor}`,
  `  Off-season: ${offSeasonPartialXor}`,
  '',
  `Rows logged in sheet1_job_fill_log.csv (historical): ${fixedCount}`,
  '',
  'Per file: see JSON from: npm run count-blanks',
].join('\n');

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, txt, 'utf8');

console.log(JSON.stringify(out, null, 2));
console.log('\n' + reportPath);
