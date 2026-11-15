import { createClient } from '@supabase/supabase-js';

// Configuration Supabase (client unique partagé par toute l'application).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://votre-projet.supabase.co';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'votre-cle-anon';

// Chaque requête réseau est abandonnée au bout de 20 s : avec un réseau faible dans une salle, mieux vaut
// échouer vite (et basculer sur l'enregistrement local) que rester bloqué sans fin.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  if (init?.signal) init.signal.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'multisports' },
  global: { fetch: fetchWithTimeout },
});
