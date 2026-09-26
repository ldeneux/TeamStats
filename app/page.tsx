"use client";

import React, { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "multisports" },
});

export default function MatchPage() {
  // Onglet actif : "init" (Nouveau match) ou "live" (Saisie du match)
  const [activeTab, setActiveTab] = useState<"init" | "live">("init");
  const [showLoadModal, setShowLoadModal] = useState<boolean>(false);

  // Données du match
  const [matchId, setMatchId] = useState<string | null>(null);
  const [ffbbMatchId, setFfbbMatchId] = useState<string>("");
  const [searchFfbbId, setSearchFfbbId] = useState<string>("");
  const [matchDate, setMatchDate] = useState<string>("");
  const [scoreHome, setScoreHome] = useState<number>(0);
  const [scoreAway, setScoreAway] = useState<number>(0);

  // Chrono & Période
  const [period, setPeriod] = useState<string>("Q1");
  const [timer, setTimer] = useState<number>(600);

  // Équipes / Joueuses
  const [playersHome, setPlayersHome] = useState<any[]>([]);
  const [playersAway, setPlayersAway] = useState<any[]>([]);

  // États de chargement
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoadingMatch, setIsLoadingMatch] = useState<boolean>(false);

  // -------------------------------------------------------
  // 1. DÉMARRER UN NOUVEAU MATCH (RÉINITIALISATION)
  // -------------------------------------------------------
  const handleNewMatch = () => {
    if (confirm("Réinitialiser l'écran pour un nouveau match ?")) {
      setMatchId(null);
      setFfbbMatchId("");
      setMatchDate(new Date().toISOString().split("T")[0]);
      setScoreHome(0);
      setScoreAway(0);
      setPeriod("Q1");
      setTimer(600);
      setPlayersHome([]);
      setPlayersAway([]);
      setActiveTab("init");
    }
  };

  // -------------------------------------------------------
  // 2. REPRENDRE UN MATCH DEPUIS LA BDD
  // -------------------------------------------------------
  const handleLoadMatch = async () => {
    if (!searchFfbbId.trim()) {
      alert("Veuillez saisir un ID FFBB.");
      return;
    }

    setIsLoadingMatch(true);
    try {
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

      // Charger les joueuses associées
      const { data: playersData } = await supabase
        .from("stats_player_game_stats")
        .select("*")
        .eq("match_id", matchData.id);

      if (playersData) {
        setPlayersHome(playersData);
      }

      setShowLoadModal(false);
      setActiveTab("live");
      alert("Match chargé avec succès !");
    } catch (err: any) {
      console.error("Erreur chargement :", err);
      alert("Erreur lors du chargement du match.");
    } finally {
      setIsLoadingMatch(false);
    }
  };

  // -------------------------------------------------------
  // 3. SAUVEGARDER LE MATCH
  // -------------------------------------------------------
  const handleSaveMatch = async () => {
    if (!ffbbMatchId.trim()) {
      alert("L'ID FFBB est obligatoire.");
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

      const { error: matchErr } = await supabase
        .from("stats_matches")
        .upsert(matchPayload, { onConflict: "ffbb_match_id" });

      if (matchErr) throw matchErr;

      alert("Match enregistré !");
    } catch (err: any) {
      console.error("Erreur enregistrement :", err);
      alert("Erreur lors de l'enregistrement.");
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
    <div className="min-h-screen bg-slate-950 text-white p-4">
      {/* BARRE DE NAVIGATION ET DE COMMANDE PRINCIPALE */}
      <header className="max-w-6xl mx-auto bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏀</span>
          <h1 className="font-bold text-lg">Team Stats FFBB</h1>
        </div>

        <nav className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("init")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "init" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            ➕ Initialiser un Match
          </button>
          <button
            onClick={() => setActiveTab("live")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "live" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            📊 Saisie Direct / Live
          </button>
          <button
            onClick={() => setShowLoadModal(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-medium"
          >
            🔄 Reprendre un Match
          </button>
        </nav>
      </header>

      {/* CONTENU PRINCIPAL */}
      <main className="max-w-6xl mx-auto">
        {/* ONGLET 1 : INITIALISATION */}
        {activeTab === "init" && (
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 space-y-6">
            <h2 className="text-xl font-bold border-b border-slate-800 pb-3">
              Configuration du Nouveau Match
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">ID FFBB du Match</label>
                <input
                  type="text"
                  placeholder="ex: 200000014737341"
                  value={ffbbMatchId}
                  onChange={(e) => setFfbbMatchId(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date du Match</label>
                <input
                  type="date"
                  value={matchDate}
                  onChange={(e) => setMatchDate(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => {
                  if (!ffbbMatchId) return alert("Saisissez d'abord un ID FFBB");
                  setActiveTab("live");
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold"
              >
                Lancer la Saisie du Match →
              </button>
              <button
                onClick={handleNewMatch}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}

        {/* ONGLET 2 : DIRECT / SAISIE DES STATS */}
        {activeTab === "live" && (
          <div className="space-y-6">
            {/* SCOREBOARD / CHRONO */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 grid grid-cols-3 items-center text-center">
              <div>
                <span className="text-sm text-slate-400 block">Équipe Domicile</span>
                <input
                  type="number"
                  value={scoreHome}
                  onChange={(e) => setScoreHome(parseInt(e.target.value) || 0)}
                  className="w-20 text-center text-3xl font-bold bg-slate-950 border border-slate-700 rounded p-1 mt-1"
                />
              </div>

              <div>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="bg-slate-800 font-bold p-1 rounded mb-2 text-sm"
                >
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                  <option value="OT1">OT1</option>
                </select>
                <div className="text-4xl font-mono font-bold text-amber-400">
                  {formatTime(timer)}
                </div>
              </div>

              <div>
                <span className="text-sm text-slate-400 block">Équipe Extérieur</span>
                <input
                  type="number"
                  value={scoreAway}
                  onChange={(e) => setScoreAway(parseInt(e.target.value) || 0)}
                  className="w-20 text-center text-3xl font-bold bg-slate-950 border border-slate-700 rounded p-1 mt-1"
                />
              </div>
            </div>

            {/* ACTION : SAUVEGARDER */}
            <button
              onClick={handleSaveMatch}
              disabled={isSaving}
              className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-lg disabled:opacity-50"
            >
              {isSaving ? "Sauvegarde en cours..." : "💾 Sauvegarder le Match (BDD)"}
            </button>
          </div>
        )}
      </main>

      {/* MODAL : REPRENDRE UN MATCH */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-lg w-full space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">🔄 Reprendre un Match de la BDD</h3>
              <button
                onClick={() => setShowLoadModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-400">
              Saisissez l'ID FFBB pour restaurer les données et rouvrir le tableau de bord.
            </p>
            <input
              type="text"
              placeholder="ID FFBB (ex: 200000014737341)"
              value={searchFfbbId}
              onChange={(e) => setSearchFfbbId(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={handleLoadMatch}
                disabled={isLoadingMatch}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold disabled:opacity-50"
              >
                {isLoadingMatch ? "Chargement..." : "Charger"}
              </button>
              <button
                onClick={() => setShowLoadModal(false)}
                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
