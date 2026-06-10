import { chromium } from 'playwright';
import { config } from '../config.js';

// Abre o Chrome com perfil persistente específico da empresa (guarda o login Amazon).
// Você loga UMA vez (modo login) e a sessão fica salva no .chrome-profile da empresa.
export async function abrirNavegador(profileDir, { headless = false } = {}) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    channel: 'chrome',
    viewport: null,
    args: ['--start-maximized'],
  });
  return ctx;
}

export function pausa(ms = config.actionDelay) {
  return new Promise((r) => setTimeout(r, ms));
}
