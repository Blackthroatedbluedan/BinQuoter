/**
 * Timesheet consolidation: Sheet2 rollup + Sheet1 audit with Dan → Joel imputation.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const MONTH_ALIASES = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function monthIndex(name) {
  if (!name) return null;
  const k = String(name).toLowerCase().replace(/\./g, '').trim();
  return MONTH_ALIASES[k] != null ? MONTH_ALIASES[k] : null;
}

/** First 20xx year in filename, else defaultYear (spreadsheet calendar year). */
function deriveYearFromFilename(filename, defaultYear = 2024) {
  const m = String(filename).match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : defaultYear;
}

function findDanFileForYear(files, y) {
  return files.find((f) => /\bDan\s+m\b/i.test(f) && deriveYearFromFilename(f) === y);
}

function findJoelFileForYear(files, y) {
  return files.find((f) => /^joel/i.test(f.trim()) && deriveYearFromFilename(f) === y);
}

function findBradFileForYear(files, y) {
  return files.find(
    (f) => /bradley|^brad\b/i.test(f.replace(/\.xlsx$/i, '').trim()) && deriveYearFromFilename(f) === y
  );
}

/**
 * Building season for job-allocation / blank metrics: Apr 15 through Dec 10 (inclusive).
 * Dates outside this range are treated as off-season (non-billable / unimportant for blank counts).
 */
function isInBuildingSeason(dateKey) {
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 4) return false;
  if (mo === 4) return d >= 15;
  if (mo >= 5 && mo <= 11) return true;
  if (mo === 12) return d <= 10;
  return false;
}

/** Parse week banner to inclusive start/end Date (local). `year` = timesheet calendar year. */
function parseWeekBanner(text, year) {
  if (text == null) return null;
  const raw = String(text).replace(/\u2013/g, '-').trim();
  if (!raw) return null;
  const Y = year;

  function twoMonthRange(m1name, d1, m2name, d2) {
    const m1 = monthIndex(m1name);
    const m2 = monthIndex(m2name);
    if (m1 == null || m2 == null) return null;
    const start = new Date(Y, m1, d1);
    let end = new Date(Y, m2, d2);
    if (end < start) {
      end = new Date(Y + 1, m2, d2);
    }
    return { start, end };
  }

  // "June 30-July 6" (space between first month and day)
  let m = raw.match(
    /^([A-Za-z]+)\s+(\d+)\s*[-]\s*([A-Za-z]+)\s+(\d+)\s*$/i
  );
  if (m) {
    const r = twoMonthRange(m[1], parseInt(m[2], 10), m[3], parseInt(m[4], 10));
    if (r) return r;
  }

  // "Jan 28-Feb 3" (optional space after month names)
  m = raw.match(
    /^([A-Za-z]+)\s*(\d+)\s*[-]\s*([A-Za-z]+)\s*(\d+)\s*$/i
  );
  if (m) {
    const r = twoMonthRange(m[1], parseInt(m[2], 10), m[3], parseInt(m[4], 10));
    if (r) return r;
  }

  // "Jan1-6" or "Jan 1-6" (same month; \s* allows no space after month)
  m = raw.match(/^([A-Za-z]+)\s*(\d+)\s*[-]\s*(\d+)\s*$/i);
  if (m) {
    const mo = monthIndex(m[1]);
    const d1 = parseInt(m[2], 10);
    const d2 = parseInt(m[3], 10);
    if (mo == null) return null;
    const start = new Date(Y, mo, d1);
    const end = new Date(Y, mo, d2);
    return { start, end };
  }

  return null;
}

function extractWeekBannerText(row, year) {
  for (const c of row) {
    const s = c == null ? '' : String(c).trim();
    if (s && /[A-Za-z]{3,}/.test(s) && /[-]/.test(s)) {
      const p = parseWeekBanner(s, year);
      if (p) return s;
    }
  }
  return '';
}

function dateInRangeForDayOfMonth(start, end, dayOfMonth) {
  const d = parseInt(String(dayOfMonth), 10);
  if (!d) return null;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDate() === d) return new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
  return null;
}

function formatLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Excel stores duration-as-time as a fraction of a day (e.g. 10h → ~0.4167).
 * String cells may say "10 hours 30 mins" = 10.5 h. Without this, 0.4167 was read as 0.42 h.
 */
function parseHoursFromNumber(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v === 0) return 0;
  if (v > 0 && v < 1) return v * 24;
  if (v >= 1 && v <= 1000) return v;
  return null;
}

/** Read hours from SheetJS cell (raw value + format); fixes time-fraction bug. */
function parseHoursFromCell(cell) {
  if (!cell) return null;
  const w = cell.w != null ? String(cell.w).trim() : '';
  if (w && !/^#REF!/i.test(w)) {
    const fromW = parseHours(w);
    if (fromW != null) return fromW;
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    const n = parseHoursFromNumber(cell.v);
    if (n != null) return n;
  }
  if (cell.v != null && cell.v !== '') {
    const fromV = parseHours(cell.v);
    if (fromV != null) return fromV;
  }
  return null;
}

function parseHours(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return parseHoursFromNumber(val);
  }
  const s = String(val).trim();
  if (!s || /^#REF!/i.test(s) || /^missed$/i.test(s)) return null;
  if (/^0:00:00$/i.test(s)) return 0;

  /** "10 hours 30 mins" / "10 hours 30 minutes" */
  let textHm = s.match(
    /^(\d+(?:\.\d+)?)\s*hours?\s+(\d+)\s*(?:mins?|minutes?)\.?$/i
  );
  if (textHm) return parseFloat(textHm[1]) + parseFloat(textHm[2]) / 60;
  textHm = s.match(/^(\d+(?:\.\d+)?)\s*hr\.?\s+(\d+)\s*min\.?$/i);
  if (textHm) return parseFloat(textHm[1]) + parseFloat(textHm[2]) / 60;
  textHm = s.match(/^(\d+(?:\.\d+)?)\s*h\s+(\d+)\s*m$/i);
  if (textHm) return parseFloat(textHm[1]) + parseFloat(textHm[2]) / 60;

  const textH = s.match(/^(\d+(?:\.\d+)?)\s*hours?\.?$/i);
  if (textH) return parseFloat(textH[1]);

  /** 10:00:00 or 10:00:00 AM */
  const clock = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (clock) {
    let hh = parseInt(clock[1], 10);
    const mm = parseInt(clock[2], 10);
    const ss = clock[3] != null ? parseInt(clock[3], 10) : 0;
    const ap = clock[4];
    if (ap) {
      const up = ap.toUpperCase();
      if (up === 'PM' && hh < 12) hh += 12;
      if (up === 'AM' && hh === 12) hh = 0;
    }
    return hh + mm / 60 + ss / 3600;
  }

  /** Plain numeric string: decimal hours, or Excel fraction of day (0–1) */
  const num = parseFloat(s.replace(/,/g, ''));
  if (!Number.isNaN(num) && !/:/.test(s) && !/hour|hr\b|min/i.test(s)) {
    if (num > 1000) return null;
    if (num > 0 && num < 1) return num * 24;
    return num;
  }

  return null;
}

function normalizeJobKey(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, ' ');
}

/** Split "6605/6657" or "6653 / 6619" into tokens. */
function splitJobTokens(jobStr) {
  const s = normalizeJobKey(jobStr);
  if (!s || /^n\/?a$/i.test(s) || s === '?') return ['__UNALLOCATED__'];
  const parts = s.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return ['__UNALLOCATED__'];
  return parts;
}

function extractNumericIds(token) {
  const matches = String(token).match(/\d+/g);
  return matches || [];
}

function canonicalJobId(token) {
  const t = normalizeJobKey(token);
  if (/^__UNALLOCATED__$/i.test(t)) return '__UNALLOCATED__';
  const nums = extractNumericIds(t);
  if (nums.length) return nums.join('_');
  const up = t.toUpperCase();
  if (/^SHOP$/i.test(t)) return 'TEXT_SHOP';
  if (!t) return '__UNALLOCATED__';
  return 'TEXT_' + up.replace(/[^A-Z0-9]+/g, '_').slice(0, 40);
}

function denseRows(sheet) {
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) {
        row.push('');
        continue;
      }
      row.push(cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : '');
    }
    rows.push(row);
  }
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i].map((c) => String(c).toLowerCase());
    const joined = r.join('|');
    if (joined.includes('job#') && (joined.includes('total') || joined.includes('start'))) return i;
  }
  return -1;
}

function colIndexFromHeader(headerRow, labels) {
  const lower = headerRow.map((c) => String(c).toLowerCase().trim());
  for (const lab of labels) {
    const idx = lower.findIndex((x) => x === lab || x.startsWith(lab));
    if (idx >= 0) return idx;
  }
  return -1;
}

function employeeNameFromFile(filename) {
  return filename
    .replace(/\.xlsx$/i, '')
    .replace(/\s*(20\d{2})\s*/gi, ' ')
    .replace(/\s*Time\s*Sheet\s*\.?/gi, '')
    .replace(/\s*Timesheet\s*\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** --- Sheet2 --- */
function parseSheet2(wb, fileName, year) {
  const name = wb.SheetNames.find((n) => /^sheet2$/i.test(n)) || wb.SheetNames[1];
  if (!name) return { rows: [], errors: ['No Sheet2'] };
  const sheet = wb.Sheets[name];
  const data = denseRows(sheet);
  const out = [];
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || !row.length) continue;
    const a = row[0];
    const b = row[1];
    const c = row[2];
    const h = parseFloat(String(c).replace(/,/g, ''));
    if (String(a).toLowerCase() === 'job number') continue;
    if (/^sum$/i.test(String(b || '').trim())) continue;
    if (Number.isNaN(h) && String(c).trim() === '') continue;
    if (Number.isNaN(h)) {
      if (String(c).trim()) errors.push(`Sheet2 row ${i + 1}: bad hours "${c}"`);
      continue;
    }

    let jobRaw = a != null && a !== '' ? String(a).trim() : String(b || '').trim();
    if (!jobRaw && h > 0) {
      jobRaw = '__UNALLOCATED__';
    }
    if (!jobRaw) continue;

    const tokens = splitJobTokens(jobRaw);
    const splitHours = h / tokens.length;
    for (const tok of tokens) {
      const cid = canonicalJobId(tok);
      out.push({
        file: fileName,
        year,
        employee: employeeNameFromFile(fileName),
        jobRaw: tok,
        canonicalId: cid,
        hours: splitHours,
      });
    }
  }

  return { rows: out, errors };
}

/**
 * Walk Sheet1 day rows (same week-range rules as parseSheet1Daily).
 * handler return truthy to stop iteration early (optional).
 */
function forEachSheet1DayRow(sheet, rows, year, handler) {
  const hdrIdx = findHeaderRow(rows);
  let jobCol = 2;
  let custCol = 3;
  let startCol = 4;
  /** Default H (0-based 7); Elijah-style layouts often Total in G (6) — header row overrides */
  let totalCol = 7;

  if (hdrIdx >= 0) {
    const hr = rows[hdrIdx];
    const jc = colIndexFromHeader(hr, ['job#']);
    const tc = colIndexFromHeader(hr, ['total hours', 'total hrs', 'total']);
    const sc = colIndexFromHeader(hr, ['start']);
    if (jc >= 0) jobCol = jc;
    if (tc >= 0) totalCol = tc;
    if (sc >= 0) startCol = sc;
    if (jobCol >= 0 && custCol < jobCol + 1) custCol = jobCol + 1;
  }

  let weekRange = null;
  const flags = [];
  const dayLetters = new Set(['S', 'M', 'T', 'W', 'F']);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row) continue;
    const joined = row.join(' ');
    if (/Total hours Week/i.test(joined)) continue;

    const wbText = extractWeekBannerText(row, year);
    if (wbText) {
      const p = parseWeekBanner(wbText, year);
      if (p) {
        weekRange = p;
        continue;
      }
    }

    const d0 = String(row[0] || '').trim();
    const d1 = row[1];

    if (!dayLetters.has(d0) || weekRange == null) continue;

    const dom = parseInt(String(d1), 10);
    if (!dom) continue;

    let dt = dateInRangeForDayOfMonth(weekRange.start, weekRange.end, dom);
    if (!dt) {
      let ns = new Date(weekRange.start);
      ns.setDate(ns.getDate() + 7);
      let ne = new Date(weekRange.end);
      ne.setDate(ne.getDate() + 7);
      dt = dateInRangeForDayOfMonth(ns, ne, dom);
      if (dt) {
        weekRange = { start: ns, end: ne };
      } else {
        ns = new Date(weekRange.start);
        ns.setDate(ns.getDate() + 14);
        ne = new Date(weekRange.end);
        ne.setDate(ne.getDate() + 14);
        dt = dateInRangeForDayOfMonth(ns, ne, dom);
        if (dt) {
          weekRange = { start: ns, end: ne };
        }
      }
    }
    if (!dt) {
      flags.push({ row: ri + 1, msg: `Day ${dom} outside week range` });
      continue;
    }

    const dateKey = formatLocalYmd(dt);

    let jobRaw = normalizeJobKey(row[jobCol]);
    let customer = normalizeJobKey(row[custCol]);
    const startVal = row[startCol];
    const totalCell = row[totalCol];

    let hours = null;
    if (sheet) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: totalCol });
      hours = parseHoursFromCell(sheet[addr]);
    }
    if (hours == null) {
      hours = parseHours(totalCell);
    }

    if (hours != null && hours > 24) {
      continue;
    }

    const hasStart = String(startVal || '').trim() !== '';

    if (hours == null || hours === 0) {
      if (!jobRaw && !customer) continue;
    }

    if (hours == null) hours = 0;

    const jobField = jobRaw || customer;
    if (!jobField && hours === 0) continue;

    const stop = handler({
      ri,
      dateKey,
      jobCol,
      custCol,
      startCol,
      totalCol,
      jobRaw,
      customer,
      hours,
      hasStart,
      dayLetter: d0,
    });
    if (stop) break;
  }

  return { flags };
}

/** --- Sheet1 --- */
function parseSheet1Daily(sheet, rows, fileName, options) {
  const { imputeMapDan, imputeMapJoel, employeeLabel, skipSecondPass } = options;
  const year = options.year != null ? options.year : deriveYearFromFilename(fileName);
  const daily = [];

  const { flags } = forEachSheet1DayRow(sheet, rows, year, (ctx) => {
    const jobField = ctx.jobRaw || ctx.customer;
    daily.push({
      file: fileName,
      year,
      employee: employeeLabel,
      date: ctx.dateKey,
      dayLetter: ctx.dayLetter,
      jobRaw: jobField || '',
      customer: ctx.customer || '',
      hours: ctx.hours,
      imputedFrom: null,
    });
  });

  if (!skipSecondPass) {
    secondPassJobOnly(daily, imputeMapDan, imputeMapJoel, employeeLabel);
  }

  return { daily, flags };
}

/** Fill job/customer from Dan, else Joel, when missing; never changes hours. */
function secondPassJobOnly(daily, imputeMapDan, imputeMapJoel, employeeLabel) {
  if (!imputeMapDan || employeeLabel === 'Dan') return;

  for (const r of daily) {
    const missingJob =
      !String(r.jobRaw || '').trim() && !String(r.customer || '').trim();
    if (!missingJob) continue;

    const dan = imputeMapDan[r.date];
    const joel = imputeMapJoel ? imputeMapJoel[r.date] : null;
    const danHasJob = dan && (String(dan.jobRaw || '').trim() || String(dan.customer || '').trim());
    const joelHasJob =
      joel && (String(joel.jobRaw || '').trim() || String(joel.customer || '').trim());
    const src = danHasJob ? dan : joelHasJob ? joel : null;
    if (!src) continue;

    r.jobRaw = String(src.jobRaw || '').trim() || r.jobRaw;
    r.customer = String(src.customer || '').trim() || r.customer;
    r.imputedFrom = danHasJob ? 'Dan' : 'Joel';
  }
}

function buildImputeMap(dailyRows) {
  const m = {};
  for (const r of dailyRows) {
    if (!r.date) continue;
    const jobRaw = r.jobRaw || r.customer;
    if (!jobRaw) continue;
    m[r.date] = {
      jobRaw,
      customer: r.customer,
      hours: r.hours,
    };
  }
  return m;
}

function aggregateByCanonical(dailyRows) {
  const map = new Map();
  for (const r of dailyRows) {
    const tokens = splitJobTokens(r.jobRaw || r.customer || '');
    const h = r.hours / tokens.length;
    for (const tok of tokens) {
      const cid = canonicalJobId(tok);
      map.set(cid, (map.get(cid) || 0) + h);
    }
  }
  return map;
}

function writeYearCsvs(outSubDir, y, sheet2Rows, sheet1Rows) {
  const sheet2Grand = new Map();
  for (const r of sheet2Rows) {
    sheet2Grand.set(r.canonicalId, (sheet2Grand.get(r.canonicalId) || 0) + r.hours);
  }
  const sheet1Grand = aggregateByCanonical(sheet1Rows);

  const lines2 = ['canonical_job_id,total_hours_sheet2_all_employees'];
  for (const k of [...sheet2Grand.keys()].sort()) {
    lines2.push(`${k},${sheet2Grand.get(k).toFixed(4)}`);
  }
  fs.writeFileSync(path.join(outSubDir, 'sheet2_totals_by_job.csv'), lines2.join('\n'), 'utf8');

  const lines1 = ['canonical_job_id,total_hours_sheet1_all_employees_imputed'];
  for (const k of [...sheet1Grand.keys()].sort()) {
    lines1.push(`${k},${sheet1Grand.get(k).toFixed(4)}`);
  }
  fs.writeFileSync(path.join(outSubDir, 'sheet1_totals_by_job.csv'), lines1.join('\n'), 'utf8');

  const dailyLines = ['year,file,employee,date,job_raw,customer,hours,imputed_from'];
  for (const r of sheet1Rows) {
    dailyLines.push(
      [
        y,
        r.file,
        r.employee,
        r.date,
        `"${String(r.jobRaw).replace(/"/g, '""')}"`,
        `"${String(r.customer).replace(/"/g, '""')}"`,
        r.hours,
        r.imputedFrom || '',
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(outSubDir, 'sheet1_daily_lines.csv'), dailyLines.join('\n'), 'utf8');

  const auditLines = ['employee,canonical_job_id,hours_sheet2,hours_sheet1,delta'];
  const byEmp = new Map();
  for (const r of sheet2Rows) {
    const k = r.employee + '|' + r.canonicalId;
    if (!byEmp.has(k)) byEmp.set(k, { s2: 0 });
    byEmp.get(k).s2 += r.hours;
  }
  const byEmp1 = new Map();
  for (const r of sheet1Rows) {
    const tokens = splitJobTokens(r.jobRaw || r.customer || '');
    const h = r.hours / tokens.length;
    for (const tok of tokens) {
      const cid = canonicalJobId(tok);
      const k = r.employee + '|' + cid;
      byEmp1.set(k, (byEmp1.get(k) || 0) + h);
    }
  }
  const allKeys = new Set([...byEmp.keys(), ...byEmp1.keys()]);
  for (const k of [...allKeys].sort()) {
    const s2 = byEmp.has(k) ? byEmp.get(k).s2 : 0;
    const s1 = byEmp1.get(k) || 0;
    const [emp, cid] = k.split('|');
    auditLines.push(`${emp},${cid},${s2.toFixed(4)},${s1.toFixed(4)},${(s1 - s2).toFixed(4)}`);
  }
  fs.writeFileSync(path.join(outSubDir, 'audit_sheet2_vs_sheet1_by_employee_job.csv'), auditLines.join('\n'), 'utf8');

  return {
    sheet2Grand,
    sheet1Grand,
    sheet2Hours: [...sheet2Grand.values()].reduce((a, b) => a + b, 0),
    sheet1Hours: [...sheet1Grand.values()].reduce((a, b) => a + b, 0),
  };
}

function main() {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));

  const years = [...new Set(files.map((f) => deriveYearFromFilename(f)))].sort((a, b) => a - b);

  const sheet2All = [];
  const sheet2Errors = [];
  for (const f of files) {
    const y = deriveYearFromFilename(f);
    const wb = XLSX.readFile(path.join(dir, f), { cellDates: false });
    const p = parseSheet2(wb, f, y);
    sheet2All.push(...p.rows);
    sheet2Errors.push(...p.errors.map((e) => `${f}: ${e}`));
  }

  const imputeDanByYear = {};
  const imputeJoelByYear = {};
  const foremanFiles = new Set();
  const sheet1ByYear = {};
  for (const y of years) sheet1ByYear[y] = [];

  for (const y of years) {
    const danF = findDanFileForYear(files, y);
    const joelF = findJoelFileForYear(files, y);
    if (danF) foremanFiles.add(danF);
    if (joelF) foremanFiles.add(joelF);

    if (danF) {
      const wbDan = XLSX.readFile(path.join(dir, danF), { cellDates: false });
      const shDan = wbDan.Sheets[wbDan.SheetNames[0]];
      const danDaily = parseSheet1Daily(shDan, denseRows(shDan), danF, {
        year: y,
        imputeMapDan: null,
        imputeMapJoel: null,
        employeeLabel: 'Dan',
      }).daily;
      imputeDanByYear[y] = buildImputeMap(danDaily);
      sheet1ByYear[y].push(...danDaily);
    }

    if (joelF) {
      const wbJoel = XLSX.readFile(path.join(dir, joelF), { cellDates: false });
      const shJoel = wbJoel.Sheets[wbJoel.SheetNames[0]];
      const joelDailyRaw = parseSheet1Daily(shJoel, denseRows(shJoel), joelF, {
        year: y,
        imputeMapDan: imputeDanByYear[y] || null,
        imputeMapJoel: null,
        employeeLabel: 'Joel',
      }).daily;
      imputeJoelByYear[y] = buildImputeMap(joelDailyRaw);
      sheet1ByYear[y].push(...joelDailyRaw);
    }
  }

  const sheet1Flags = [];

  for (const f of files) {
    if (foremanFiles.has(f)) continue;
    const y = deriveYearFromFilename(f);
    const wb = XLSX.readFile(path.join(dir, f), { cellDates: false });
    const sh = wb.Sheets[wb.SheetNames[0]];
    const rows = denseRows(sh);
    const label = employeeNameFromFile(f);
    const res = parseSheet1Daily(sh, rows, f, {
      year: y,
      imputeMapDan: imputeDanByYear[y] || null,
      imputeMapJoel: imputeJoelByYear[y] || null,
      employeeLabel: label,
    });
    if (!sheet1ByYear[y]) sheet1ByYear[y] = [];
    sheet1ByYear[y].push(...res.daily);
    sheet1Flags.push(...res.flags.map((x) => `${f}: ${x.msg}`));
  }

  const outDir = path.join(dir, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const report = [];
  report.push('=== Per-calendar-year outputs (2023 vs 2024 data are not merged) ===');
  report.push(`Years detected from filenames: ${years.join(', ')}`);
  report.push(
    'Each year is written under output/year_<YYYY>/ with its own Sheet1/Sheet2 rollups and audit.'
  );
  report.push('');

  const indexLines = [];

  for (const y of years) {
    const sheet2Year = sheet2All.filter((r) => r.year === y);
    const sheet1Year = sheet1ByYear[y] || [];
    const sub = path.join(outDir, `year_${y}`);
    fs.mkdirSync(sub, { recursive: true });
    const stats = writeYearCsvs(sub, y, sheet2Year, sheet1Year);

    indexLines.push(`year_${y}/`);
    indexLines.push(`  sheet2 hours (sum): ${stats.sheet2Hours.toFixed(2)}`);
    indexLines.push(`  sheet1 hours (sum): ${stats.sheet1Hours.toFixed(2)}`);
    indexLines.push('');

    report.push(`--- Year ${y} ---`);
    report.push(`  Sheet2: ${stats.sheet2Hours.toFixed(2)} hours, ${stats.sheet2Grand.size} canonical jobs`);
    report.push(`  Sheet1: ${stats.sheet1Hours.toFixed(2)} hours, ${stats.sheet1Grand.size} canonical jobs`);
    const danF = findDanFileForYear(files, y);
    const joelF = findJoelFileForYear(files, y);
    report.push(`  Dan file: ${danF || '(none — no Sheet1 imputation from Dan for this year)'}`);
    report.push(`  Joel file: ${joelF || '(none)'}`);
    report.push('');
  }

  fs.writeFileSync(path.join(outDir, 'INDEX.txt'), indexLines.join('\n'), 'utf8');

  report.push('=== Notes ===');
  report.push('- Year comes from the first 20xx in each workbook filename; week banners use that calendar year.');
  report.push('- Combined job numbers on one line (e.g. 6605/6657) split hours evenly across IDs.');
  report.push('- N/A, ?, blank job text → __UNALLOCATED__.');
  report.push('- Sheet1 skips rows with Total hours Week; skips daily totals > 24h (week rollups).');
  report.push(
    '- Second-pass imputation (non-Dan): job/customer only from Dan that day, else Joel; hours stay on the sheet.'
  );
  if (sheet2Errors.length) {
    report.push('');
    report.push('Sheet2 parse notes:');
    sheet2Errors.slice(0, 40).forEach((e) => report.push('  ' + e));
  }
  if (sheet1Flags.length) {
    report.push('');
    report.push('Sheet1 flags (sample):');
    sheet1Flags.slice(0, 30).forEach((e) => report.push('  ' + e));
  }
  fs.writeFileSync(path.join(outDir, 'REPORT.txt'), report.join('\n'), 'utf8');

  console.log(report.join('\n'));
  console.log('\nWrote output to', outDir, '(per-year subfolders year_2023, year_2024, …)');
}

if (require.main === module) {
  main();
}

module.exports = {
  deriveYearFromFilename,
  denseRows,
  findHeaderRow,
  colIndexFromHeader,
  parseWeekBanner,
  extractWeekBannerText,
  dateInRangeForDayOfMonth,
  formatLocalYmd,
  parseHours,
  normalizeJobKey,
  splitJobTokens,
  canonicalJobId,
  findDanFileForYear,
  findJoelFileForYear,
  findBradFileForYear,
  isInBuildingSeason,
  forEachSheet1DayRow,
  parseSheet1Daily,
  buildImputeMap,
};
