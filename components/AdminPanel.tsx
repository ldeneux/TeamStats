'use client';

import React, { useState } from 'react';
import AdminTeams from './AdminTeams';
import AdminAccess from './AdminAccess';

export type AdminRole = 'superadmin' | 'admin';

// Menu « Administration » (admin et superadmin) : un bandeau d'icônes en haut choisit la section.
export default function AdminPanel({ role }: { role: AdminRole }) {
  const [section, setSection] = useState<'TEAMS' | 'ACCESS'>('TEAMS');
  const items = [
    { key: 'TEAMS' as const, icon: '🏀', title: 'Équipes & calendriers' },
    { key: 'ACCESS' as const, icon: '🔑', title: 'Accès' },
  ];
  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/80 p-1.5">
        {items.map((it) => (
          <button key={it.key} onClick={() => setSection(it.key)} title={it.title}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${section === it.key ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <span className="text-xl leading-none">{it.icon}</span>
            <span className="hidden sm:inline">{it.title}</span>
          </button>
        ))}
        <span className="hidden sm:inline rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-amber-400">{role}</span>
      </nav>
      {section === 'TEAMS' ? <AdminTeams /> : <AdminAccess />}
    </div>
  );
}
