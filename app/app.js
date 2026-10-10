// Radar de Voos — mapa de aviões em tempo real a partir de dados ADS-B públicos.
'use strict';

const INTERVALO_MS = 15000;          // OpenSky anônimo só atualiza a cada ~10 s
const CENTRO_PADRAO = [-23.55, -46.63]; // São Paulo
const FT_PARA_M = 0.3048;
const KT_PARA_KMH = 1.852;

// --- Fontes de dados -------------------------------------------------------
// Cada fonte devolve uma lista no mesmo formato "normalizado".

const FONTES = {
  // adsb.lol: rede comunitária, gratuita, sem chave. Consulta por raio (milhas náuticas, máx. 250).
  async adsblol(mapa) {
    const c = mapa.getCenter();
    const raioNm = Math.min(250, Math.ceil(c.distanceTo(mapa.getBounds().getNorthEast()) / 1852));
    const r = await fetch(`https://api.adsb.lol/v2/point/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}/${raioNm}`);
    if (!r.ok) throw new Error(`adsb.lol HTTP ${r.status}`);
    const { ac = [] } = await r.json();
    return ac.filter(a => a.lat != null && a.lon != null).map(a => ({
      id: a.hex,
      callsign: (a.flight || '').trim(),
      lat: a.lat,
      lon: a.lon,
      noSolo: a.alt_baro === 'ground',
      altitudeM: typeof a.alt_baro === 'number' ? a.alt_baro * FT_PARA_M : null,
      velocidadeKmh: a.gs != null ? a.gs * KT_PARA_KMH : null,
      rumo: a.track ?? a.true_heading ?? 0,
      subidaMs: a.baro_rate != null ? a.baro_rate * FT_PARA_M / 60 : null,
      matricula: a.r || '',
      modelo: a.t || '',
      pais: '',
      squawk: a.squawk || '',
    }));
  },

  // OpenSky Network: projeto de pesquisa. Consulta por retângulo; limite diário para uso anônimo.
  async opensky(mapa) {
    const b = mapa.getBounds();
    const q = `lamin=${b.getSouth()}&lomin=${b.getWest()}&lamax=${b.getNorth()}&lomax=${b.getEast()}`;
    const r = await fetch(`https://opensky-network.org/api/states/all?${q}`);
    if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
    const { states } = await r.json();
    return (states || []).filter(s => s[5] != null && s[6] != null).map(s => ({
      id: s[0],
      callsign: (s[1] || '').trim(),
      lat: s[6],
      lon: s[5],
      noSolo: s[8],
      altitudeM: s[7] ?? s[13],
      velocidadeKmh: s[9] != null ? s[9] * 3.6 : null,
      rumo: s[10] ?? 0,
      subidaMs: s[11],
      matricula: '',
      modelo: '',
      pais: s[2] || '',
      squawk: s[14] || '',
    }));
  },
};

// --- Mapa ------------------------------------------------------------------

const mapa = L.map('mapa', { zoomControl: false }).setView(CENTRO_PADRAO, 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap',
}).addTo(mapa);

const marcadores = new Map(); // id -> { marker, dados }
let selecionado = null;
let filtro = '';

const $ = id => document.getElementById(id);
const elFonte = $('fonte');
try { elFonte.value = localStorage.getItem('fonte') || elFonte.value; } catch {}

// Silhueta de avião apontando para o norte; girada pelo rumo (0° = norte).
const SVG_AVIAO = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" stroke="#000" stroke-width=".6" d="M12 2c.8 0 1.3.9 1.3 2v5l7.7 4.5v2l-7.7-2.3V18l2.2 1.7V21L12 20l-3.5 1v-1.3l2.2-1.7v-4.8L3 15.5v-2L10.7 9V4c0-1.1.5-2 1.3-2z"/></svg>';

function icone(v) {
  const classes = ['aviao', v.noSolo && 'solo', v.id === selecionado && 'sel'].filter(Boolean).join(' ');
  return L.divIcon({
    className: '',
    html: `<div class="${classes}" style="transform:rotate(${v.rumo || 0}deg)">${SVG_AVIAO}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function visivel(v) {
  if (!filtro) return true;
  return [v.callsign, v.matricula, v.id].some(t => t && t.toUpperCase().includes(filtro));
}

function desenhar(lista) {
  const vistos = new Set();
  for (const v of lista) {
    if (!visivel(v)) continue;
    vistos.add(v.id);
    const atual = marcadores.get(v.id);
    if (atual) {
      atual.dados = v;
      atual.marker.setLatLng([v.lat, v.lon]).setIcon(icone(v));
    } else {
      const marker = L.marker([v.lat, v.lon], { icon: icone(v) })
        .on('click', () => selecionar(v.id))
        .addTo(mapa);
      marcadores.set(v.id, { marker, dados: v });
    }
  }
  for (const [id, m] of marcadores) {
    if (!vistos.has(id)) { mapa.removeLayer(m.marker); marcadores.delete(id); }
  }
  if (selecionado) mostrarPainel(marcadores.get(selecionado)?.dados);
  return vistos.size;
}

// --- Painel de detalhes ----------------------------------------------------

const fmt = (n, casas = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas });

function selecionar(id) {
  const anterior = selecionado;
  selecionado = id;
  for (const k of [anterior, id]) {
    const m = k && marcadores.get(k);
    if (m) m.marker.setIcon(icone(m.dados));
  }
  mostrarPainel(marcadores.get(id)?.dados);
}

function mostrarPainel(v) {
  if (!v) { $('painel').classList.add('oculto'); return; }
  $('pCallsign').textContent = v.callsign || v.id.toUpperCase();
  const linhas = [
    ['Altitude', v.noSolo ? 'No solo' : `${fmt(v.altitudeM)} m (${fmt(v.altitudeM && v.altitudeM / FT_PARA_M)} ft)`],
    ['Velocidade', `${fmt(v.velocidadeKmh)} km/h`],
    ['Rumo', `${fmt(v.rumo)}°`],
    ['Razão vertical', v.subidaMs == null ? '—' : `${fmt(v.subidaMs, 1)} m/s`],
    ['Modelo', v.modelo || '—'],
    ['Matrícula', v.matricula || '—'],
    ['País de registro', v.pais || '—'],
    ['Transponder', `${v.id.toUpperCase()}${v.squawk ? ` · squawk ${v.squawk}` : ''}`],
  ];
  $('pDados').innerHTML = '';
  for (const [k, val] of linhas) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = val;
    $('pDados').append(dt, dd);
  }
  $('pLink').href = `https://globe.adsb.lol/?icao=${encodeURIComponent(v.id)}`;
  $('painel').classList.remove('oculto');
}

$('fechar').onclick = () => { selecionar(null); };

// --- Atualização periódica -------------------------------------------------

let ultimaLista = [];
let timer = null;
let emAndamento = false;

async function atualizar() {
  if (emAndamento) return;
  emAndamento = true;
  const fonte = elFonte.value;
  try {
    ultimaLista = await FONTES[fonte](mapa);
    const n = desenhar(ultimaLista);
    $('status').textContent = `${n} aviões · ${new Date().toLocaleTimeString('pt-BR')} · ${elFonte.selectedOptions[0].text}`;
  } catch (e) {
    $('status').textContent = `Erro ao buscar dados (${e.message}). Tentando de novo…`;
  } finally {
    emAndamento = false;
  }
}

function agendar() {
  clearInterval(timer);
  atualizar();
  timer = setInterval(() => { if (!document.hidden) atualizar(); }, INTERVALO_MS);
}

// Ao mover o mapa, espera o usuário parar antes de buscar a nova área.
let debounce;
mapa.on('moveend', () => { clearTimeout(debounce); debounce = setTimeout(atualizar, 800); });

elFonte.onchange = () => {
  try { localStorage.setItem('fonte', elFonte.value); } catch {}
  agendar();
};

$('busca').oninput = e => {
  filtro = e.target.value.trim().toUpperCase();
  desenhar(ultimaLista);
};

document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });

// --- Localização do usuário ------------------------------------------------

function irParaMinhaLocalizacao() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p => mapa.setView([p.coords.latitude, p.coords.longitude], 9),
    () => {},
    { timeout: 8000 },
  );
}
$('btnLocal').onclick = irParaMinhaLocalizacao;

// --- Início ----------------------------------------------------------------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
irParaMinhaLocalizacao();
agendar();
