// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/**
 * `true` se o texto tem caractere de controle (U+0000–U+001F ou U+007F). Texto digitado em um campo de formulário
 * nunca tem; quem manda é entrada hostil, e o byte NUL em particular faz o Postgres recusar a consulta.
 */
export function hasControlChar(value: string): boolean {
  return CONTROL_CHAR.test(value);
}
