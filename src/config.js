import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  empresasDir: path.join(ROOT, 'empresas'),
  templatePath: path.join(ROOT, 'template', 'tabela_modelo.xlsx'),
  actionDelay: Number(process.env.ACTION_DELAY_MS || 700),
  amazon: {
    modelos: 'https://sellercentral.amazon.com.br/sbr#shipping_templates',
    criarModelo: 'https://sellercentral.amazon.com.br/sbr/template?request=%7B%22action%22%3A%22create%22%7D',
  },
};
