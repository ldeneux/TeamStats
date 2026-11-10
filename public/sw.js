/* Service worker TeamStats : permet d'ouvrir l'application sans réseau (salles de sport).
   - Pages (navigation) : réseau d'abord, copie locale en secours.
   - Fichiers de l'application (/_next/static, images, PDF) : copie locale d'abord.
   - Les appels à Supabase (autre domaine) ne sont JAMAIS interceptés : la logique hors ligne est dans l'appli.
   La version vient de l'URL d'enregistrement (?v=...) : à chaque déploiement, l'ancien cache est supprimé. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'teamstats-' + VERSION;
const PRECACHE = ['/', '/manifest.webmanifest', '/logo-stats.png', '/icon-192.png', '/icon-512.png', '/mode-emploi-teamstats.pdf'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('teamstats-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Le premier chargement a eu lieu avant que le service worker ne contrôle la page : la page nous envoie
// la liste des fichiers déjà chargés pour qu'on les mette de côté.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'CACHE_URLS') return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all((event.data.urls || []).map((url) => cache.add(url).catch(() => undefined)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page de l'application : réseau d'abord ; hors ligne, dernière copie connue.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    );
    return;
  }

  // Fichiers statiques (noms hachés pour /_next/static : sans risque de version périmée).
  if (url.pathname.startsWith('/_next/static/') || /\.(png|jpe?g|svg|ico|woff2?|pdf|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
