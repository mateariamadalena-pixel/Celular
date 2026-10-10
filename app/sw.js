// Service worker mínimo: guarda a "casca" do app para abrir rápido e permitir instalação.
// Os dados de voo nunca são cacheados (sempre vêm da rede).
const CACHE = 'radar-v7';
const CASCA = ['./', 'index.html', 'style.css', 'app.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCA)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// Tocar numa notificação de alerta abre (ou traz para a frente) o app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs =>
    cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
