'use client';

import React, { useState } from 'react';
import { ClubTeam } from '../lib/clubDb';
import { ffbbAssetUrl } from '../lib/clubTeams';

// Vignette d'une équipe : l'image FFBB du niveau (ex. U15F) + le libellé. Sert à choisir une équipe.
export default function TeamTile({
  team, selected, onClick, badge, check,
}: { team: ClubTeam; selected?: boolean; onClick?: () => void; badge?: string; check?: boolean }) {
  const [broken, setBroken] = useState(false);
  const url = ffbbAssetUrl(team.logo_asset, { height: 300 });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center rounded-2xl border p-2 text-center transition ${
        selected ? 'border-amber-500 bg-amber-500/15 ring-2 ring-amber-500/60' : 'border-slate-700 bg-slate-900/80 hover:border-slate-500'
      }`}
    >
      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-white/95 sm:h-28">
        {url && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={team.label} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-2xl font-black text-slate-700">{team.code}</span>
        )}
      </div>
      <span className="mt-1.5 text-sm font-extrabold text-white leading-tight">{team.label}</span>
      {badge && <span className="mt-0.5 text-[10px] text-slate-400">{badge}</span>}
      {check !== undefined && (
        <span className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${check ? 'bg-emerald-500 text-white' : 'bg-slate-800/90 text-slate-500 border border-slate-600'}`}>{check ? '✓' : ''}</span>
      )}
    </button>
  );
}
