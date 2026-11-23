// lib/voice/profileStore.ts — profil vocal enregistré PAR COMPTE dans Supabase (table voice_profiles),
// avec copie locale pour le hors ligne. Voir sql/voice_01_calibration.sql.

import { supabase } from '../supabase';
import { SharedEntry, VoiceProfile, emptyProfile } from './calibrate';

// ───────────────────────── Profil (base + cache local hors ligne) ─────────────────────────

const cacheKey = (userId: string) => `teamstats:voice-profile:v1:${userId}`;
const dirtyKey = (userId: string) => `teamstats:voice-profile-dirty:v1:${userId}`;
const readCache = (userId: string): VoiceProfile | null => {
  try { const r = window.localStorage.getItem(cacheKey(userId)); return r ? { ...emptyProfile(), ...JSON.parse(r) } : null; } catch { return null; }
};
const writeCache = (userId: string, p: VoiceProfile, dirty: boolean) => {
  try { window.localStorage.setItem(cacheKey(userId), JSON.stringify(p)); if (dirty) window.localStorage.setItem(dirtyKey(userId), '1'); else window.localStorage.removeItem(dirtyKey(userId)); } catch { /* stockage plein ou refusé : ignoré */ }
};
const isDirty = (userId: string) => { try { return window.localStorage.getItem(dirtyKey(userId)) === '1'; } catch { return false; } };

/** Enregistre le profil en base (et en cache). Hors ligne : gardé en local, renvoyé plus tard. */
export async function saveProfile(userId: string, p: VoiceProfile): Promise<boolean> {
  writeCache(userId, p, true);
  try {
    const { error } = await supabase.from('voice_profiles').upsert(
      { user_id: userId, aliases: p.aliases, word_fixes: p.wordFixes, calibrated_at: p.calibratedAt, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
    writeCache(userId, p, false);
    return true;
  } catch { return false; }
}

/** Charge le profil du compte : la base fait foi, sauf modification locale pas encore envoyée. */
export async function loadProfile(userId: string): Promise<{ profile: VoiceProfile; fromDb: boolean }> {
  const cached = readCache(userId);
  try {
    const { data, error } = await supabase.from('voice_profiles').select('aliases, word_fixes, calibrated_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (cached && isDirty(userId)) { void saveProfile(userId, cached); return { profile: cached, fromDb: false }; }
    if (data) {
      const p: VoiceProfile = { aliases: (data.aliases as VoiceProfile['aliases']) ?? {}, wordFixes: (data.word_fixes as VoiceProfile['wordFixes']) ?? {}, calibratedAt: (data.calibrated_at as string | null) ?? null };
      writeCache(userId, p, false);
      return { profile: p, fromDb: true };
    }
    return { profile: cached ?? emptyProfile(), fromDb: true };
  } catch {
    return { profile: cached ?? emptyProfile(), fromDb: false };
  }
}

// ───────────────────────── Apprentissages partagés par tous les comptes (table voice_shared) ─────────────────────────
const SHARED_KEY = 'teamstats:voice-shared:v1';

/** Variantes de prénoms et corrections de mots communes au club (la correction la plus confirmée l'emporte). */
export async function loadShared(): Promise<VoiceProfile> {
  const read = (): VoiceProfile => { try { const r = window.localStorage.getItem(SHARED_KEY); return r ? { ...emptyProfile(), ...JSON.parse(r) } : emptyProfile(); } catch { return emptyProfile(); } };
  try {
    const { data, error } = await supabase.from('voice_shared').select('kind, key, value, uses').limit(5000);
    if (error) throw error;
    const p = emptyProfile();
    const best: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ kind: string; key: string; value: string; uses: number }>) {
      if (r.kind === 'alias') p.aliases[r.key] = [...(p.aliases[r.key] ?? []), r.value];
      else if (r.kind === 'fix' && r.uses >= 2 && (best[r.key] ?? 0) < r.uses) { p.wordFixes[r.key] = r.value; best[r.key] = r.uses; }   // correction de mot commune : seulement une fois confirmée 2 fois (évite qu'un bruit appris une seule fois déclenche une commande chez tous)
    }
    try { window.localStorage.setItem(SHARED_KEY, JSON.stringify(p)); } catch { /* ignoré */ }
    return p;
  } catch { return read(); }
}

/** Envoie ce que ce compte vient d'apprendre à tout le club (silencieux : sans réseau ou sans la table, on ignore). */
export async function shareEntries(entries: SharedEntry[]): Promise<void> {
  if (!entries.length) return;
  try { await supabase.rpc('voice_share', { p_entries: entries.slice(0, 300) }); } catch { /* ignoré */ }
}
