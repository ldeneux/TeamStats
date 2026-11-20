// « Gestion des équipes et des calendriers » : lit le cache FFBB (multisports.ffbb_poule_cache, alimenté par
// MiseAJourFFBB_Club.exe), repère les équipes du club pour la saison en cours et enregistre pour chacune
// ses phases, son calendrier et son classement. Appelée par lots de quelques poules (voir AdminPanel).
import { NextResponse } from 'next/server';
import { authenticate, fail, HttpError, type DB } from '@/lib/serverAuth';
import { findAssetCandidates, pouleFromPages, type AssetCandidate, type FfbbPoule } from '@/lib/ffbbPoule';
import {
  clubEngagementsIn, competitionUrl, cupTourNumber, currentSeason, explicitPhaseNumber, identifyTeam, isCup, normName, seasonOfIso, statsTeamName,
} from '@/lib/clubTeams';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const toTimestamp = (v: string | null) => (v ? (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`) : null);

// Saison d'une poule = saison de la majorité de ses matchs datés.
function seasonOfPoule(p: FfbbPoule): string | null {
  const count = new Map<string, number>();
  for (const r of p.rencontres) {
    const s = seasonOfIso(r.date_rencontre);
    if (s) count.set(s, (count.get(s) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  count.forEach((c, s) => { if (c > n) { n = c; best = s; } });
  return best;
}

interface PouleResult {
  pouleId: string;
  status: 'ok' | 'ignoree' | 'erreur';
  message: string;
  teams: string[];
  matches: number;
}

async function processPoule(db: DB, pouleId: string, data: any, fetchedAt: string, season: string, statsByName: Map<string, string>): Promise<PouleResult> {
  const res: PouleResult = { pouleId, status: 'ok', message: '', teams: [], matches: 0 };
  if (!Array.isArray(data?.pages) || data.pages.length === 0) {
    return { ...res, status: 'erreur', message: 'Format de cache non reconnu (pas de pages).' };
  }
  const poule = pouleFromPages(data.pages, pouleId);
  if (poule.rencontres.length === 0) return { ...res, status: 'erreur', message: 'Aucun match lu dans les pages du cache.' };

  const pSeason = seasonOfPoule(poule);
  if (pSeason && pSeason !== season) return { ...res, status: 'ignoree', message: `Poule de la saison ${pSeason}.` };

  const ours = clubEngagementsIn(poule);
  if (ours.length === 0) return { ...res, status: 'ignoree', message: 'Aucune équipe du club dans cette poule.' };

  const dates = poule.rencontres.map((r) => r.date_rencontre).filter(Boolean).sort() as string[];
  const startsOn = dates[0]?.slice(0, 10) ?? null;
  const endsOn = dates[dates.length - 1]?.slice(0, 10) ?? null;

  for (const eng of ours) {
    const ident = identifyTeam(poule.competitionName, eng.teamName);

    // 1) l'équipe du club (saison + code) ---------------------------------------------------
    const { data: existing, error: e1 } = await db.from('stats_club_teams').select('id, stats_team_id, logo_asset').eq('season', season).eq('code', ident.code).maybeSingle();
    if (e1) throw new Error(`Lecture des équipes : ${e1.message}`);
    let clubTeamId: string | null = existing?.id ?? null;
    let statsTeamId: string | null = existing?.stats_team_id ?? null;

    if (!statsTeamId) {
      const name = statsTeamName(ident.code, season);
      statsTeamId = statsByName.get(normName(name)) ?? null;
      if (!statsTeamId) {
        const { data: created, error: eT } = await db.from('stats_teams').insert({ name }).select('id').single();
        if (eT || !created) throw new Error(`Création de l'équipe TeamStats « ${name} » : ${eT?.message}`);
        statsTeamId = created.id as string;
        statsByName.set(normName(name), statsTeamId);
      }
    }
    const teamRow = {
      season, code: ident.code, label: ident.label, category: ident.category, sexe: ident.sexe, team_number: ident.numero,
      logo_asset: existing?.logo_asset || poule.competitionLogoAsset || null,
      stats_team_id: statsTeamId, last_sync_at: new Date().toISOString(),
    };
    if (clubTeamId) {
      const { error } = await db.from('stats_club_teams').update(teamRow).eq('id', clubTeamId);
      if (error) throw new Error(`Mise à jour de l'équipe : ${error.message}`);
    } else {
      const { data: ins, error } = await db.from('stats_club_teams').insert(teamRow).select('id').single();
      if (error || !ins) throw new Error(`Création de l'équipe : ${error?.message}`);
      clubTeamId = ins.id as string;
    }

    // 2) la phase (compétition + poule) -----------------------------------------------------
    const { data: ph, error: ePh } = await db.from('stats_club_phases').upsert({
      club_team_id: clubTeamId,
      phase_number: explicitPhaseNumber(poule.phaseLabel) || explicitPhaseNumber(poule.competitionName), // 0 = inconnu (déduit à l'affichage)
      competition_id: poule.competitionId,
      competition_name: poule.competitionName,
      competition_code: poule.competitionCode,
      competition_url: competitionUrl(poule.competitionCode, pouleId, poule.competitionId, poule.competitionPrefix),
      poule_id: pouleId,
      poule_label: poule.pouleNom,
      engagement_id: eng.engagementId,
      our_team_name: eng.teamName,
      logo_asset: poule.competitionLogoAsset,
      starts_on: startsOn,
      ends_on: endsOn,
      matches_count: poule.rencontres.length,
      cache_fetched_at: fetchedAt,
      last_sync_at: new Date().toISOString(),
    }, { onConflict: 'club_team_id,poule_id' }).select('id').single();
    if (ePh || !ph) throw new Error(`Enregistrement de la phase : ${ePh?.message}`);
    const phaseId = ph.id as string;

    // 3) les matchs : upsert (jamais « tout supprimer puis recréer ») + nettoyage des disparus --
    const rows = poule.rencontres.map((r) => {
      const t1 = r.engagement1 === eng.engagementId;
      const t2 = r.engagement2 === eng.engagementId;
      return {
        phase_id: phaseId,
        ffbb_rencontre_id: r.id,
        // Coupe : le « numéro de journée » FFBB est un numéro de match ; on enregistre le TOUR (déduit du nom de la compétition).
        numero_journee: isCup(poule.competitionName) ? String(cupTourNumber(poule.competitionName)) : r.numeroJournee,
        match_date: toTimestamp(r.date_rencontre),
        status: r.joue ? 'joue' : 'a_venir',
        team1_name: r.nomEquipe1, team1_score: r.resultatEquipe1, team1_logo_asset: r.logo1, team1_engagement_id: r.engagement1,
        team2_name: r.nomEquipe2, team2_score: r.resultatEquipe2, team2_logo_asset: r.logo2, team2_engagement_id: r.engagement2,
        us_is_team1: t1 ? true : t2 ? false : null,
        location: r.salle,
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('stats_club_matches').upsert(rows.slice(i, i + 200), { onConflict: 'phase_id,ffbb_rencontre_id' });
      if (error) throw new Error(`Écriture des matchs : ${error.message}`);
    }
    const { error: eDel } = await db.from('stats_club_matches').delete().eq('phase_id', phaseId)
      .not('ffbb_rencontre_id', 'in', `(${rows.map((r) => r.ffbb_rencontre_id).join(',')})`);
    if (eDel) throw new Error(`Nettoyage des matchs : ${eDel.message}`);

    // 4) le classement officiel (s'il est dans la page) ------------------------------------
    const standings = poule.classements.filter((c) => c.engagementId).map((c) => ({
      phase_id: phaseId, engagement_id: c.engagementId as string, engagement_nom: c.nom, position: c.position, points: c.points,
      matches_joues: c.matchJoues, gagnes: c.gagnes, perdus: c.perdus, is_us: c.engagementId === eng.engagementId,
      synced_at: new Date().toISOString(),
    }));
    if (standings.length > 0) {
      const { error: eS1 } = await db.from('stats_club_standings').delete().eq('phase_id', phaseId);
      if (eS1) throw new Error(`Nettoyage du classement : ${eS1.message}`);
      const { error: eS2 } = await db.from('stats_club_standings').insert(standings);
      if (eS2) throw new Error(`Écriture du classement : ${eS2.message}`);
    }
    res.teams.push(ident.label);
    res.matches += rows.length;
  }
  res.message = `${res.teams.join(', ')} — ${res.matches} match(s)`;
  return res;
}

export async function POST(req: Request) {
  try {
    const caller = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const season = currentSeason();

    if (body.action === 'list') {
      const { data, error } = await caller.db.from('ffbb_poule_cache').select('poule_id, fetched_at').order('poule_id');
      if (error) throw new HttpError(500, `Lecture du cache impossible : ${error.message}`);
      return NextResponse.json({ season, poules: data ?? [] });
    }

    // Images (assets) présentes dans les pages FFBB des poules données : l'admin choisit celle du niveau.
    if (body.action === 'assets') {
      const ids: string[] = Array.isArray(body.pouleIds) ? body.pouleIds.map(String).slice(0, 4) : [];
      if (ids.length === 0) throw new HttpError(400, 'Aucune poule demandée.');
      const { data: cached, error } = await caller.db.from('ffbb_poule_cache').select('poule_id, data').in('poule_id', ids);
      if (error) throw new HttpError(500, `Lecture du cache impossible : ${error.message}`);
      const merged = new Map<string, AssetCandidate>();
      for (const row of cached ?? []) {
        for (const html of Array.isArray((row as any).data?.pages) ? (row as any).data.pages : []) {
          if (typeof html !== 'string') continue;
          for (const c of findAssetCandidates(html)) {
            const m = merged.get(c.id);
            if (!m) merged.set(c.id, c);
            else { m.count += c.count; m.score = Math.max(m.score, c.score); for (const p of c.paths) if (m.paths.length < 3 && !m.paths.includes(p)) m.paths.push(p); }
          }
        }
      }
      const candidates = Array.from(merged.values()).sort((a, b) => b.score - a.score || a.count - b.count).slice(0, 16);
      return NextResponse.json({ candidates });
    }

    if (body.action === 'process') {
      const ids: string[] = Array.isArray(body.pouleIds) ? body.pouleIds.map(String).slice(0, 5) : [];
      if (ids.length === 0) throw new HttpError(400, 'Aucune poule demandée.');
      const { data: cached, error } = await caller.db.from('ffbb_poule_cache').select('poule_id, data, fetched_at').in('poule_id', ids);
      if (error) throw new HttpError(500, `Lecture du cache impossible : ${error.message}`);
      const { data: teams } = await caller.db.from('stats_teams').select('id, name');
      const statsByName = new Map<string, string>((teams ?? []).map((t: any) => [normName(t.name), t.id as string]));

      const results: PouleResult[] = [];
      for (const id of ids) {
        const row = (cached ?? []).find((c: any) => String(c.poule_id) === id);
        if (!row) { results.push({ pouleId: id, status: 'erreur', message: 'Absente du cache.', teams: [], matches: 0 }); continue; }
        try {
          results.push(await processPoule(caller.db, id, row.data, row.fetched_at, season, statsByName));
        } catch (e) {
          results.push({ pouleId: id, status: 'erreur', message: e instanceof Error ? e.message : String(e), teams: [], matches: 0 });
        }
      }
      return NextResponse.json({ results });
    }
    throw new HttpError(400, 'Action inconnue.');
  } catch (e) {
    return fail(e);
  }
}
