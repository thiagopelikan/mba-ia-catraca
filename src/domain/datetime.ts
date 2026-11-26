// O produto usa o fuso fixo America/Sao_Paulo (UTC−03:00, sem horário de verão).
const OFFSET_MS = 3 * 60 * 60 * 1000;

const pad = (n: number, size = 2): string => String(n).padStart(size, "0");

/** Campos do relógio de São Paulo para um instante. */
function parts(date: Date): { y: string; mo: string; d: string; h: string; mi: string; s: string } {
  const local = new Date(date.getTime() - OFFSET_MS);
  return {
    y: pad(local.getUTCFullYear(), 4),
    mo: pad(local.getUTCMonth() + 1),
    d: pad(local.getUTCDate()),
    h: pad(local.getUTCHours()),
    mi: pad(local.getUTCMinutes()),
    s: pad(local.getUTCSeconds()),
  };
}

/** "2026-12-05T21:00" (valor de <input type="datetime-local">, hora de São Paulo) → Date; ilegível → null. */
export function parseDatetimeLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(value.trim());
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  // Rejeita datas que o Date "normalizaria" (mês 13, 30 de fevereiro).
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc + OFFSET_MS);
}

/** Date → "2026-12-05T21:00" em hora de São Paulo (para preencher o input). */
export function toDatetimeLocalValue(date: Date): string {
  const p = parts(date);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}`;
}

/** Date → "05/12/2026 21:00" em hora de São Paulo. */
export function formatDateTimeBR(date: Date): string {
  const p = parts(date);
  return `${p.d}/${p.mo}/${p.y} ${p.h}:${p.mi}`;
}

/** Date → "2026-12-05T21:00:00-03:00". */
export function toIsoSaoPaulo(date: Date): string {
  const p = parts(date);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}-03:00`;
}
