// Últimos voos que pousaram (ou decolaram) num aeroporto (função serverless da Vercel), via AeroDataBox (RapidAPI).
// A chave fica na variável de ambiente AERODATABOX_KEY do projeto na Vercel, nunca no código.
// Uso: /api/chegadas?icao=SBPA  ·  /api/chegadas?icao=SBPA&tipo=partidas

const HOST = 'aerodatabox.p.rapidapi.com';
const MAXIMO = 10;

// "2026-10-10 15:30-03:00" -> "15:30" (hora local do aeroporto)
const horaLocal = t => t?.local?.slice(11, 16) || '';
const instante = t => (t?.utc ? Date.parse(t.utc.trim().replace(' ', 'T')) : NaN);

// Formato atual: { scheduledTime: { utc, local } }. Formato antigo: scheduledTimeUtc / scheduledTimeLocal.
function tempo(mov, nome) {
  if (mov?.[nome]?.utc) return mov[nome];
  const utc = mov?.[`${nome}Utc`], local = mov?.[`${nome}Local`];
  return utc ? { utc, local } : null;
}

// Status que indicam que o voo ainda não pousou / não decolou (ou não vai acontecer).
const NAO_ACONTECEU = {
  chegadas: new Set(['Canceled', 'CanceledUncertain', 'Diverted', 'EnRoute', 'Approaching', 'Delayed', 'Departed', 'Boarding', 'GateClosed', 'CheckIn']),
  partidas: new Set(['Canceled', 'CanceledUncertain', 'Delayed', 'Boarding', 'GateClosed', 'CheckIn']),
};
const ACONTECEU = {
  chegadas: ['Arrived', 'Landed'],
  partidas: ['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Landed', 'Diverted'],
};

function normalizar(voo, tipo) {
  // Com withLeg=true vêm "departure" e "arrival"; sem ele, "movement" (cujo airport é o outro aeroporto).
  const aqui = (tipo === 'partidas' ? voo.departure : voo.arrival) || voo.movement || {};
  const outro = (tipo === 'partidas' ? voo.arrival?.airport : voo.departure?.airport) || voo.movement?.airport || {};
  const previsto = tempo(aqui, 'scheduledTime');
  const real = tempo(aqui, 'runwayTime') || tempo(aqui, 'revisedTime') || tempo(aqui, 'actualTime');
  const atrasoMin = Math.round((instante(real) - instante(previsto)) / 60000);
  return {
    numero: voo.number || voo.callSign || '',
    callsign: (voo.callSign || '').replace(/\s/g, ''),
    companhia: voo.airline?.name || '',
    outro: {
      iata: outro.iata || '',
      icao: outro.icao || '',
      cidade: outro.municipalityName || outro.shortName || outro.name || '',
    },
    previsto: horaLocal(previsto),
    real: horaLocal(real),
    // Muitos aeroportos só têm o horário programado; aí o pouso/decolagem não é confirmado.
    confirmado: !!real || ACONTECEU[tipo].includes(voo.status),
    atrasoMin: Number.isFinite(atrasoMin) ? atrasoMin : null,
    previstoUtc: instante(previsto) || null,
    status: voo.status || '',
    modelo: voo.aircraft?.model || '',
    matricula: voo.aircraft?.reg || '',
    hex: (voo.aircraft?.modeS || '').toLowerCase(),
    carga: !!voo.isCargo,
    _quando: Number.isFinite(instante(real)) ? instante(real) : instante(previsto),
  };
}

function ultimosVoos(json, tipo = 'chegadas', agora = Date.now()) {
  return (json[tipo === 'partidas' ? 'departures' : 'arrivals'] || [])
    .filter(v => v.codeshareStatus !== 'IsCodeshared' && !NAO_ACONTECEU[tipo].has(v.status))
    .map(v => normalizar(v, tipo))
    .filter(v => Number.isFinite(v._quando) && v._quando <= agora)
    .sort((a, b) => b._quando - a._quando)
    .slice(0, MAXIMO)
    .map(({ _quando, ...v }) => v);
}

// Resumo do que a API devolveu, para diagnóstico (/api/chegadas?icao=SBPA&debug=1). Não inclui a chave.
function resumo(json, tipo) {
  const arrivals = json[tipo === 'partidas' ? 'departures' : 'arrivals'] || [];
  const contar = f => arrivals.reduce((m, v) => { const k = f(v); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    chaves: Object.keys(json),
    total: arrivals.length,
    status: contar(v => v.status),
    codeshare: contar(v => v.codeshareStatus),
    exemplos: arrivals.slice(0, 2),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Intermediario');
  res.setHeader('X-Intermediario', '1');

  const icao = String(req.query.icao || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return res.status(400).json({ erro: 'Código ICAO inválido' });

  const tipo = req.query.tipo === 'partidas' ? 'partidas' : 'chegadas';
  const debug = req.query.debug === '1';
  const chave = process.env.AERODATABOX_KEY;
  if (!chave) return res.status(503).json({ erro: 'sem-chave' });

  // Janela relativa à hora local do aeroporto: das últimas 12 horas até agora.
  const params = new URLSearchParams({
    offsetMinutes: '-720', durationMinutes: '720', direction: tipo === 'partidas' ? 'Departure' : 'Arrival', withLeg: 'true',
    withCancelled: 'false', withCodeshared: 'false', withCargo: 'true', withPrivate: 'false', withLocation: 'false',
  });
  try {
    const r = await fetch(`https://${HOST}/flights/airports/icao/${icao}?${params}`, {
      headers: { 'X-RapidAPI-Key': chave, 'X-RapidAPI-Host': HOST },
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 204) return res.status(200).json({ icao, tipo, voos: [], ...(debug && { debug: 'HTTP 204 (sem conteúdo)' }) });
    if (!r.ok) {
      const motivo = { 401: 'chave inválida', 403: 'chave sem assinatura do AeroDataBox', 429: 'limite mensal do plano gratuito atingido' }[r.status];
      return res.status(502).json({ erro: `AeroDataBox HTTP ${r.status}${motivo ? ` (${motivo})` : ''}` });
    }
    // O plano gratuito tem poucas consultas por mês: 10 minutos de cache por aeroporto economizam.
    res.setHeader('Cache-Control', debug ? 'no-store' : 'public, s-maxage=600');
    const json = await r.json();
    return res.status(200).json({ icao, tipo, voos: ultimosVoos(json, tipo), ...(debug && { debug: resumo(json, tipo) }) });
  } catch (e) {
    return res.status(502).json({ erro: `Sem resposta do AeroDataBox: ${e.message}` });
  }
};

module.exports.ultimosVoos = ultimosVoos; // usado nos testes
