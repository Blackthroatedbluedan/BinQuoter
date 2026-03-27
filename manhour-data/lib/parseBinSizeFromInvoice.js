/**
 * Derive diameter (ft) and ring count from job # encoding and invoice Ship-to / description text.
 *
 * Encoding (4-digit job numbers): e.g. 7225 → 72' diameter, 25 rings (floor(n/100), n%100).
 * Text: "Brock 42-11", "Brock 4215", "42 ft x 13 Ring", "45'-12 rings", "6030 Bin", etc.
 *
 * Concrete: if description matches /\bconcrete\b/i, hours are not attributed to bin steel
 * work for the calculator (see bin_hours_for_bin_model).
 */

function norm(s) {
  return String(s ?? "").trim();
}

function isConcreteInDescription(desc) {
  const d = norm(desc);
  if (!d) return false;
  return /\bconcrete\b/i.test(d);
}

/**
 * @returns {{ diameter: number, rings: number, source: string } | null}
 */
function parseFromFourDigitNumber(n) {
  if (!Number.isFinite(n) || n < 1000 || n > 9999) return null;
  const dia = Math.floor(n / 100);
  const rings = n % 100;
  if (dia >= 12 && dia <= 120 && rings >= 1 && rings <= 55) {
    return { diameter: dia, rings, source: "job_id_4digit" };
  }
  return null;
}

/**
 * @param {string} canonicalJobId
 * @param {string} invoiceDescription
 */
function parseBinSize(canonicalJobId, invoiceDescription) {
  const desc = norm(invoiceDescription);
  const idStr = norm(canonicalJobId);

  /** 1) Strong text patterns (description) */
  if (desc) {
    let m = desc.match(/Brock\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
    if (m) {
      const diameter = parseInt(m[1], 10);
      const rings = parseInt(m[2], 10);
      if (diameter >= 10 && rings >= 1)
        return { diameter, rings, source: "text_brock_dash" };
    }

    m = desc.match(/Commercial\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
    if (m) {
      const diameter = parseInt(m[1], 10);
      const rings = parseInt(m[2], 10);
      if (diameter >= 10 && rings >= 1)
        return { diameter, rings, source: "text_commercial_dash" };
    }

    m = desc.match(/Westeel[^,]*?(\d{1,2})\s*['']?\s*[-–]\s*(\d+)\s*rings?/i);
    if (m) {
      const diameter = parseInt(m[1], 10);
      const rings = parseInt(m[2], 10);
      if (diameter >= 10 && rings >= 1)
        return { diameter, rings, source: "text_ft_dash_rings" };
    }

    m = desc.match(/(\d{1,2})\s*ft\s*x\s*(\d+)\s*Ring/i);
    if (m) {
      const diameter = parseInt(m[1], 10);
      const rings = parseInt(m[2], 10);
      if (diameter >= 10 && rings >= 1)
        return { diameter, rings, source: "text_ft_x_ring" };
    }

    m = desc.match(/(\d{2})\s*['']?\s*[-–]\s*(\d+)\s*rings?\b/i);
    if (m) {
      const diameter = parseInt(m[1], 10);
      const rings = parseInt(m[2], 10);
      if (diameter >= 10 && rings >= 1)
        return { diameter, rings, source: "text_prime_dash_rings" };
    }

    m = desc.match(/\bBrock\s+(\d{4})\b/i);
    if (m) {
      const code = parseInt(m[1], 10);
      const p = parseFromFourDigitNumber(code);
      if (p) return { ...p, source: "text_brock_4digit" };
    }

    m = desc.match(/\b(\d{4})\s+(?:NC|Narrow|Grain|Bin|Storage)/i);
    if (m) {
      const code = parseInt(m[1], 10);
      const p = parseFromFourDigitNumber(code);
      if (p) return { ...p, source: "text_4digit_before_nc" };
    }

    /** "6030 Bin" / " 6030 " */
    m = desc.match(/\b(\d{4})\s+Bin\b/i);
    if (m) {
      const p = parseFromFourDigitNumber(parseInt(m[1], 10));
      if (p) return { ...p, source: "text_4digit_bin" };
    }

    /** First plausible bin-code 4-digit in description (e.g. "7225 Greydafton") — skip calendar years like "for 2023 Projects" */
    const re4 = /\b(\d{4})\b/g;
    let mm;
    while ((mm = re4.exec(desc)) !== null) {
      const code = parseInt(mm[1], 10);
      if (code >= 2020 && code <= 2029 && new RegExp(`for\\s+${code}\\b`, "i").test(desc)) {
        continue;
      }
      const p = parseFromFourDigitNumber(code);
      if (p) return { ...p, source: "text_first_4digit" };
    }
  }

  /** Numeric canonical job id (4 digits) — encoding ft+rings */
  if (/^\d{4}$/.test(idStr)) {
    const p = parseFromFourDigitNumber(parseInt(idStr, 10));
    if (p) return p;
  }

  return null;
}

/**
 * Hours to use for bin steel model: 0 if concrete is mentioned; else total sheet1 hours.
 */
function binHoursForModel(totalHoursSheet1, invoiceDescription) {
  const h = parseFloat(String(totalHoursSheet1 ?? "").replace(/,/g, ""));
  if (!Number.isFinite(h)) return "";
  if (isConcreteInDescription(invoiceDescription)) return "0";
  return String(h);
}

module.exports = {
  isConcreteInDescription,
  parseBinSize,
  parseFromFourDigitNumber,
  binHoursForModel,
};
