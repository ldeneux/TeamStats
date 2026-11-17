'use client';

import React, { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';
import { supabase } from '../lib/supabase';

interface Coach { id: string; email: string; display_name: string | null }
const inputCls = 'w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-sm font-bold text-white focus:border-amber-500 focus:outline-none';

// « Mon compte » : changer son mot de passe ; pour un admin / superadmin, choisir de continuer en admin
// ou de tester un compte coach (sans son mot de passe).
export default function AccountModal({ email, role, impersonating, welcome, onClose, onImpersonate }: {
  email: string; role: string; impersonating: boolean; welcome: boolean; onClose: () => void;
  onImpersonate: (userId: string) => Promise<void>;
}) {
  const canTest = (role === 'admin' || role === 'superadmin') && !impersonating;
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [coachId, setCoachId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!canTest) return;
    adminApi<{ coaches: Coach[] }>('/api/admin/impersonate').then((r) => { setCoaches(r.coaches); if (r.coaches[0]) setCoachId(r.coaches[0].id); })
      .catch((e) => { setCoaches([]); setMsg({ ok: false, text: e?.message || String(e) }); });
  }, [canTest]);

  const changePassword = async () => {
    setMsg(null);
    if (!pwd) { setMsg({ ok: false, text: 'Saisissez le nouveau mot de passe.' }); return; }
    if (pwd !== pwd2) { setMsg({ ok: false, text: 'Les deux saisies sont différentes.' }); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw new Error(error.message);
      setPwd(''); setPwd2(''); setMsg({ ok: true, text: 'Mot de passe modifié.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally { setBusy(false); }
  };

  const test = async () => {
    if (!coachId) return;
    setBusy(true); setMsg(null);
    try { await onImpersonate(coachId); onClose(); } catch (e: any) { setMsg({ ok: false, text: e?.message || String(e) }); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-extrabold text-amber-400">{welcome ? 'Bienvenue' : 'Mon compte'}</h3>
          <p className="text-xs text-slate-400 break-all">{email} · profil <b className="text-white">{role}</b></p>
        </div>

        {canTest && (
          <div className="space-y-2 rounded-xl bg-slate-800/50 p-3">
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-300">Se connecter en tant que…</h4>
            <button onClick={onClose} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-500">Continuer en {role}</button>
            <p className="pt-1 text-[11px] text-slate-400">ou tester ce que voit un coach (sans son mot de passe) :</p>
            {coaches === null ? <p className="text-xs text-slate-500">Chargement…</p>
              : coaches.length === 0 ? <p className="text-xs text-slate-500">Aucun compte coach.</p>
              : (
                <div className="flex gap-2">
                  <select value={coachId} onChange={(e) => setCoachId(e.target.value)} className={inputCls}>
                    {coaches.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.email}</option>)}
                  </select>
                  <button onClick={test} disabled={busy} className="shrink-0 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">Tester</button>
                </div>
              )}
            <p className="text-[10px] text-slate-500">Vous aurez exactement les droits et les équipes de ce coach. Attention : ce que vous enregistrez est enregistré pour de vrai.</p>
          </div>
        )}

        {!impersonating && (
          <div className="space-y-2 rounded-xl bg-slate-800/50 p-3">
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-300">Changer mon mot de passe</h4>
            <div className="flex gap-2">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Nouveau mot de passe" value={pwd} onChange={(e) => setPwd(e.target.value)} className={inputCls} />
              <button type="button" onClick={() => setShow((v) => !v)} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300">{show ? 'Masquer' : 'Afficher'}</button>
            </div>
            <input type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Confirmer" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className={inputCls} />
            <button onClick={changePassword} disabled={busy || !pwd} className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-40">Enregistrer le mot de passe</button>
          </div>
        )}
        {impersonating && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">Vous testez le compte d&apos;un coach : le mot de passe n&apos;est pas modifiable ici. Revenez d&apos;abord à votre compte.</p>}

        {msg && <p className={`text-xs break-words ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>}
        <button onClick={onClose} className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white hover:bg-slate-700">Fermer</button>
      </div>
    </div>
  );
}
