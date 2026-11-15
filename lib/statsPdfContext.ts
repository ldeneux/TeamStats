import { createContext, useContext } from 'react';

// Fourni par la page principale : génère le PDF des statistiques d'un match déjà enregistré (identifié par son
// n° de rencontre FFBB), sans toucher au match éventuellement en cours de saisie.
export interface StatsPdfApi {
  exportMatchStats: (ffbbRencontreId: string, usIsHome: boolean | null) => Promise<void>;
}
export const StatsPdfContext = createContext<StatsPdfApi | null>(null);
export const useStatsPdf = () => useContext(StatsPdfContext);
