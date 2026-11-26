import { randomInt } from "node:crypto";

const LOWER = "abcdefghijklmnopqrstuvwxyz0123456789";
// Sem 0/O e 1/I: o código do ingresso é digitado à mão no check-in.
const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function random(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** ID no formato `<prefixo>_<12 caracteres>`, ex.: `evt_8f2k1x9a0b3c`. */
export function newId(prefix: "usr" | "evt" | "tkt" | "ses"): string {
  return `${prefix}_${random(LOWER, 12)}`;
}

/** Código de ingresso: 8 caracteres maiúsculos, ex.: `K7Q2M9XA`. */
export function newTicketCode(): string {
  return random(CODE, 8);
}

const ID_PATTERNS = {
  usr: /^usr_[a-z0-9]{12}$/,
  evt: /^evt_[a-z0-9]{12}$/,
  tkt: /^tkt_[a-z0-9]{12}$/,
  ses: /^ses_[a-z0-9]{12}$/,
};

/**
 * `true` se `value` tem o formato de um ID gerado por `newId`. Um ID fora do formato (vindo de uma URL) não existe:
 * quem consulta trata como inexistente sem ir ao banco (um byte NUL, por exemplo, faz o Postgres recusar a consulta).
 */
export function isIdOf(prefix: keyof typeof ID_PATTERNS, value: unknown): boolean {
  return typeof value === "string" && ID_PATTERNS[prefix].test(value);
}
