import { chromium } from 'playwright';
import { config } from '../config.js';

// Abre o Chrome com perfil persistente específico da empresa (guarda o login Amazon).
// Você loga UMA vez (modo login) e a sessão fica salva no .chrome-profile da empresa.
export async function abrirNavegador(profileDir, { headless = false } = {}) {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: 'chrome',
      viewport: null,
      args: ['--start-maximized'],
    });
  } catch (e) {
    // Perfil já aberto por outra janela do Chrome (ex.: o "Abrir conta").
    if (/existing browser session|being used|already|has been closed/i.test(e.message)) {
      throw new Error('O navegador desta empresa já está aberto. Feche a janela do Chrome dela (inclusive a do "Abrir conta") e tente de novo.');
    }
    throw e;
  }
  // Paciência com a Amazon (lenta): vale pra esperar campos, cliques e navegação.
  ctx.setDefaultTimeout(config.navTimeout);
  ctx.setDefaultNavigationTimeout(config.navTimeout);
  return ctx;
}

export function pausa(ms = config.actionDelay) {
  return new Promise((r) => setTimeout(r, ms));
}
