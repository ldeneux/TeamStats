"use client";

import React, { useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Initialisation du client Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "multisports" },
});

export default function MatchPage() {
  // États du match
  const [ffbbMatchId, setFfbbMatchId] = useState<string>("");
  const [searchFfbbId, setSearchFfbbId] = useState<string>("");
  const [matchDate, setMatchDate] = useState<string>("");
  const [scoreHome, setScoreHome] = useState<number>(0);
  const [scoreAway, setScoreAway] = useState<number>(0);

  // États du chrono & période
  const [period, setPeriod] = useState<string>("Q1");
  const [timer, setTimer] = useState<number>(600); // Temps en secondes (ex: 600s = 10:00)
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // États de chargement
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoadingMatch, setIsLoadingMatch] = useState<boolean>(false);

  // =======================================================
  // 1. SAUVEGARDE DU MATCH (UPSERT + CHRONO & PERIODE)
  // =======================================================
  const handleSaveFullMatchToSupabase = async () => {
    if (!ffbbMatchId.trim()) {
      alert("Veuillez saisir un ID FFBB avant d'enregistrer.");
      return;
    }

    setIsSaving(true);
    try {
      const matchPayload = {
        ffbb_match_id: ffbbMatchId.trim(),
        match_date: matchDate || new Date().toISOString().split("T")[0],
        score_home: scoreHome,
        score_away: scoreAway,
        // Sauvegarde de l'avancement exact du match
        current_period: period,
        current_timer: timer,
        updated_at: new Date().toISOString(),
      };

      // Upsert basé sur la clé unique ffbb_match_id
      const { data: matchData, error: matchErr } = await supabase
        .from("stats_matches")
        .upsert(matchPayload, { onConflict: "ffbb_match_id" })
        .select()
        .single();

      if (matchErr) throw matchErr;

      alert("Match sauvegardé avec succès !");
    } catch (err: any) {
      console.error("Erreur lors de la sauvegarde :", err);
      alert(`Erreur lors de la sauvegarde : ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // =======================================================
  // 2. REPRISE DU MATCH (RESTAURATION COMPLETE DU MATCH)
  // =======================================================
  const handleLoadMatch = async () => {
    if (!searchFfbbId.trim()) {
      alert("Veuillez entrer un ID FFBB à rechercher.");
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

      // Restauration des informations du match
      setFfbbMatchId(matchData.ffbb_match_id || "");
      if (matchData.match_date) setMatchDate(matchData.match_date);
      setScoreHome(matchData.score_home ?? 0);
      setScoreAway(matchData.score_away ?? 0);

      // Restauration exacte du chrono et du quart de temps
      if (matchData.current_period) {
        setPeriod(matchData.current_period);
      }
      if (
        matchData.current_timer !== undefined &&
        matchData.current_timer !== null
      ) {
        setTimer(matchData.current_timer);
      }

      // Met le chrono en pause lors du chargement
      setIsRunning(false);

      alert("Match chargé avec succès !");
    } catch (err: any) {
      console.error("Erreur lors du chargement :", err);
      alert("Erreur lors du chargement du match.");
    } finally {
      setIsLoadingMatch(false);
    }
  };

  // Helper pour afficher le temps au format MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-slate-900 rounded-xl">
      {/* SECTION : REPRENDRE UN MATCH */}
      <section className="p-4 bg-slate-800 rounded-lg space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          🔄 Reprendre un Match de la BDD
        </h2>
        <p className="text-sm text-slate-300">
          Saisissez l'ID FFBB du match enregistré pour charger son score, sa
          période et son chrono.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ID FFBB MATCH (ex: 999)"
            value={searchFfbbId}
            onChange={(e) => setSearchFfbbId(e.target.value)}
            className="p-2 bg-slate-950 border border-slate-700 rounded w-full text-white"
          />
          <button
            onClick={handleLoadMatch}
            disabled={isLoadingMatch}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-semibold whitespace-nowrap disabled:opacity-50"
          >
            {isLoadingMatch ? "Chargement..." : "Charger le Match"}
          </button>
        </div>
      </section>

      {/* SECTION : ETAT ACTUEL ET TABLEAU DE BORD */}
      <section className="p-4 bg-slate-800 rounded-lg space-y-4">
        <h2 className="text-xl font-bold">⚙️ Gestion du Match</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400">ID FFBB Match</label>
            <input
              type="text"
              value={ffbbMatchId}
              onChange={(e) => setFfbbMatchId(e.target.value)}
              className="p-2 bg-slate-950 border border-slate-700 rounded w-full text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400">Date du Match</label>
            <input
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
              className="p-2 bg-slate-950 border border-slate-700 rounded w-full text-white"
            />
          </div>
        </div>

        {/* AFFICHAGE CHRONO & PERIODE */}
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

          <div>
            <span className="text-sm text-slate-400 block">Score</span>
            <span className="text-xl font-bold">
              {scoreHome} - {scoreAway}
            </span>
          </div>
        </div>

        {/* BOUTON DE SAUVEGARDE */}
        <button
          onClick={handleSaveFullMatchToSupabase}
          disabled={isSaving}
          className="w-full py-3 bg-green-600 hover:bg-green-500 rounded font-bold text-lg disabled:opacity-50"
        >
          {isSaving ? "Enregistrement..." : "Sauvegarder le Match"}
        </button>
      </section>
    </div>
  );
}