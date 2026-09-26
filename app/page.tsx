"use client";

import React, { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "multisports" },
});

export default function MatchPage() {
  // Navigation / Vue (ex: 'search' ou 'dashboard')
  const [currentView, setCurrentView] = useState<"search" | "dashboard">("search");

  // Données Match
  const [matchId, setMatchId] = useState<string | null>(null);
  const [ffbbMatchId, setFfbbMatchId] = useState<string>("");
  const [searchFfbbId, setSearchFfbbId] = useState<string>("");
  const [matchDate, setMatchDate] = useState<string>("");
  const [scoreHome, setScoreHome] = useState<number>(0);
  const [scoreAway, setScoreAway] = useState<number>(0);

  // Chrono & Période
  const [period, setPeriod] = useState<string>("Q1");
  const [timer, setTimer] = useState<number>(600);

  // Effectifs
  const [players, setPlayers] = useState<any[]>([]);

  // Etats
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoadingMatch, setIsLoadingMatch] = useState<boolean>(false);

  // =======================================================
  // 1. REPRISE DU MATCH & CHARGEMENT DES JOUEUSES
  // =======================================================
  const handleLoadMatch = async () => {
    if (!searchFfbbId.trim()) {
      alert("Veuillez entrer un ID FFBB.");
      return;
    }

    setIsLoadingMatch(true);
    try {
      // 1. Récupérer le match
      const { data: matchData, error: matchErr } = await supabase
        .from("stats_matches")
        .select("*")
        .eq("ffbb_match_id", searchFfbbId.trim())
        .single();

      if (matchErr || !matchData) {
        alert("Aucun match trouvé avec cet ID FFBB.");
        setIsLoadingMatch(false);
        return;
      }

      setMatchId(matchData.id);
      setFfbbMatchId(matchData.ffbb_match_id || "");
      if (matchData.match_date) setMatchDate(matchData.match_date);
      setScoreHome(matchData.score_home ?? 0);
      setScoreAway(matchData.score_away ?? 0);
      if (matchData.current_period) setPeriod(matchData.current_period);
      if (matchData.current_timer !== null && matchData.current_timer !== undefined) {
        setTimer(matchData.current_timer);
      }

      // 2. Récupérer les joueuses associées à ce match
      const { data: playersData, error: playersErr } = await supabase
        .from("stats_player_game_stats")
        .select("*")
        .eq("match_id", matchData.id);

      if (!playersErr && playersData) {
        setPlayers(playersData);
      }

      alert("Match chargé avec succès !");
      
      // 👈 REDIRECTION VERS L'ÉCRAN PRINCIPAL
      setCurrentView("dashboard");

    } catch (err: any) {
      console.error("Erreur chargement :", err);
      alert("Erreur lors du chargement.");
    } finally {
      setIsLoadingMatch(false);
    }
  };

  // =======================================================
  // 2. SAUVEGARDE DU MATCH
  // =======================================================
  const handleSaveFullMatchToSupabase = async () => {
    if (!ffbbMatchId.trim()) {
      alert("Veuillez saisir un ID FFBB.");
      return;
    }

    setIsSaving(true);
    try {
      const matchPayload = {
        ffbb_match_id: ffbbMatchId.trim(),
        match_date: matchDate || new Date().toISOString().split("T")[0],
        score_home: scoreHome,
        score_away: scoreAway,
        current_period: period,
        current_timer: timer,
        updated_at: new Date().toISOString(),
      };

      const { data: matchData, error: matchErr } = await supabase
        .from("stats_matches")
        .upsert(matchPayload, { onConflict: "ffbb_match_id" })
        .select()
        .single();

      if (matchErr) throw matchErr;

      alert("Match sauvegardé !");
    } catch (err: any) {
      console.error("Erreur sauvegarde :", err);
      alert("Erreur lors de la sauvegarde.");
    } finally {
      setIsSaving(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-slate-900 rounded-xl">
      {/* VUE 1 : RECHERCHE / CHARGEMENT DU MATCH */}
      {currentView === "search" && (
        <section className="p-6 bg-slate-800 rounded-lg space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            🔄 Reprendre un Match de la BDD
          </h2>
          <p className="text-sm text-slate-300">
            Saisissez l'ID FFBB du match enregistré pour charger la partie.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID FFBB MATCH (ex: 200000014737341)"
              value={searchFfbbId}
              onChange={(e) => setSearchFfbbId(e.target.value)}
              className="p-3 bg-slate-950 border border-slate-700 rounded w-full text-white"
            />
            <button
              onClick={handleLoadMatch}
              disabled={isLoadingMatch}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {isLoadingMatch ? "Chargement..." : "Charger le Match"}
            </button>
          </div>
        </section>
      )}

      {/* VUE 2 : TABLEAU DE BORD DE SAISIE */}
      {currentView === "dashboard" && (
        <section className="p-6 bg-slate-800 rounded-lg space-y-6">
          <div className="flex justify-between items-center border-b border-slate-700 pb-4">
            <h2 className="text-xl font-bold">⚙️ Saisie du Match ({ffbbMatchId})</h2>
            <button
              onClick={() => setCurrentView("search")}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
            >
              ← Changer de match
            </button>
          </div>

          {/* CHRONO & SCORES */}
          <div className="flex justify-between items-center bg-slate-950 p-4 rounded-lg border border-slate-700">
            <div>
              <span className="text-sm text-slate-400 block">Période</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="bg-slate-800 text-white font-bold text-lg p-1 rounded"
              >
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
                <option value="OT1">OT1</option>
              </select>
            </div>

            <div className="text-center">
              <span className="text-sm text-slate-400 block">Chrono</span>
              <span className="text-3xl font-mono font-bold text-amber-400">
                {formatTime(timer)}
              </span>
            </div>

            <div className="text-right">
              <span className="text-sm text-slate-400 block">Score</span>
              <span className="text-xl font-bold">
                {scoreHome} - {scoreAway}
              </span>
            </div>
          </div>

          {/* LISTE DES JOUEUSES CHARGÉES */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
            <h3 className="font-bold mb-2 text-slate-300">
              Joueuses chargées ({players.length})
            </h3>
            {players.length === 0 ? (
              <p className="text-sm text-amber-400">
                Aucune joueuse rattachée à ce match dans `stats_player_game_stats`.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {players.map((p, idx) => (
                  <div key={idx} className="p-2 bg-slate-900 rounded border border-slate-800 flex justify-between">
                    <span>{p.player_name}</span>
                    <span className="font-bold text-indigo-400">#{p.player_number}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleSaveFullMatchToSupabase}
            disabled={isSaving}
            className="w-full py-3 bg-green-600 hover:bg-green-500 rounded font-bold text-lg disabled:opacity-50"
          >
            {isSaving ? "Enregistrement..." : "Sauvegarder les modifications"}
          </button>
        </section>
      )}
    </div>
  );
}
