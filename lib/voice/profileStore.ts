// lib/voice/profileStore.ts — profil vocal enregistré PAR COMPTE dans Supabase (table voice_profiles),
// avec copie locale pour le hors ligne. Voir sql/voice_01_calibration.sql.

import { supabase } from '../supabase';
import { VoiceProfile, emptyProfile } from './calibrate';

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
