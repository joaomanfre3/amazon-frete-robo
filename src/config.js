import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  empresasDir: path.join(ROOT, 'empresas'),
  templatePath: path.join(ROOT, 'template', 'tabela_modelo.xlsx'),
  actionDelay: Number(process.env.ACTION_DELAY_MS || 700),
  // A Amazon Seller Central trava bastante — esperamos até 2 min por ação/página.
  // Aumente NAV_TIMEOUT_MS no .env se ainda estourar.
  navTimeout: Number(process.env.NAV_TIMEOUT_MS || 120_000),
  amazon: {
    modelos: 'https://sellercentral.amazon.com.br/sbr#shipping_templates',
    criarModelo: 'https://sellercentral.amazon.com.br/sbr/template?request=%7B%22action%22%3A%22create%22%7D',
  },
};
