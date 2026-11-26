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
