// Normalize values for consolidation comparison.
// Returns a canonical string used as a grouping key.

import {
  extractTime,
  extractTimeRange,
  extractCurrency,
  extractBooleanByKeywords,
} from "./deterministic-extractors";

function stripDiacritics(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function asTimeString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = extractTime(v);
    if (t) return t;
    // Already HH:mm?
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (m) return `${pad2(+m[1])}:${pad2(+m[2])}`;
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.value === "string") return asTimeString(o.value);
  }
  return null;
}

function asTimeRangeString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const s = typeof o.start === "string" ? asTimeString(o.start) : null;
    const e = typeof o.end === "string" ? asTimeString(o.end) : null;
    if (s && e) return `${s}-${e}`;
  }
  if (typeof v === "string") {
    const r = extractTimeRange(v);
    if (r) return `${r.start}-${r.end}`;
  }
  return null;
}

function asCurrencyString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const amount = typeof o.amount === "number" ? o.amount
      : typeof o.amount === "string" ? parseFloat(o.amount) : NaN;
    const currency = typeof o.currency === "string" ? o.currency.toUpperCase() : "BRL";
    if (isFinite(amount)) return `${currency}:${amount.toFixed(2)}`;
  }
  if (typeof v === "string") {
    const c = extractCurrency(v);
    if (c) return `${c.currency}:${c.amount.toFixed(2)}`;
    const n = parseFloat(v.replace(",", "."));
    if (isFinite(n)) return `BRL:${n.toFixed(2)}`;
  }
  if (typeof v === "number") return `BRL:${v.toFixed(2)}`;
  return null;
}

function asNumberString(v: unknown): string | null {
  if (typeof v === "number" && isFinite(v)) return String(v);
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    if (isFinite(n)) return String(n);
  }
  return null;
}

function asBoolString(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") {
    const b = extractBooleanByKeywords(v);
    if (b !== null) return b ? "true" : "false";
    const t = v.trim().toLowerCase();
    if (["true", "yes", "1"].includes(t)) return "true";
    if (["false", "no", "0"].includes(t)) return "false";
  }
  if (typeof v === "number") return v ? "true" : "false";
  return null;
}

function asTextString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return stripDiacritics(String(v))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeValue(fieldType: string, value: unknown): string {
  switch (fieldType) {
    case "time": return asTimeString(value) ?? `raw:${asTextString(value)}`;
    case "time_range": return asTimeRangeString(value) ?? `raw:${asTextString(value)}`;
    case "currency":
    case "money": return asCurrencyString(value) ?? `raw:${asTextString(value)}`;
    case "number": return asNumberString(value) ?? `raw:${asTextString(value)}`;
    case "boolean": return asBoolString(value) ?? `raw:${asTextString(value)}`;
    case "multi_select": {
      if (Array.isArray(value)) {
        return [...value]
          .map((x) => asTextString(x))
          .sort()
          .join("|");
      }
      return asTextString(value);
    }
    default:
      return asTextString(value);
  }
}

export function chooseConflictType(fieldType: string): string {
  switch (fieldType) {
    case "boolean": return "contradictory_boolean";
    case "time":
    case "time_range": return "different_time";
    case "currency":
    case "money": return "different_price";
    default: return "different_values";
  }
}
