// Confere a rastreabilidade da especificação. Uso: node scripts/check-specs.mjs [--final]
// - toda dependência do grafo do PRD tem critério cross-feature;
// - toda regra R01–R13 é citada em algum critério do PRD;
// - todo critério do PRD (por feature e cross-feature) aparece no mapeamento de algum contrato;
// - toda feature tem spec, plano e contrato;
// - com --final: o arquivo de estado lista tudo como concluído, com relatórios que existem.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const problems = [];
const final = process.argv.includes("--final");

const prd = read("docs/PRD.md");
const state = JSON.parse(read("docs/state.json"));

// Linhas de critério: "| F01-AC1 | ..." e "| X-F01-F02-1 | ..."
const criteria = [...prd.matchAll(/^\| ((?:F\d\d-AC\d+)|(?:X-F\d\d-F\d\d-\d+)) \|(.*)$/gm)].map((m) => ({
  id: m[1],
  row: m[2],
}));
const ids = criteria.map((c) => c.id);

const edges = [...prd.matchAll(/^\s*(F\d\d)(?:\[[^\]]*\])? --> (F\d\d)/gm)].map((m) => [m[1], m[2]]);
if (edges.length === 0) problems.push("PRD: grafo de dependências não encontrado");
for (const [from, to] of edges) {
  if (!ids.some((id) => id.startsWith(`X-${from}-${to}-`))) {
    problems.push(`PRD: dependência ${from} → ${to} sem critério cross-feature`);
  }
}

for (let n = 1; n <= 13; n++) {
  const rule = `R${String(n).padStart(2, "0")}`;
  if (!criteria.some((c) => c.row.includes(rule))) problems.push(`PRD: regra ${rule} não é citada em nenhum critério`);
}

const contracts = {};
for (const feature of state.features) {
  for (const file of ["spec.md", "plan.md", "contract.md"]) {
    if (!existsSync(path.join(root, feature.dir, file))) problems.push(`${feature.id}: falta ${feature.dir}/${file}`);
  }
  const contractPath = path.join(feature.dir, "contract.md");
  if (existsSync(path.join(root, contractPath))) {
    const text = read(contractPath);
    const mapping = text.slice(text.indexOf("## Mapeamento"));
    contracts[feature.id] = { text, mapping };
    // Cada linha do mapeamento precisa apontar para itens que existem no contrato.
    for (const row of mapping.matchAll(/^\| ((?:F\d\d-AC\d+)|(?:X-F\d\d-F\d\d-\d+))[^|]*\|[^|]*\|([^|]*)\|/gm)) {
      const items = [...row[2].matchAll(/F\d\d-I\d\d/g)].map((m) => m[0]);
      if (items.length === 0) problems.push(`${feature.id}: critério ${row[1]} sem item no mapeamento`);
      for (const item of items) {
        if (!text.includes(`### ${item} `)) problems.push(`${feature.id}: item ${item} citado no mapeamento não existe`);
      }
    }
  }
}

for (const id of ids) {
  const owners = Object.entries(contracts).filter(([, c]) => new RegExp(`^\\| ${id}[ |]`, "m").test(c.mapping));
  if (owners.length === 0) problems.push(`Critério ${id} não aparece no mapeamento de nenhum contrato`);
  if (id.startsWith("F") && !owners.some(([featureId]) => id.startsWith(featureId))) {
    problems.push(`Critério ${id} não está no contrato da própria feature`);
  }
}

if (final) {
  for (const feature of state.features) {
    if (feature.status !== "done") problems.push(`state.json: ${feature.id} está "${feature.status}", não "done"`);
    if (!feature.latestEvaluation || !existsSync(path.join(root, feature.latestEvaluation))) {
      problems.push(`state.json: relatório de ${feature.id} não existe (${feature.latestEvaluation})`);
      continue;
    }
    const dir = path.join(root, feature.dir, "evaluations");
    const latest = readdirSync(dir).filter((f) => /^eval-\d+\.md$/.test(f)).sort().at(-1);
    if (path.basename(feature.latestEvaluation) !== latest) {
      problems.push(`state.json: ${feature.id} aponta para ${feature.latestEvaluation}, mas o mais recente é ${latest}`);
    }
  }
}

console.log(
  `PRD: ${state.features.length} features, ${edges.length} dependências, ${ids.length} critérios ` +
    `(${ids.filter((id) => id.startsWith("X-")).length} cross-feature).`,
);
if (problems.length > 0) {
  console.error(problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(final ? "Especificação e estado: OK" : "Especificação: OK");
