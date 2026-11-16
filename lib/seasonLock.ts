import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Une saison terminée est en LECTURE SEULE dans l'appli (voir sql/admin_05_season_lock.sql, qui fait foi côté base).
// Tout ce qui est daté d'avant le 1er septembre de la saison en cours est verrouillé. Ici on reproduit la règle pour
// prévenir l'utilisateur avant d'enregistrer ; la date vient de la base (réglable par le superadmin), avec un repli local.
export const defaultLockedBefore = (now = new Date()): string => `${now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1}-09-01`;

let cached: string | null = null;
let pending: Promise<string> | null = null;

export function loadLockedBefore(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = (async () => {
      try {
        const { data, error } = await supabase.rpc('locked_before');
        if (!error && typeof data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data)) cached = data.slice(0, 10);
      } catch { /* hors ligne ou SQL non exécuté : repli local */ }
      return cached ?? defaultLockedBefore();
    })().finally(() => { pending = null; });
  }
  return pending;
}

export function useLockedBefore(): string {
  const [v, setV] = useState<string>(cached ?? defaultLockedBefore());
  useEffect(() => {
    let alive = true;
    void loadLockedBefore().then((x) => { if (alive) setV(x); });
    return () => { alive = false; };
  }, []);
  return v;
}

export const isLockedDate = (d: string | null | undefined, lockedBefore: string) => !!d && String(d).slice(0, 10) < lockedBefore;
// « 2025-2026 » est verrouillée dès que le 1er septembre 2026 est atteint.
export const isLockedSeason = (season: string | null | undefined, lockedBefore: string) => {
  const m = /^(\d{4})-(\d{4})$/.exec(season || '');
  return !!m && `${m[2]}-09-01` <= lockedBefore;
};
