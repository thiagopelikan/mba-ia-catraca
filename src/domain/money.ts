/** 10000 → "R$ 100,00"; 123456 → "R$ 1.234,56". Usa espaço comum (não U+00A0) depois de "R$". */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = String(abs % 100).padStart(2, "0");
  return `${sign}R$ ${reais},${centavos}`;
}

/** "100", "100,00", "100.00", "1.234,56", "R$ 49,90" → centavos; ilegível ou negativo → null. Zero → 0. */
export function parseBRL(text: string): number | null {
  let value = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
