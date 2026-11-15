// sw.js — Service worker: guarda la app en el dispositivo para que funcione sin internet.
// IMPORTANTE: cada vez que cambies cualquier archivo de la app, sube VERSION (aquí y en js/app.js).
// Si no, los dispositivos seguirán usando la versión guardada.

const VERSION = '1.3.0';
const CACHE = 'msf-' + VERSION;
const ARCHIVOS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/almacen.js', './js/boveda.js', './js/copias.js', './js/cripto.js', './js/csv.js', './js/fiscal.js', './js/migracion.js', './js/modelo.js', './js/modelos.js',
  './iconos/icono-180.png', './iconos/icono-192.png', './iconos/icono-512.png', './iconos/icono-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('msf-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero lo guardado; la red solo si falta algo. Los datos del usuario nunca pasan por aquí.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
