'use client';

import { useEffect } from 'react';

// Enregistre le service worker (ouverture de l'appli sans réseau) et lui confie les fichiers déjà chargés.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const version = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev';
    // Pas de service worker en développement : il masquerait les modifications.
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(version)}`)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.startsWith(window.location.origin) && /\/_next\/static\//.test(name));
        registration.active?.postMessage({ type: 'CACHE_URLS', urls });
      })
      .catch((err) => console.error('Service worker :', err));
  }, []);

  return null;
}
