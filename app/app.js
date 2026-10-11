// Radar de Voos — mapa de aviões em tempo real a partir de dados ADS-B públicos.
'use strict';

const INTERVALO_MS = 15000;          // OpenSky anônimo só atualiza a cada ~10 s
const CENTRO_PADRAO = [-23.55, -46.63]; // São Paulo
const RAIO_ACIMA_KM = 40;            // área consultada em volta do usuário para o cartão "Acima de você"
const FT_PARA_M = 0.3048;
const KT_PARA_KMH = 1.852;

// Códigos de transponder que indicam situação anormal.
const SQUAWKS_EMERGENCIA = {
  7500: 'Interferência ilícita (sequestro)',
  7600: 'Falha de comunicação por rádio',
  7700: 'Emergência geral',
};
const EMERGENCIAS_ADSB = {
  general: 'Emergência geral', lifeguard: 'Emergência médica', minfuel: 'Combustível mínimo',
  nordo: 'Falha de comunicação por rádio', unlawful: 'Interferência ilícita (sequestro)', downed: 'Aeronave em pane',
};

// Prefixo do callsign (código ICAO da companhia) -> nome que as pessoas reconhecem.
const COMPANHIAS = {
  TAM: 'LATAM', LAN: 'LATAM', LPE: 'LATAM Peru', LCO: 'LATAM Cargo', GLO: 'GOL', AZU: 'Azul',
  PTB: 'Passaredo', VOE: 'Voepass', MWM: 'Modern Logistics', TTL: 'Total Linhas Aéreas',
  AAL: 'American Airlines', UAL: 'United', DAL: 'Delta', AFR: 'Air France', KLM: 'KLM',
  DLH: 'Lufthansa', BAW: 'British Airways', IBE: 'Iberia', TAP: 'TAP', UAE: 'Emirates',
  QTR: 'Qatar Airways', THY: 'Turkish Airlines', ARG: 'Aerolíneas Argentinas', AVA: 'Avianca',
  CMP: 'Copa Airlines', SKU: 'Sky Airline', JAT: 'JetSMART', ETH: 'Ethiopian', ITY: 'ITA Airways',
  SWR: 'Swiss', AEA: 'Air Europa', ACA: 'Air Canada', FDX: 'FedEx', UPS: 'UPS',
  FAB: 'Força Aérea Brasileira',
};

// Código ICAO do tipo -> nome do modelo.
const MODELOS = {
  A319: 'Airbus A319', A320: 'Airbus A320', A20N: 'Airbus A320neo', A321: 'Airbus A321',
  A21N: 'Airbus A321neo', A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900neo',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380',
  B737: 'Boeing 737-700', B738: 'Boeing 737-800', B38M: 'Boeing 737 MAX 8', B739: 'Boeing 737-900',
  B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77W: 'Boeing 777-300ER', B77L: 'Boeing 777F',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', B744: 'Boeing 747-400', B748: 'Boeing 747-8',
  E190: 'Embraer E190', E195: 'Embraer E195', E295: 'Embraer E195-E2', E175: 'Embraer E175',
  E145: 'Embraer ERJ-145', E55P: 'Embraer Phenom 300', E50P: 'Embraer Phenom 100',
  AT72: 'ATR 72', AT75: 'ATR 72-500', AT76: 'ATR 72-600', AT45: 'ATR 42-500', AT46: 'ATR 42-600',
  C208: 'Cessna Caravan', C172: 'Cessna 172', PC12: 'Pilatus PC-12', BE20: 'King Air 200',
  AS50: 'Helicóptero Esquilo', EC30: 'Helicóptero H130', R44: 'Helicóptero Robinson R44',
  R66: 'Helicóptero Robinson R66', A109: 'Helicóptero AW109', A119: 'Helicóptero AW119',
  S76: 'Helicóptero Sikorsky S-76', EC35: 'Helicóptero H135', B06: 'Helicóptero Bell 206',
};

// --- Fontes de dados -------------------------------------------------------
// Cada fonte recebe uma área circular { lat, lon, raioKm } e devolve uma lista "normalizada".

// adsb.lol, airplanes.live e adsb.fi usam o mesmo formato (o do programa "readsb").
function lerReadsb(json) {
  const ac = json.ac || json.aircraft || [];
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
    emergencia: EMERGENCIAS_ADSB[a.emergency] || SQUAWKS_EMERGENCIA[a.squawk] || '',
  }));
}

const raioEmNm = raioKm => Math.min(250, Math.max(1, Math.ceil(raioKm / 1.852)));

// Intermediário no próprio site (api/voos.js, publicado na Vercel). Ele existe porque o navegador
// do celular bloqueia chamadas diretas às APIs (CORS). Onde não existe (ex.: GitHub Pages),
// o app volta a chamar as fontes diretamente.
const URL_INTERMEDIARIO = '/api/voos';
let intermediarioExiste = true;

async function baixar(url) {
  const opcoes = AbortSignal.timeout ? { signal: AbortSignal.timeout(10000) } : {};
  if (intermediarioExiste) {
    const r = await fetch(`${URL_INTERMEDIARIO}?url=${encodeURIComponent(url)}`, opcoes);
    if (r.headers.get('X-Intermediario')) return r;
    intermediarioExiste = false;
  }
  return fetch(url, opcoes);
}

async function buscarJson(nome, url) {
  let r;
  try {
    r = await baixar(url);
  } catch (e) {
    // No navegador, "Failed to fetch"/"Load failed" quase sempre é bloqueio de CORS ou falta de rede.
    throw new Error(`${nome}: sem resposta (${e.name === 'TimeoutError' ? 'demorou demais' : e.message})`);
  }
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.json();
}

const fixo = n => n.toFixed(4);

const FONTES = {
  // Redes comunitárias, gratuitas e sem chave. Consulta por raio (milhas náuticas, máx. 250).
  async adsblol({ lat, lon, raioKm }) {
    return lerReadsb(await buscarJson('adsb.lol',
      `https://api.adsb.lol/v2/point/${fixo(lat)}/${fixo(lon)}/${raioEmNm(raioKm)}`));
  },

  async airplaneslive({ lat, lon, raioKm }) {
    return lerReadsb(await buscarJson('airplanes.live',
      `https://api.airplanes.live/v2/point/${fixo(lat)}/${fixo(lon)}/${raioEmNm(raioKm)}`));
  },

  async adsbfi({ lat, lon, raioKm }) {
    return lerReadsb(await buscarJson('adsb.fi',
      `https://opendata.adsb.fi/api/v2/lat/${fixo(lat)}/lon/${fixo(lon)}/dist/${raioEmNm(raioKm)}`));
  },

  // OpenSky Network: projeto de pesquisa. Consulta por retângulo; limite diário para uso anônimo.
  async opensky({ lat, lon, raioKm }) {
    const dLat = raioKm / 111;
    const dLon = raioKm / (111 * Math.cos(lat * Math.PI / 180));
    const q = `lamin=${lat - dLat}&lomin=${lon - dLon}&lamax=${lat + dLat}&lomax=${lon + dLon}`;
    const { states } = await buscarJson('OpenSky', `https://opensky-network.org/api/states/all?${q}`);
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
      emergencia: SQUAWKS_EMERGENCIA[s[14]] || '',
    }));
  },
};

// --- Utilidades ------------------------------------------------------------

const $ = id => document.getElementById(id);
const fmt = (n, casas = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const escapar = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const rad = g => g * Math.PI / 180;

function distanciaKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function azimute(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
            Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const pontoCardeal = g => ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(g / 45) % 8];

function nomeCompanhia(v) {
  const prefixo = /^[A-Z]{3}\d/.test(v.callsign) ? v.callsign.slice(0, 3) : '';
  return COMPANHIAS[prefixo] || '';
}

function nomeAmigavel(v) {
  const cia = nomeCompanhia(v);
  const voo = v.callsign || v.matricula || v.id.toUpperCase();
  return cia ? `${cia} · ${voo}` : voo;
}

const nomeModelo = v => MODELOS[v.modelo] || v.modelo;

// --- Mapa ------------------------------------------------------------------

const mapa = L.map('mapa', { zoomControl: false }).setView(CENTRO_PADRAO, 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap',
}).addTo(mapa);

const marcadores = new Map(); // id -> { marker, dados }
let selecionado = null;
let filtro = '';
let minhaPos = null;          // { lat, lon }
let marcadorEu = null;

const elFonte = $('fonte');
try { elFonte.value = localStorage.getItem('fonteEscolhida') || elFonte.value; } catch {}

// Silhueta de avião apontando para o norte; girada pelo rumo (0° = norte).
const SVG_AVIAO = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" stroke="#000" stroke-width=".6" d="M12 2c.8 0 1.3.9 1.3 2v5l7.7 4.5v2l-7.7-2.3V18l2.2 1.7V21L12 20l-3.5 1v-1.3l2.2-1.7v-4.8L3 15.5v-2L10.7 9V4c0-1.1.5-2 1.3-2z"/></svg>';

function icone(v) {
  const classes = ['aviao', v.noSolo && 'solo', v.emergencia && 'emerg', ehSeguido(v) && 'seg', v.id === selecionado && 'sel']
    .filter(Boolean).join(' ');
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
  if (selecionado) mostrarPainel(dadosDe(selecionado));
  return vistos.size;
}

// --- Rota e foto -----------------------------------------------------------
// Rota (origem → destino) pelo callsign no adsbdb; foto pelo transponder no Planespotters
// (com fallback para o adsbdb). Ficam em cache porque não mudam durante o voo.

const rotas = new Map(); // callsign -> rota | null (null = sem rota conhecida)
const fotos = new Map(); // id -> foto | null
const buscandoRota = new Map();
const buscandoFoto = new Map();

const ehVooComercial = v => /^[A-Z]{3}\d/.test(v.callsign);

function lerAeroporto(a) {
  return a && {
    iata: a.iata_code || a.icao_code || '', cidade: a.municipality || a.name || '', nome: a.name || '',
    lat: a.latitude ?? null, lon: a.longitude ?? null,
  };
}

function buscarRota(v) {
  if (!ehVooComercial(v)) return Promise.resolve(null);
  const cs = v.callsign;
  if (rotas.has(cs)) return Promise.resolve(rotas.get(cs));
  if (!buscandoRota.has(cs)) {
    buscandoRota.set(cs, buscarJson('adsbdb', `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`)
      .then(j => {
        const r = j?.response?.flightroute;
        return r?.origin && r?.destination ? { origem: lerAeroporto(r.origin), destino: lerAeroporto(r.destination) } : null;
      })
      .catch(() => null)
      .then(rota => { rotas.set(cs, rota); buscandoRota.delete(cs); return rota; }));
  }
  return buscandoRota.get(cs);
}

// Busca pelo código do transponder (hex) ou, se não houver, pela matrícula (ex.: PR-GUT).
function buscarFoto({ id, matricula }) {
  const planespottersUrl = id ? `hex/${encodeURIComponent(id)}` : matricula && `reg/${encodeURIComponent(matricula)}`;
  if (!planespottersUrl) return Promise.resolve(null);
  const chave = id || `reg:${matricula}`;
  if (fotos.has(chave)) return Promise.resolve(fotos.get(chave));
  if (!buscandoFoto.has(chave)) {
    const planespotters = buscarJson('Planespotters', `https://api.planespotters.net/pub/photos/${planespottersUrl}`)
      .then(j => {
        const f = j?.photos?.[0];
        return f && {
          src: (f.thumbnail_large || f.thumbnail).src,
          mini: (f.thumbnail || f.thumbnail_large).src,
          link: f.link,
          fotografo: f.photographer,
          credito: `Foto: ${f.photographer} · Planespotters.net`,
        };
      })
      .catch(() => null);
    // O adsbdb aceita tanto o hex quanto a matrícula.
    buscandoFoto.set(chave, planespotters
      .then(f => f || buscarJson('adsbdb', `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(id || matricula)}`)
        .then(j => {
          const a = j?.response?.aircraft;
          const src = a?.url_photo_thumbnail || a?.url_photo;
          return src && { src: a.url_photo || src, mini: src, link: a.url_photo || src, fotografo: 'airport-data.com', credito: 'Foto: airport-data.com' };
        })
        .catch(() => null))
      .then(f => { fotos.set(chave, f || null); buscandoFoto.delete(chave); return f || null; }));
  }
  return buscandoFoto.get(chave);
}

const textoRota = (r, comCodigo) => r
  ? [r.origem, r.destino].map(a => comCodigo && a.iata ? `${a.cidade} (${a.iata})` : a.cidade).join(' → ')
  : '';

// --- Painel de detalhes ----------------------------------------------------

// O avião pode estar no cartão "Acima de você" sem estar na área visível do mapa.
const dadosDe = id => marcadores.get(id)?.dados || listaPerto.find(v => v.id === id);

function selecionar(id) {
  const anterior = selecionado;
  selecionado = id;
  for (const k of [anterior, id]) {
    const m = k && marcadores.get(k);
    if (m) m.marker.setIcon(icone(m.dados));
  }
  const v = id && dadosDe(id);
  mostrarPainel(v);
  if (v && id !== anterior) carregarExtras(v);
}

// Foto e rota chegam depois; só preenche se o avião ainda for o selecionado.
function carregarExtras(v) {
  const foto = $('pFoto'), rota = $('pRota');
  foto.hidden = true;
  foto.innerHTML = '';
  rota.textContent = ehVooComercial(v) ? 'Buscando rota…' : '';
  buscarRota(v).then(r => {
    if (selecionado !== v.id) return;
    rota.textContent = r ? textoRota(r, true) : (ehVooComercial(v) ? 'Rota não encontrada' : '');
  });
  buscarFoto(v).then(f => {
    if (selecionado !== v.id || !f) return;
    const a = document.createElement('a');
    a.href = f.link; a.target = '_blank'; a.rel = 'noopener';
    const img = document.createElement('img');
    img.src = f.src; img.alt = `Foto da aeronave ${v.matricula || v.id.toUpperCase()}`;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { foto.hidden = true; };
    const credito = document.createElement('small');
    credito.textContent = f.credito;
    a.append(img);
    foto.append(a, credito);
    foto.hidden = false;
  });
}

function mostrarPainel(v) {
  if (!v) { $('painel').classList.add('oculto'); return; }
  aeroportoAberto = null;
  $('pLista').hidden = true;
  $('pDados').hidden = false;
  $('pLink').hidden = false;
  $('pSeguir').hidden = false;
  $('pSeguir').textContent = ehSeguido(v) ? '★ Seguindo — toque para parar' : '⭐ Seguir este voo';
  $('pCallsign').textContent = nomeAmigavel(v);
  const linhas = [
    ['Situação', v.emergencia || (v.noSolo ? 'No solo' : 'Em voo')],
    ['Altitude', v.noSolo ? '—' : `${fmt(v.altitudeM)} m (${fmt(v.altitudeM && v.altitudeM / FT_PARA_M)} ft)`],
    ['Velocidade', `${fmt(v.velocidadeKmh)} km/h`],
    ['Rumo', `${fmt(v.rumo)}° (${pontoCardeal(v.rumo || 0)})`],
    ['Razão vertical', v.subidaMs == null ? '—' : `${fmt(v.subidaMs, 1)} m/s`],
    ['Modelo', nomeModelo(v) || '—'],
    ['Matrícula', v.matricula || '—'],
    ['País de registro', v.pais || '—'],
    ['Transponder', `${v.id.toUpperCase()}${v.squawk ? ` · squawk ${v.squawk}` : ''}`],
  ];
  if (minhaPos) linhas.splice(1, 0, ['Distância de você', `${fmt(distanciaKm(minhaPos, v), 1)} km`]);
  $('pDados').innerHTML = '';
  for (const [k, val] of linhas) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = val;
    $('pDados').append(dt, dd);
  }
  $('pLink').href = `https://globe.adsb.lol/?icao=${encodeURIComponent(v.id)}`;
  $('painel').classList.remove('oculto');
}

$('fechar').onclick = () => { aeroportoAberto = null; selecionar(null); };

// --- Aeroportos e chegadas -------------------------------------------------
// A lista de aeroportos e as chegadas vêm de funções do próprio site na Vercel
// (api/aeroportos.js e api/chegadas.js); no GitHub Pages esses recursos não existem.

const camadaAeroportos = L.layerGroup().addTo(mapa);
let aeroportos = [];
let aeroportoAberto = null;
const chegadasEmCache = new Map(); // icao -> { quando, dados }
const CACHE_CHEGADAS_MS = 5 * 60 * 1000;

async function buscarDoSite(caminho) {
  const r = await fetch(caminho, AbortSignal.timeout ? { signal: AbortSignal.timeout(20000) } : {});
  if (!r.headers.get('X-Intermediario')) throw new Error('so-na-vercel');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

function desenharAeroportos() {
  camadaAeroportos.clearLayers();
  const z = mapa.getZoom();
  if (z < 5) return;
  const area = mapa.getBounds().pad(0.1);
  for (const a of aeroportos) {
    // Com o mapa afastado, só os grandes; os médios aparecem ao aproximar.
    if ((a.tipo === 'medio' && z < 7) || !area.contains([a.lat, a.lon])) continue;
    L.marker([a.lat, a.lon], {
      icon: L.divIcon({ className: '', html: `<div class="aero ${a.tipo}">${escapar(a.iata)}</div>`, iconSize: [40, 20], iconAnchor: [20, 10] }),
      zIndexOffset: -1000,
      title: a.nome,
    }).on('click', () => abrirAeroporto(a)).addTo(camadaAeroportos);
  }
}

buscarDoSite('/api/aeroportos').then(lista => { aeroportos = lista; desenharAeroportos(); }).catch(() => {});
mapa.on('moveend', desenharAeroportos);

function textoAtraso(min) {
  if (min == null) return '';
  if (min >= 5) return `<span class="atrasado">${min} min de atraso</span>`;
  if (min <= -5) return `<span class="adiantado">${-min} min adiantado</span>`;
  return '<span class="adiantado">no horário</span>';
}

// --- Pousos e decolagens vistos pelo radar ---------------------------------
// O AeroDataBox muitas vezes só tem o horário programado. Quando o próprio app vê um avião baixo
// perto de um aeroporto, descendo ou subindo, guarda o horário (por 24 h, no aparelho) para
// confirmar o pouso/decolagem na lista do aeroporto.

const CHAVE_EVENTOS = 'eventosRadar';
const VALIDADE_EVENTOS_MS = 24 * 3600 * 1000;
let eventosRadar = [];
try { eventosRadar = JSON.parse(localStorage.getItem(CHAVE_EVENTOS) || '[]').filter(e => Date.now() - e.quando < VALIDADE_EVENTOS_MS); } catch {}
const estadoAnterior = new Map(); // id -> { noSolo }

const normalizarMatricula = m => (m || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const horaDoAparelho = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function aeroportoProximo(p, raioKm) {
  const dLat = raioKm / 111;
  let melhor = null, melhorKm = raioKm;
  for (const a of aeroportos) {
    if (Math.abs(a.lat - p.lat) > dLat || Math.abs(a.lon - p.lon) > dLat * 2) continue;
    const km = distanciaKm(p, a);
    if (km <= melhorKm) { melhor = a; melhorKm = km; }
  }
  return melhor;
}

function registrarEventos(lista) {
  const agora = Date.now();
  let mudou = false;
  for (const v of lista) {
    const antes = estadoAnterior.get(v.id);
    estadoAnterior.set(v.id, { noSolo: v.noSolo });
    const baixo = v.noSolo || (v.altitudeM != null && v.altitudeM < 600);
    if (!baixo || !aeroportos.length) continue;
    const a = aeroportoProximo(v, 8);
    if (!a) continue;
    let tipo = null;
    if (v.noSolo) tipo = antes && !antes.noSolo ? 'pouso' : null;
    else if (antes?.noSolo || v.subidaMs > 1) tipo = 'decolagem';
    else if (v.subidaMs < -1) tipo = 'pouso';
    if (!tipo) continue;
    const existente = eventosRadar.find(e => e.id === v.id && e.icao === a.icao && e.tipo === tipo && agora - e.quando < 30 * 60000);
    if (existente) {
      // No pouso vale a última observação (mais perto do toque na pista); na decolagem, a primeira.
      if (tipo === 'pouso') { existente.quando = agora; mudou = true; }
      continue;
    }
    eventosRadar.push({ id: v.id, reg: normalizarMatricula(v.matricula), icao: a.icao, tipo, quando: agora });
    mudou = true;
  }
  if (mudou) {
    eventosRadar = eventosRadar.filter(e => agora - e.quando < VALIDADE_EVENTOS_MS).slice(-500);
    try { localStorage.setItem(CHAVE_EVENTOS, JSON.stringify(eventosRadar)); } catch {}
  }
}

function eventoDoRadar(voo, icao, tipo) {
  const reg = normalizarMatricula(voo.matricula);
  return eventosRadar
    .filter(e => e.icao === icao && e.tipo === tipo && ((voo.hex && e.id === voo.hex) || (reg && e.reg === reg)) &&
      (!voo.previstoUtc || Math.abs(e.quando - voo.previstoUtc) < 3 * 3600000))
    .sort((a, b) => b.quando - a.quando)[0];
}

// --- Lista de chegadas / partidas ------------------------------------------

function htmlVoo(v, tipo, icao) {
  const chegada = tipo === 'chegadas';
  const outro = v.outro || v.origem || {}; // "origem" era o nome antigo (respostas ainda em cache)
  const lugar = outro.cidade ? `${outro.cidade}${outro.iata ? ` (${outro.iata})` : ''}` : (outro.iata || '—');
  const aviao = [v.modelo, v.matricula, v.carga && 'carga'].filter(Boolean).join(' · ');
  const noMapa = v.hex && marcadores.has(v.hex);
  const real = v.real || v.pousou;
  const verbo = chegada ? 'pousou' : 'decolou';
  const radar = !real && eventoDoRadar(v, icao, chegada ? 'pouso' : 'decolagem');
  let hora, situacao;
  if (real) {
    hora = `${verbo} ${escapar(real)}`;
    situacao = `${v.previsto ? ` · previsto ${escapar(v.previsto)}` : ''} · ${textoAtraso(v.atrasoMin)}`;
  } else if (radar) {
    hora = `${verbo} ~${horaDoAparelho(radar.quando)}`;
    situacao = ` · previsto ${escapar(v.previsto)} · <span class="adiantado">✔ visto pelo radar</span>`;
  } else {
    hora = `previsto ${escapar(v.previsto)}`;
    situacao = v.confirmado ? '' : ` · <span class="sem-conf">${chegada ? 'pouso não confirmado' : 'decolagem não confirmada'}</span>`;
  }
  return `<li${noMapa ? ` data-id="${escapar(v.hex)}" class="no-mapa"` : ''}>
    <div class="miniatura" data-hex="${escapar(v.hex)}" data-reg="${escapar(v.matricula)}">${SVG_AVIAO}</div>
    <div class="info">
    <div class="cab"><strong>${escapar(v.numero)}</strong> <span>${escapar(v.companhia)}</span>
      <span class="hora">${hora}</span></div>
    <div class="sub">${chegada ? 'de' : 'para'} ${escapar(lugar)}${situacao}</div>
    ${aviao ? `<div class="sub">${escapar(aviao)}${noMapa ? ' · <b>ver no mapa ›</b>' : ''}</div>` : ''}
    </div>
  </li>`;
}

let abaAberta = 'chegadas';
let aeroportoObj = null;

// Áudio da torre: só um link para o LiveATC (os termos deles não permitem tocar as
// transmissões dentro de outro app). Muitos aeroportos brasileiros não têm transmissão.
// Frequências: página oficial do aeródromo no AISWEB (DECEA), que só cobre o Brasil.
const ehAeroportoBrasileiro = a => a.pais === 'BR' || /^S[BDIJNSW][A-Z]{2}$/.test(a.icao);

function htmlLinksAeroporto(a) {
  const icao = encodeURIComponent(a.icao);
  return `<div class="links-aero">
      <a class="btn-ouvir" href="https://www.liveatc.net/search/?icao=${icao}" target="_blank" rel="noopener">🎧 Ouvir torre ↗</a>
      ${ehAeroportoBrasileiro(a) ? `<a class="btn-freq" href="https://aisweb.decea.mil.br/?i=aerodromos&codigo=${icao}" target="_blank" rel="noopener">📋 Frequências ↗</a>` : ''}
    </div>
    <p class="nota nota-ouvir">Áudio pelo LiveATC (nem todo aeroporto tem)${ehAeroportoBrasileiro(a) ? ' · frequências oficiais no AISWEB/DECEA' : ''}.</p>`;
}

function htmlAbas(tipo) {
  return `<div class="abas">${['chegadas', 'partidas'].map(t =>
    `<button data-aba="${t}"${t === tipo ? ' class="ativa"' : ''}>${t === 'chegadas' ? 'Chegadas' : 'Partidas'}</button>`).join('')}</div>`;
}

async function abrirAeroporto(a, tipo = 'chegadas') {
  selecionar(null);
  aeroportoAberto = a.icao;
  aeroportoObj = a;
  abaAberta = tipo;
  $('pCallsign').textContent = `${a.cidade || a.nome} (${a.iata})`;
  $('pRota').textContent = a.nome;
  $('pFoto').hidden = true;
  $('pDados').hidden = true;
  $('pLink').hidden = true;
  $('pSeguir').hidden = true;
  const lista = $('pLista');
  lista.hidden = false;
  lista.innerHTML = htmlLinksAeroporto(a) + htmlAbas(tipo) + '<p class="nota">Buscando…</p>';
  $('painel').classList.remove('oculto');

  const chave = `${a.icao}:${tipo}`;
  const aindaAberto = () => aeroportoAberto === a.icao && abaAberta === tipo;
  try {
    let c = chegadasEmCache.get(chave);
    if (!c || Date.now() - c.quando > CACHE_CHEGADAS_MS) {
      c = { quando: Date.now(), dados: await buscarDoSite(`/api/chegadas?icao=${a.icao}${tipo === 'partidas' ? '&tipo=partidas' : ''}`) };
      chegadasEmCache.set(chave, c);
    }
    if (!aindaAberto()) return;
    const voos = c.dados.voos || [];
    lista.innerHTML = htmlLinksAeroporto(a) + htmlAbas(tipo) + (voos.length
      ? `<ol>${voos.map(v => htmlVoo(v, tipo, a.icao)).join('')}</ol><p class="nota">Horários locais do aeroporto · dados: AeroDataBox</p>`
      : `<p class="nota">Nenhum voo ${tipo === 'partidas' ? 'decolou daqui' : 'pousou aqui'} nas últimas 12 horas.</p>`);
    preencherMiniaturas(lista, a.icao);
  } catch (e) {
    if (!aindaAberto()) return;
    const msg = {
      'so-na-vercel': 'As chegadas e partidas só funcionam na versão publicada na Vercel.',
      'sem-chave': 'Falta configurar a chave do AeroDataBox na Vercel (variável AERODATABOX_KEY).',
    }[e.message] || `Não foi possível buscar os voos (${e.message}).`;
    lista.innerHTML = htmlLinksAeroporto(a) + htmlAbas(tipo) + `<p class="nota">${escapar(msg)}</p>`;
  }
}

// As fotos chegam uma a uma; enquanto isso (ou se não houver foto) fica o desenho do avião.
function preencherMiniaturas(lista, icao) {
  for (const el of lista.querySelectorAll('.miniatura')) {
    buscarFoto({ id: el.dataset.hex, matricula: el.dataset.reg }).then(f => {
      if (!f || aeroportoAberto !== icao) return;
      const a = document.createElement('a');
      a.href = f.link; a.target = '_blank'; a.rel = 'noopener';
      const img = document.createElement('img');
      img.src = f.mini; img.alt = `Foto da aeronave ${el.dataset.reg}`; img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => a.remove();
      const credito = document.createElement('small');
      credito.textContent = `© ${f.fotografo}`;
      a.append(img, credito);
      el.replaceChildren(a);
      el.classList.add('com-foto');
    });
  }
}

$('pLista').onclick = e => {
  if (e.target.closest('a')) return; // tocar na foto abre a página dela
  const aba = e.target.closest('[data-aba]')?.dataset.aba;
  if (aba) { if (aba !== abaAberta && aeroportoObj) abrirAeroporto(aeroportoObj, aba); return; }
  const id = e.target.closest('[data-id]')?.dataset.id;
  const m = id && marcadores.get(id);
  if (!m) return;
  mapa.setView(m.marker.getLatLng(), Math.max(mapa.getZoom(), 9));
  selecionar(id);
};

// --- "Acima de você" -------------------------------------------------------

let listaPerto = [];
let rumoCelular = null; // para onde o topo do celular aponta (0° = norte), quando a bússola está ativa

function maisProximos() {
  if (!minhaPos) return [];
  return listaPerto
    .filter(v => !v.noSolo)
    .map(v => ({ v, km: distanciaKm(minhaPos, v), az: azimute(minhaPos, v) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 4);
}

function descreverCeu(km, altitudeM) {
  if (altitudeM == null) return '';
  // Ângulo de elevação: quão alto no céu você precisa olhar.
  const elev = Math.atan2(altitudeM / 1000, km) * 180 / Math.PI;
  if (elev > 70) return 'bem em cima de você';
  if (elev > 35) return `olhe para cima, ${Math.round(elev)}° acima do horizonte`;
  if (elev > 10) return `${Math.round(elev)}° acima do horizonte`;
  return 'perto do horizonte';
}

function renderizarAcima() {
  const el = $('acimaConteudo');
  if (!minhaPos) {
    el.className = 'vazio';
    el.textContent = 'Ative a localização para ver o avião que está passando sobre você.';
    return;
  }
  const lista = maisProximos();
  if (!lista.length) {
    el.className = 'vazio';
    el.textContent = `Nenhum avião em voo num raio de ${RAIO_ACIMA_KM} km agora.`;
    return;
  }
  const [{ v, km, az }, ...resto] = lista;
  // Com bússola, a seta aponta para o avião em relação ao celular; sem ela, em relação ao norte.
  const giro = rumoCelular == null ? az : az - rumoCelular;
  // A rota vem de outra consulta: mostra se já está no cache; senão busca e redesenha quando chegar.
  const rotaDestaque = rotas.get(v.callsign);
  if (ehVooComercial(v) && !rotas.has(v.callsign)) buscarRota(v).then(r => { if (r) renderizarAcima(); });
  const detalhes = [nomeModelo(v), v.altitudeM != null && `${fmt(v.altitudeM)} m de altitude`].filter(Boolean).join(' · ');
  el.className = '';
  el.innerHTML = `
    <div class="destaque${v.emergencia ? ' emerg' : ''}" data-id="${escapar(v.id)}">
      <div class="seta"><i style="transform:rotate(${giro}deg)"><svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M12 2l7 18-7-4-7 4z"/></svg></i><small>${rumoCelular == null ? 'N ↑' : ''}</small></div>
      <div>
        <div class="nome">${escapar(nomeAmigavel(v))}</div>
        ${v.emergencia ? `<div class="linha">⚠ ${escapar(v.emergencia)}</div>` : ''}
        ${rotaDestaque ? `<div class="linha rota">${escapar(textoRota(rotaDestaque, false))}</div>` : ''}
        <div class="linha">${escapar(detalhes)}</div>
        <div class="linha">${fmt(km, 1)} km a ${pontoCardeal(az)} · ${escapar(descreverCeu(km, v.altitudeM))}</div>
      </div>
    </div>
    <div class="outros">${resto.map(o =>
      `<button data-id="${escapar(o.v.id)}">${escapar(o.v.callsign || o.v.id.toUpperCase())} ${fmt(o.km, 0)} km</button>`).join('')}</div>`;
}

$('acimaConteudo').onclick = e => {
  const id = e.target.closest('[data-id]')?.dataset.id;
  const v = id && dadosDe(id);
  if (!v) return;
  mapa.setView([v.lat, v.lon], Math.max(mapa.getZoom(), 10));
  selecionar(id);
};

// Bússola: no iPhone é preciso pedir permissão a partir de um toque.
async function ativarBussola() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return aviso('Este aparelho não tem bússola.', 'info');
  if (typeof DOE.requestPermission === 'function') {
    try { if (await DOE.requestPermission() !== 'granted') return; } catch { return; }
  }
  const aoGirar = e => {
    let r = null;
    if (e.webkitCompassHeading != null) r = e.webkitCompassHeading;  // iOS
    else if (e.absolute && e.alpha != null) r = 360 - e.alpha;      // Android
    if (r == null) return;
    rumoCelular = r;
    const seta = document.querySelector('.seta i');
    const destaque = maisProximos()[0];
    if (seta && destaque) seta.style.transform = `rotate(${destaque.az - r}deg)`;
    const n = document.querySelector('.seta small');
    if (n) n.textContent = '';
  };
  window.addEventListener('deviceorientationabsolute', aoGirar);
  window.addEventListener('deviceorientation', aoGirar);
  $('btnBussola').classList.add('ativo');
  aviso('Bússola ativa: a seta aponta para o avião. Segure o celular deitado.', 'info');
}
$('btnBussola').onclick = ativarBussola;

// --- Alertas ---------------------------------------------------------------

const CONFIG_PADRAO = { perto: false, raioKm: 5, emergencias: true };
let config = { ...CONFIG_PADRAO };
try { Object.assign(config, JSON.parse(localStorage.getItem('alertas') || '{}')); } catch {}

const jaAvisados = new Map(); // "tipo:id" -> horário do último aviso
const REPETIR_APOS_MS = 30 * 60 * 1000;

function atualizarBotaoAlertas() {
  $('btnAlertas').classList.toggle('ativo', config.perto || config.emergencias);
}

$('btnAlertas').onclick = () => {
  $('alPerto').checked = config.perto;
  $('alRaio').value = String(config.raioKm);
  $('alEmergencia').checked = config.emergencias;
  $('dlgAlertas').showModal();
};

$('dlgAlertas').addEventListener('close', async () => {
  config = { perto: $('alPerto').checked, raioKm: Number($('alRaio').value), emergencias: $('alEmergencia').checked };
  try { localStorage.setItem('alertas', JSON.stringify(config)); } catch {}
  atualizarBotaoAlertas();
  if ((config.perto || config.emergencias) && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => {});
  }
  if (config.perto && !minhaPos) aviso('Ative a localização para receber avisos de aviões por perto.', 'info');
});

let timerAviso;
function aviso(texto, tipo = '') {
  const t = $('toast');
  t.textContent = texto;
  t.className = `toast ${tipo}`;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => t.classList.add('oculto'), 6000);
}

async function notificar(chave, titulo, corpo, emergencia) {
  const agora = Date.now();
  if (agora - (jaAvisados.get(chave) || 0) < REPETIR_APOS_MS) return;
  jaAvisados.set(chave, agora);

  aviso(`${titulo} — ${corpo}`, emergencia ? '' : 'info');
  if (navigator.vibrate) navigator.vibrate(emergencia ? [300, 100, 300, 100, 300] : 200);
  // Notificação do sistema só faz sentido quando o app não está na tela.
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const opcoes = { body: corpo, tag: chave, icon: 'icon.svg', badge: 'icon.svg' };
    if (reg) await reg.showNotification(titulo, opcoes);
    else new Notification(titulo, opcoes);
  } catch {}
}

function verificarAlertas(lista) {
  for (const v of lista) {
    const km = minhaPos ? distanciaKm(minhaPos, v) : null;
    if (config.emergencias && v.emergencia) {
      const onde = km == null ? '' : ` a ${fmt(km, 0)} km de você`;
      notificar(`emerg:${v.id}`, `⚠ ${v.emergencia}`, `${nomeAmigavel(v)}${onde}`, true);
    }
    if (config.perto && km != null && !v.noSolo && km <= config.raioKm) {
      const altura = v.altitudeM != null ? ` a ${fmt(v.altitudeM)} m de altitude` : '';
      notificar(`perto:${v.id}`, `✈ ${nomeAmigavel(v)} passando perto`,
        `${nomeModelo(v) || 'Avião'}${altura}, ${fmt(km, 1)} km a ${pontoCardeal(azimute(minhaPos, v))}`, false);
    }
  }
}

// --- Seguir um voo --------------------------------------------------------
// Segue pelo número do voo (convertido para o callsign usado no ADS-B) ou pelo transponder.
// Mostra uma barra com a rota e a hora prevista de chegada, avisa quando está chegando e quando
// pousa, e gera um link para mandar no WhatsApp. Fica salvo no aparelho até parar de seguir.

// Número de voo como aparece no bilhete (código IATA da companhia) -> prefixo do callsign (ICAO).
const IATA_PARA_ICAO = {
  G3: ['GLO'], LA: ['TAM', 'LAN'], JJ: ['TAM'], AD: ['AZU'], '2Z': ['PTB'], AA: ['AAL'], UA: ['UAL'],
  DL: ['DAL'], AF: ['AFR'], KL: ['KLM'], LH: ['DLH'], BA: ['BAW'], IB: ['IBE'], TP: ['TAP'], EK: ['UAE'],
  QR: ['QTR'], TK: ['THY'], AR: ['ARG'], AV: ['AVA'], CM: ['CMP'], H2: ['SKU'], JA: ['JAT'], ET: ['ETH'],
  AZ: ['ITY'], LX: ['SWR'], UX: ['AEA'], AC: ['ACA'],
};

function callsignsDe(texto) {
  const t = texto.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-Z]{3}\d{1,4}[A-Z]?$/.test(t)) return [t]; // já é callsign (ex.: GLO1280)
  const m = t.match(/^([A-Z0-9]{2})0*(\d{1,4}[A-Z]?)$/);
  return m && IATA_PARA_ICAO[m[1]] ? IATA_PARA_ICAO[m[1]].map(prefixo => prefixo + m[2]) : [];
}

const CHAVE_SEGUIDO = 'vooSeguido';
let seguido = null;
try { seguido = JSON.parse(localStorage.getItem(CHAVE_SEGUIDO) || 'null'); } catch {}

function salvarSeguido() {
  try {
    if (seguido) localStorage.setItem(CHAVE_SEGUIDO, JSON.stringify(seguido));
    else localStorage.removeItem(CHAVE_SEGUIDO);
  } catch {}
}

function ehSeguido(v) {
  return !!seguido && ((seguido.hex && v.id === seguido.hex) || seguido.callsigns.includes(v.callsign));
}

function seguirVoo({ callsigns = [], hex = '', nome = '' }) {
  seguido = { callsigns, hex, nome: nome || callsigns[0] || hex.toUpperCase(), desde: Date.now(),
    voando: false, perto: null, sumiuVezes: 0, pousou: null, avisouChegando: false, rota: null, ultimo: null };
  salvarSeguido();
  renderizarSeguido();
  mostrarPainel(selecionado && dadosDe(selecionado));
  aviso(`Seguindo ${seguido.nome}. O app avisa quando ele estiver chegando e quando pousar.`, 'info');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  atualizar();
}

function pararDeSeguir() {
  seguido = null;
  salvarSeguido();
  renderizarSeguido();
  if (selecionado) mostrarPainel(dadosDe(selecionado));
  desenhar(ultimaLista);
}

// Fontes que permitem procurar um avião em qualquer lugar do mundo por callsign ou transponder.
const FONTES_BUSCA = [
  ['adsb.lol', 'https://api.adsb.lol/v2'],
  ['airplanes.live', 'https://api.airplanes.live/v2'],
  ['adsb.fi', 'https://opendata.adsb.fi/api/v2'],
];

async function procurarSeguido() {
  const caminhos = seguido.hex ? [`hex/${seguido.hex}`] : seguido.callsigns.map(c => `callsign/${c}`);
  for (const [nome, base] of FONTES_BUSCA) {
    try {
      for (const c of caminhos) {
        const lista = lerReadsb(await buscarJson(nome, `${base}/${c}`));
        if (lista.length) return lista[0];
      }
      return null; // a fonte respondeu: o voo não está no ar (ou está fora da cobertura das antenas)
    } catch {}
  }
  return null;
}

function marcarPouso(quando, lugar) {
  seguido.pousou = { quando, lugar: lugar || seguido.rota?.destino?.cidade || '' };
  const onde = seguido.pousou.lugar ? ` em ${seguido.pousou.lugar}` : '';
  notificar(`seguido-pouso:${seguido.nome}`, `✔ ${seguido.nome} pousou${onde}`, `Às ${horaDoAparelho(quando)}`, false);
}

async function atualizarSeguido(unicos) {
  if (!seguido || seguido.pousou) return null;
  const v = [...unicos.values()].find(ehSeguido) || await procurarSeguido();
  if (!seguido) return null; // parou de seguir enquanto buscava
  const agora = Date.now();
  if (v) {
    if (!seguido.hex) seguido.hex = v.id; // depois de achar, segue também pelo transponder
    const rota = await buscarRota(v);
    if (rota) seguido.rota = rota;
    const destino = seguido.rota?.destino?.lat != null ? seguido.rota.destino : null;
    const kmDestino = destino ? distanciaKm(v, destino) : null;
    seguido.sumiuVezes = 0;
    if (v.noSolo) {
      if (seguido.voando) marcarPouso(agora, aeroportoProximo(v, 10)?.cidade);
    } else {
      seguido.voando = true;
      if (kmDestino != null && kmDestino < 50 && !seguido.avisouChegando) {
        seguido.avisouChegando = true;
        notificar(`seguido-chegando:${seguido.nome}`, `✈ ${seguido.nome} está chegando`,
          `A ${fmt(kmDestino)} km de ${destino.cidade}`, false);
      }
      // Baixo e perto de um aeroporto: se sumir do radar logo depois, é porque pousou
      // (as antenas raramente veem o avião no chão).
      const aeroporto = v.altitudeM != null && v.altitudeM < 1000 && (v.subidaMs ?? -1) <= 0 &&
        (destino && kmDestino < 20 ? destino : aeroportoProximo(v, 20));
      seguido.perto = aeroporto ? { quando: agora, lugar: aeroporto.cidade } : null;
    }
    seguido.ultimo = { ...v, kmDestino, visto: agora };
  } else if (seguido.voando) {
    seguido.sumiuVezes++;
    if (seguido.perto && seguido.sumiuVezes >= 2) marcarPouso(seguido.perto.quando, seguido.perto.lugar);
  }
  salvarSeguido();
  return v;
}

function renderizarSeguido() {
  const el = $('seguindo');
  document.body.classList.toggle('com-seguido', !!seguido);
  if (!seguido) { el.hidden = true; return; }
  el.hidden = false;
  const u = seguido.ultimo;
  const r = seguido.rota;
  let linha;
  if (seguido.pousou) {
    linha = `✔ Pousou${seguido.pousou.lugar ? ` em ${seguido.pousou.lugar}` : ''} às ~${horaDoAparelho(seguido.pousou.quando)}`;
  } else if (!u) {
    linha = 'Aguardando o voo aparecer no radar…';
  } else if (u.noSolo) {
    linha = 'No solo, aguardando a decolagem';
  } else {
    const partes = [];
    if (u.kmDestino != null) {
      partes.push(`faltam ${fmt(u.kmDestino)} km`);
      if (u.velocidadeKmh > 150) partes.push(`chega ~${horaDoAparelho(u.visto + u.kmDestino / u.velocidadeKmh * 3600000)}`);
    } else {
      partes.push(`${fmt(u.altitudeM)} m · ${fmt(u.velocidadeKmh)} km/h`);
    }
    if (Date.now() - u.visto > 90000) partes.push(`visto às ${horaDoAparelho(u.visto)}`);
    linha = partes.join(' · ');
  }
  if (r && !seguido.pousou) linha = `${textoRota(r, false)} · ${linha}`;
  el.querySelector('.seg-titulo').textContent = `⭐ ${u ? nomeAmigavel(u) : seguido.nome}`;
  el.querySelector('.seg-linha').textContent = linha;
}

$('segTexto').onclick = () => {
  const u = seguido?.ultimo;
  if (!u) return;
  mapa.setView([u.lat, u.lon], Math.max(mapa.getZoom(), 8));
  if (marcadores.has(u.id)) selecionar(u.id);
};
$('segParar').onclick = pararDeSeguir;
$('segWhats').onclick = () => {
  if (!seguido) return;
  const ref = seguido.callsigns[0] ? `voo=${encodeURIComponent(seguido.callsigns[0])}` : `hex=${encodeURIComponent(seguido.hex)}`;
  const link = `${location.origin}${location.pathname}?${ref}`;
  const rota = seguido.rota ? ` (${textoRota(seguido.rota, false)})` : '';
  const texto = `Acompanhe o voo ${seguido.ultimo ? nomeAmigavel(seguido.ultimo) : seguido.nome}${rota} ao vivo: ${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
};

$('pSeguir').onclick = () => {
  const v = selecionado && dadosDe(selecionado);
  if (!v) return;
  if (ehSeguido(v)) pararDeSeguir();
  else seguirVoo({ callsigns: v.callsign ? [v.callsign] : [], hex: v.id, nome: nomeAmigavel(v) });
};

// Na busca, Enter segue o voo digitado (ex.: "G3 1280", "AD4050", "GLO1280").
$('busca').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const texto = e.target.value.trim();
  if (!texto) return;
  const callsigns = callsignsDe(texto);
  if (!callsigns.length) { aviso('Para seguir, digite o número do voo, ex.: G3 1280 ou AD 4050.', 'info'); return; }
  e.target.value = '';
  e.target.blur();
  filtro = '';
  seguirVoo({ callsigns, nome: texto.toUpperCase() });
});

// --- Atualização periódica -------------------------------------------------

let ultimaLista = [];
let timer = null;
let emAndamento = false;
let repetir = false; // pediram atualização enquanto outra estava em andamento (ex.: chegou a localização)

function areaDoMapa() {
  const c = mapa.getCenter();
  return { lat: c.lat, lon: c.lng, raioKm: c.distanceTo(mapa.getBounds().getNorthEast()) / 1000 };
}

// No modo automático, a última fonte que funcionou é tentada primeiro; se falhar, passa para a próxima.
const ORDEM_AUTOMATICA = ['adsblol', 'airplaneslive', 'adsbfi', 'opensky'];
let fonteQueFuncionou = null;

async function buscarComReserva() {
  const escolhida = elFonte.value;
  const ordem = escolhida === 'auto'
    ? [fonteQueFuncionou, ...ORDEM_AUTOMATICA].filter((f, i, a) => f && a.indexOf(f) === i)
    : [escolhida];
  const erros = [];
  for (const chave of ordem) {
    const fonte = FONTES[chave];
    try {
      const [doMapa, perto] = await Promise.all([
        fonte(areaDoMapa()),
        minhaPos ? fonte({ ...minhaPos, raioKm: RAIO_ACIMA_KM }) : [],
      ]);
      fonteQueFuncionou = chave;
      return { doMapa, perto, nome: elFonte.querySelector(`option[value="${chave}"]`).text };
    } catch (e) {
      erros.push(e.message);
    }
  }
  throw new Error(erros.join(' | '));
}

async function atualizar() {
  if (emAndamento) { repetir = true; return; }
  emAndamento = true;
  repetir = false;
  try {
    const { doMapa, perto, nome } = await buscarComReserva();
    const unicos = new Map([...doMapa, ...perto].map(v => [v.id, v]));
    // O voo seguido aparece no mapa mesmo fora da área visível.
    const vSeguido = await atualizarSeguido(unicos).catch(() => null);
    if (vSeguido) unicos.set(vSeguido.id, vSeguido);
    ultimaLista = vSeguido && !doMapa.some(v => v.id === vSeguido.id) ? [...doMapa, vSeguido] : doMapa;
    listaPerto = perto;
    const n = desenhar(ultimaLista);
    renderizarAcima();
    renderizarSeguido();
    registrarEventos(unicos.values());
    verificarAlertas(unicos.values());
    $('status').textContent = `${n} aviões · ${new Date().toLocaleTimeString('pt-BR')} · ${nome}`;
  } catch (e) {
    $('status').textContent = `Erro ao buscar dados — ${e.message}. Tentando de novo…`;
    if (minhaPos && !listaPerto.length) {
      $('acimaConteudo').className = 'vazio';
      $('acimaConteudo').textContent = 'Não foi possível buscar os aviões agora. Tentando de novo…';
    }
  } finally {
    emAndamento = false;
    if (repetir) atualizar();
  }
}

function agendar() {
  clearInterval(timer);
  atualizar();
  // Em segundo plano só continua buscando dados se houver alertas que possam virar notificação.
  timer = setInterval(() => {
    const notifica = 'Notification' in window && Notification.permission === 'granted';
    const vigiando = config.perto || config.emergencias || (seguido && !seguido.pousou);
    if (!document.hidden || (notifica && vigiando)) atualizar();
  }, INTERVALO_MS);
}

// Ao mover o mapa, espera o usuário parar antes de buscar a nova área.
let debounce;
mapa.on('moveend', () => { clearTimeout(debounce); debounce = setTimeout(atualizar, 800); });

elFonte.onchange = () => {
  try { localStorage.setItem('fonteEscolhida', elFonte.value); } catch {}
  agendar();
};

$('busca').oninput = e => {
  filtro = e.target.value.trim().toUpperCase();
  desenhar(ultimaLista);
};

document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });

// --- Localização do usuário ------------------------------------------------

function novaPosicao(p, centralizar) {
  const primeira = !minhaPos;
  minhaPos = { lat: p.coords.latitude, lon: p.coords.longitude };
  const ll = [minhaPos.lat, minhaPos.lon];
  if (marcadorEu) marcadorEu.setLatLng(ll);
  else marcadorEu = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#38bdf8', fillOpacity: 1 }).addTo(mapa);
  if (centralizar || primeira) mapa.setView(ll, Math.max(mapa.getZoom(), 9));
  if (primeira) atualizar();
}

function irParaMinhaLocalizacao() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p => novaPosicao(p, true), () => {}, { timeout: 8000 });
}
$('btnLocal').onclick = irParaMinhaLocalizacao;

// --- Início ----------------------------------------------------------------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
atualizarBotaoAlertas();

// Link compartilhado: ?voo=GLO1280 ou ?hex=e48a1b abre o app já seguindo o voo.
{
  const params = new URLSearchParams(location.search);
  const voo = params.get('voo'), hex = (params.get('hex') || '').toLowerCase();
  const callsigns = voo ? callsignsDe(voo) : [];
  if (callsigns.length) seguirVoo({ callsigns, nome: voo.toUpperCase() });
  else if (/^[0-9a-f]{6}$/.test(hex)) seguirVoo({ hex });
  if (voo || hex) history.replaceState(null, '', location.pathname);
}
renderizarSeguido();
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(p => novaPosicao(p, false), () => renderizarAcima(),
    { enableHighAccuracy: false, maximumAge: 60000 });
}
agendar();
