'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TeamTile from './TeamTile';
import { adminApi } from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import { ClubTeam, loadClubTeams, sortTeams } from '../lib/clubDb';
import { currentSeason } from '../lib/clubTeams';

type Role = 'superadmin' | 'admin' | 'analyst';
interface AppUser { id: string; email: string; created_at: string; last_sign_in_at: string | null; banned: boolean; role: Role | null; display_name: string | null }
interface Access { user_id: string; team_id: string }
interface StatsTeam { id: string; name: string }
interface UsersResponse { callerRole: Role; callerId: string; users: AppUser[]; access: Access[] }

const ROLE_STYLE: Record<Role, string> = {
  superadmin: 'border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-300',
  admin: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  analyst: 'border-blue-400/50 bg-blue-500/10 text-blue-300',
};
const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'jamais');
const inputCls = 'w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-sm font-bold text-white focus:border-amber-500 focus:outline-none';

export default function AdminAccess() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [clubTeams, setClubTeams] = useState<ClubTeam[]>([]);
  const [statsTeams, setStatsTeams] = useState<StatsTeam[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [u, ct, st] = await Promise.all([
        adminApi<UsersResponse>('/api/admin/users'),
        loadClubTeams(),
        supabase.from('stats_teams').select('id, name').order('name'),
      ]);
      setData(u);
      setClubTeams(ct);
      setStatsTeams((st.data ?? []) as StatsTeam[]);
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const canManage = (u: AppUser) => !!data && (data.callerRole === 'superadmin' || u.role === 'analyst' || u.role === null);
  const roleOptions: Role[] = data?.callerRole === 'superadmin' ? ['analyst', 'admin', 'superadmin'] : ['analyst'];

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(''); setNotice('');
    try { await fn(); setNotice(ok); await reload(); } catch (e: any) { setError(e?.message || String(e)); }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-500">Comptes et accès</h2>
            <p className="text-[11px] text-slate-400">
              Un coach (analyst) ne voit que les équipes qui lui sont affectées, par saison. Les admin et superadmin voient tout.
              {data?.callerRole === 'admin' && ' Seul un superadmin peut gérer les comptes admin et superadmin.'}
            </p>
          </div>
          <button onClick={() => setCreating((v) => !v)} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500">{creating ? 'Fermer' : '＋ Nouveau compte'}</button>
        </div>
        {creating && data && (
          <CreateUser roles={roleOptions} onCreate={(b) => act(async () => { await adminApi('/api/admin/users', 'POST', b); setCreating(false); }, 'Compte créé.')} />
        )}
        {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-300 break-words">{error}</p>}
        {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-300">{notice}</p>}
      </section>

      {!data && !error && <p className="py-6 text-center text-sm text-slate-400">Chargement…</p>}

      {data && (
        <ul className="space-y-2">
          {data.users.map((u) => (
            <UserCard key={u.id} u={u} self={u.id === data.callerId} open={openId === u.id} onToggle={() => setOpenId(openId === u.id ? '' : u.id)}
              manageable={canManage(u)} roleOptions={roleOptions} callerRole={data.callerRole}
              clubTeams={clubTeams} statsTeams={statsTeams} access={data.access.filter((a) => a.user_id === u.id)}
              act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateUser({ roles, onCreate }: { roles: Role[]; onCreate: (b: object) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(genPassword());
  const [role, setRole] = useState<Role>('analyst');
  const [show, setShow] = useState(true);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onCreate({ email, display_name: name, password, role }); }} className="space-y-2 rounded-xl bg-slate-800/50 p-3">
      <input type="email" required placeholder="Adresse e-mail" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
      <input placeholder="Nom affiché (ex. Prénom)" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      <div className="flex gap-2">
        <input type={show ? 'text' : 'password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} flex-1 min-w-0`} />
        <button type="button" onClick={() => setPassword(genPassword())} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300">Générer</button>
        <button type="button" onClick={() => setShow((v) => !v)} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300">{show ? '🙈' : '👁'}</button>
      </div>
      <p className="text-[11px] text-slate-500">Notez le mot de passe maintenant : il ne sera plus affiché. Le compte est actif immédiatement.</p>
      <div className="flex gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={`${inputCls} flex-1`}>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">Créer</button>
      </div>
    </form>
  );
}

function UserCard({ u, self, open, onToggle, manageable, roleOptions, callerRole, clubTeams, statsTeams, access, act }: {
  u: AppUser; self: boolean; open: boolean; onToggle: () => void; manageable: boolean; roleOptions: Role[]; callerRole: Role;
  clubTeams: ClubTeam[]; statsTeams: StatsTeam[]; access: Access[];
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState(u.display_name || '');
  const [pwd, setPwd] = useState('');
  const patch = (b: object, ok: string) => act(() => adminApi('/api/admin/users', 'PATCH', { user_id: u.id, ...b }), ok);

  // Résumé des équipes affectées : « 2025-2026 : U13 F · 2026-2027 : U15 F ».
  const summary = useMemo(() => {
    const byStats = new Map(clubTeams.filter((t) => t.stats_team_id).map((t) => [t.stats_team_id as string, t]));
    const bySeason = new Map<string, string[]>();
    for (const a of access) {
      const ct = byStats.get(a.team_id);
      const season = ct?.season ?? 'Autres';
      const label = ct?.label ?? statsTeams.find((s) => s.id === a.team_id)?.name ?? '?';
      bySeason.set(season, [...(bySeason.get(season) ?? []), label]);
    }
    return Array.from(bySeason.entries()).sort((x, y) => y[0].localeCompare(x[0]));
  }, [access, clubTeams, statsTeams]);

  const seesAll = u.role === 'admin' || u.role === 'superadmin';

  return (
    <li className={`rounded-2xl border bg-slate-900/80 ${open ? 'border-amber-500/60' : 'border-slate-700/60'}`}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-black text-amber-400">{(u.display_name || u.email || '?')[0].toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-white">{u.display_name || u.email}</span>
            {u.role ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${ROLE_STYLE[u.role]}`}>{u.role}</span>
              : <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-black uppercase text-slate-400">sans profil</span>}
            {u.banned && <span className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-rose-300">désactivé</span>}
            {self && <span className="text-[10px] text-slate-500">(vous)</span>}
          </span>
          <span className="block truncate text-[11px] text-slate-500">{u.email} · dernière connexion {fmt(u.last_sign_in_at)}</span>
          <span className="mt-1 block text-[11px] text-slate-400">
            {seesAll ? 'Voit toutes les équipes.' : summary.length === 0 ? (u.role ? 'Aucune équipe affectée.' : 'Aucun accès.') : summary.map(([s, l]) => `${s} : ${l.join(', ')}`).join('  ·  ')}
          </span>
        </span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-800 p-3">
          {!manageable && <p className="text-xs text-slate-400">Seul un superadmin peut modifier ce compte.</p>}
          {manageable && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-slate-400">Nom affiché
                  <div className="mt-1 flex gap-2">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    <button onClick={() => patch({ display_name: name }, 'Nom enregistré.')} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-200">OK</button>
                  </div>
                </label>
                <label className="text-[11px] font-semibold text-slate-400">Rôle
                  <select value={u.role ?? ''} disabled={self} onChange={(e) => patch({ role: e.target.value || null }, 'Rôle modifié.')} className={`${inputCls} mt-1 disabled:opacity-50`}>
                    {u.role === null && <option value="">Sans profil (aucun accès)</option>}
                    {Array.from(new Set<Role>([...roleOptions, ...(u.role ? [u.role] : [])])).map((r) => <option key={r} value={r} disabled={!roleOptions.includes(r)}>{r}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-slate-400 sm:col-span-2">Nouveau mot de passe
                  <div className="mt-1 flex gap-2">
                    <input type="text" minLength={8} placeholder="8 caractères minimum" value={pwd} onChange={(e) => setPwd(e.target.value)} className={inputCls} />
                    <button type="button" onClick={() => setPwd(genPassword())} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300">Générer</button>
                    <button disabled={pwd.length < 8} onClick={() => { void patch({ password: pwd }, 'Mot de passe modifié : communiquez-le à la personne.'); setPwd(''); }} className="shrink-0 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white disabled:opacity-40">Changer</button>
                  </div>
                </label>
              </div>

              {u.role === 'analyst' && <TeamAssignment user={u} clubTeams={clubTeams} statsTeams={statsTeams} access={access} act={act} />}
              {u.role === null && <button onClick={() => patch({ role: 'analyst' }, 'Profil analyst créé.')} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">Donner le profil analyst</button>}

              {!self && (
                <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                  <button onClick={() => patch({ banned: !u.banned }, u.banned ? 'Compte réactivé.' : 'Compte désactivé.')} className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200">{u.banned ? 'Réactiver le compte' : 'Désactiver le compte'}</button>
                  <button onClick={() => { if (window.confirm(`Supprimer définitivement le compte ${u.email} ?`)) void act(() => adminApi('/api/admin/users', 'DELETE', { user_id: u.id }), 'Compte supprimé.'); }} className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">Supprimer le compte</button>
                  <span className="self-center text-[10px] text-slate-600">Rôle {callerRole}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

// Affectation des équipes d'un coach, saison par saison : un clic sur une vignette ouvre / ferme l'équipe.
function TeamAssignment({ user, clubTeams, statsTeams, access, act }: {
  user: AppUser; clubTeams: ClubTeam[]; statsTeams: StatsTeam[]; access: Access[];
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const seasons = useMemo(() => {
    const s = new Set(clubTeams.map((t) => t.season));
    s.add(currentSeason());
    return Array.from(s).sort().reverse();
  }, [clubTeams]);
  const [season, setSeason] = useState(currentSeason());
  const teams = useMemo(() => sortTeams(clubTeams.filter((t) => t.season === season)), [clubTeams, season]);
  const has = (statsTeamId: string | null) => !!statsTeamId && access.some((a) => a.team_id === statsTeamId);

  const toggle = (statsTeamId: string | null) => {
    if (!statsTeamId) return;
    if (has(statsTeamId)) {
      return act(async () => {
        const { error } = await supabase.from('team_access').delete().eq('user_id', user.id).eq('team_id', statsTeamId);
        if (error) throw new Error(error.message);
      }, 'Équipe retirée.');
    }
    return act(async () => {
      const { error } = await supabase.from('team_access').insert({ user_id: user.id, team_id: statsTeamId });
      if (error) throw new Error(error.message);
    }, 'Équipe affectée.');
  };

  // Équipes TeamStats qui ne sont rattachées à aucune équipe FFBB (créées à la main, anciennes saisons...).
  const linked = new Set(clubTeams.map((t) => t.stats_team_id).filter(Boolean));
  const others = statsTeams.filter((s) => !linked.has(s.id));

  return (
    <div className="space-y-3 rounded-xl bg-slate-800/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-300">Équipes affectées</h3>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">Saison
          <select value={season} onChange={(e) => setSeason(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm font-bold text-white">
            {seasons.map((s) => <option key={s} value={s}>{s}{s === currentSeason() ? ' (en cours)' : ''}</option>)}
          </select>
        </label>
      </div>
      {teams.length === 0
        ? <p className="text-xs text-slate-500">Aucune équipe pour la saison {season} : chargez-les depuis « Équipes &amp; calendriers ».</p>
        : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {teams.map((t) => <TeamTile key={t.id} team={t} check={has(t.stats_team_id)} selected={has(t.stats_team_id)} onClick={() => toggle(t.stats_team_id)} badge={t.stats_team_id ? undefined : 'équipe TeamStats manquante'} />)}
          </div>
        )}
      {others.length > 0 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer font-semibold">Autres équipes TeamStats (hors FFBB) : {others.length}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((s) => (
              <button key={s.id} onClick={() => toggle(s.id)} className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${has(s.id) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                {has(s.id) ? '✓ ' : ''}{s.name}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
