// Deterministic extractors for cheap field extraction before LLM fallback.

const STRIP_DIACRITICS = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

// Time formats supported:
//   06:30  6:30  6h  6h30  06h30  às 10h  a partir das 15h
const TIME_REGEX = /\b(\d{1,2})\s*[:hH]\s*(\d{0,2})\b/;

export function extractTime(text: string): string | null {
  const m = TIME_REGEX.exec(text);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] && m[2].length > 0 ? parseInt(m[2], 10) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

// Time range: returns FIRST two times found if separated by typical range markers.
const RANGE_SEPARATORS = /(\bàs?\b|\bate\b|-{1,2}|—|–|\bas\b|\be\b)/i;

export function extractTimeRange(text: string): { start: string; end: string } | null {
  const norm = STRIP_DIACRITICS(text);
  // Find sequence: time ... separator ... time
  const re = /(\d{1,2})\s*[:hH]\s*(\d{0,2})/g;
  const matches: Array<{ h: string; m: string; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    matches.push({ h: m[1], m: m[2] ?? "", idx: m.index });
    if (matches.length >= 4) break;
  }
  if (matches.length < 2) return null;
  const a = matches[0];
  const b = matches[1];
  const between = norm.slice(a.idx, b.idx);
  if (!RANGE_SEPARATORS.test(between)) return null;
  const start = `${pad2(parseInt(a.h, 10))}:${pad2(a.m ? parseInt(a.m, 10) : 0)}`;
  const end = `${pad2(parseInt(b.h, 10))}:${pad2(b.m ? parseInt(b.m, 10) : 0)}`;
  if (parseInt(a.h, 10) > 23 || parseInt(b.h, 10) > 23) return null;
  return { start, end };
}

// Currency: R$ 50, R$50,00, 50 reais, USD 20, US$ 20
const CURRENCY_REGEX =
  /(?:(R\$|US\$|USD|EUR|€|£|GBP)\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(reais|real|dolares|dollar|dollars|euros|libras)?/i;

export function extractCurrency(
  text: string,
  defaultCurrency = "BRL",
): { amount: number; currency: string } | null {
  const m = CURRENCY_REGEX.exec(text);
  if (!m) return null;
  const sym = (m[1] ?? "").toUpperCase();
  const unit = (m[3] ?? "").toLowerCase();
  const raw = m[2];
  // Skip plain digits with no symbol/unit/context — too risky
  if (!sym && !unit) return null;
  // Normalize number: remove thousands sep, use dot for decimals.
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    // assume "." thousands, "," decimal: 1.234,56
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  }
  const amount = parseFloat(normalized);
  if (!isFinite(amount)) return null;
  let currency = defaultCurrency;
  if (sym === "R$" || unit === "reais" || unit === "real") currency = "BRL";
  else if (sym === "US$" || sym === "USD" || unit.startsWith("dol")) currency = "USD";
  else if (sym === "EUR" || sym === "€" || unit === "euros") currency = "EUR";
  else if (sym === "£" || sym === "GBP" || unit === "libras") currency = "GBP";
  return { amount, currency };
}

export function extractNumber(text: string): number | null {
  const m = /\b(\d+(?:[.,]\d+)?)\b/.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isFinite(n) ? n : null;
}

const DEFAULT_POSITIVE = [
  "sim", "possui", "disponível", "disponivel", "incluso", "incluido", "incluído",
  "gratuito", "permitido", "aceita", "oferece", "conta com",
];
const DEFAULT_NEGATIVE = [
  "não possui", "nao possui", "indisponível", "indisponivel",
  "não disponível", "nao disponivel", "não incluso", "nao incluso",
  "não incluído", "nao incluido", "proibido", "não aceita", "nao aceita",
  "não oferece", "nao oferece", "sem",
];

export function extractBooleanByKeywords(
  text: string,
  positive: string[] = DEFAULT_POSITIVE,
  negative: string[] = DEFAULT_NEGATIVE,
): boolean | null {
  const n = STRIP_DIACRITICS(text);
  const negKW = (negative.length ? negative : DEFAULT_NEGATIVE).map(STRIP_DIACRITICS);
  const posKW = (positive.length ? positive : DEFAULT_POSITIVE).map(STRIP_DIACRITICS);
  // Negative wins
  for (const kw of negKW) if (kw && n.includes(kw)) return false;
  for (const kw of posKW) if (kw && n.includes(kw)) return true;
  return null;
}

export function extractEnumByKeywords(
  text: string,
  mapping: Record<string, string[]>,
): string | null {
  const n = STRIP_DIACRITICS(text);
  // Specific-first: longest keyword wins to avoid "pets" matching before "não aceita pets".
  const entries: Array<{ value: string; kw: string }> = [];
  for (const [value, kws] of Object.entries(mapping)) {
    for (const kw of kws) entries.push({ value, kw: STRIP_DIACRITICS(kw) });
  }
  entries.sort((a, b) => b.kw.length - a.kw.length);
  for (const e of entries) if (e.kw && n.includes(e.kw)) return e.value;
  return null;
}

// -------- High-level dispatcher --------

export type ExtractionStrategy = "regex" | "keyword" | "hybrid" | "llm";

export type DpdLite = {
  field_name: string;
  field_type: string;
  extraction_strategy: ExtractionStrategy | null;
  regex_pattern: string | null;
  keywords: unknown;
  negative_keywords: unknown;
};

export type DeterministicResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  method: "regex" | "keyword";
} | null;

function strategyFor(d: DpdLite): ExtractionStrategy {
  if (d.extraction_strategy) return d.extraction_strategy;
  switch (d.field_type) {
    case "time":
    case "time_range":
    case "currency":
    case "number":
    case "boolean":
    case "enum":
      return "hybrid";
    case "text":
    case "multi_select":
    default:
      return "llm";
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function asEnumMap(v: unknown): Record<string, string[]> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) out[k] = val.filter((x): x is string => typeof x === "string");
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function tryDeterministic(
  d: DpdLite,
  text: string,
  defaultCurrency = "BRL",
): DeterministicResult {
  const strat = strategyFor(d);
  if (strat === "llm") return null;

  // Custom regex_pattern (when provided)
  if ((strat === "regex" || strat === "hybrid") && d.regex_pattern) {
    try {
      const re = new RegExp(d.regex_pattern, "i");
      const m = re.exec(text);
      if (m) return { value: m[1] ?? m[0], method: "regex" };
    } catch { /* invalid pattern, ignore */ }
  }

  // Type-based extractors
  if (strat === "regex" || strat === "hybrid") {
    if (d.field_type === "time") {
      const v = extractTime(text);
      if (v) return { value: v, method: "regex" };
    }
    if (d.field_type === "time_range") {
      const v = extractTimeRange(text);
      if (v) return { value: v, method: "regex" };
    }
    if (d.field_type === "currency") {
      const v = extractCurrency(text, defaultCurrency);
      if (v) return { value: v, method: "regex" };
    }
    if (d.field_type === "number") {
      const v = extractNumber(text);
      if (v !== null) return { value: v, method: "regex" };
    }
  }

  if (strat === "keyword" || strat === "hybrid") {
    const kwObj = (d.keywords && typeof d.keywords === "object" && !Array.isArray(d.keywords))
      ? d.keywords as Record<string, unknown>
      : {};
    if (d.field_type === "boolean") {
      const pos = asStringArray(kwObj.positive);
      const neg = asStringArray(d.negative_keywords).length > 0
        ? asStringArray(d.negative_keywords)
        : asStringArray(kwObj.negative);
      const v = extractBooleanByKeywords(text, pos, neg);
      if (v !== null) return { value: v, method: "keyword" };
    }
    if (d.field_type === "enum") {
      const map = asEnumMap(kwObj);
      if (map) {
        const v = extractEnumByKeywords(text, map);
        if (v !== null) return { value: v, method: "keyword" };
      }
    }
  }

  return null;
}
