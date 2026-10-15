// Utility functions for DSC Date & Time formatting:
// Format: "Friday, 10 April, 2026 12:21:10 AM"
// Matching Python ReportLab Customer PDF generator

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function parseFlexibleDate(val?: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s || s === '—' || s === 'NA' || s === 'None' || s === 'null' || s === 'undefined') return null;

  // Pattern: "Friday, 10 April, 2026 12:21:10 AM"
  const dscMatch = s.match(/^[A-Za-z]+,\s+(\d{1,2})\s+([A-Za-z]+),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i);
  if (dscMatch) {
    const [, dayStr, monStr, yrStr, hrStr, minStr, secStr, ampm] = dscMatch;
    const monthIdx = MONTHS.findIndex(m => m.toLowerCase().startsWith(monStr.toLowerCase().slice(0, 3)));
    if (monthIdx !== -1) {
      let hr = hrStr ? parseInt(hrStr, 10) : 12;
      const min = minStr ? parseInt(minStr, 10) : 0;
      const sec = secStr ? parseInt(secStr, 10) : 0;
      if (ampm) {
        if (ampm.toUpperCase() === 'PM' && hr < 12) hr += 12;
        if (ampm.toUpperCase() === 'AM' && hr === 12) hr = 0;
      }
      const d = new Date(parseInt(yrStr, 10), monthIdx, parseInt(dayStr, 10), hr, min, sec);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Strip weekday prefix if present: "Friday, ..."
  const noWeekday = s.replace(/^[A-Za-z]+,\s*/, '');
  const parsedDirect = Date.parse(noWeekday);
  if (!isNaN(parsedDirect)) return new Date(parsedDirect);

  // Pattern: DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmyMatch) {
    const [, d, m, y, hrStr, minStr, secStr] = dmyMatch;
    return new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      hrStr ? parseInt(hrStr, 10) : 12,
      minStr ? parseInt(minStr, 10) : 0,
      secStr ? parseInt(secStr, 10) : 0
    );
  }

  // Pattern: YYYY-MM-DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0);
  }

  const rawParse = Date.parse(s);
  if (!isNaN(rawParse)) return new Date(rawParse);

  return null;
}

export function formatDscDateTime(val?: any, fallback: string = '—'): string {
  if (!val) return fallback;
  const s = String(val).trim();
  if (!s || s === '—' || s === 'NA' || s === 'None' || s === 'null' || s === 'undefined') return fallback;

  // If already formatted strictly like 'Friday, 10 April, 2026 12:21:10 AM'
  if (/^[A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+,\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M$/i.test(s)) {
    return s;
  }

  const dt = parseFlexibleDate(s);
  if (!dt || isNaN(dt.getTime())) return s;

  const dow = DAYS[dt.getDay()];
  const day = dt.getDate();
  const month = MONTHS[dt.getMonth()];
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hStr = hours < 10 ? `0${hours}` : `${hours}`;
  const mStr = dt.getMinutes() < 10 ? `0${dt.getMinutes()}` : `${dt.getMinutes()}`;
  const sStr = dt.getSeconds() < 10 ? `0${dt.getSeconds()}` : `${dt.getSeconds()}`;

  return `${dow}, ${day} ${month}, ${year} ${hStr}:${mStr}:${sStr} ${ampm}`;
}

export function nowDscDateTime(): string {
  return formatDscDateTime(new Date());
}

export function addYearsDscDateTime(baseVal?: any, years: number = 2): string {
  const base = parseFlexibleDate(baseVal) || new Date();
  const next = new Date(base.getTime());
  next.setFullYear(next.getFullYear() + years);
  return formatDscDateTime(next);
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const dt = parseFlexibleDate(dateStr);
  if (!dt || isNaN(dt.getTime())) return null;
  const diff = dt.getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
