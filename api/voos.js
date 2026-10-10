// Intermediário para os dados de voo (função serverless da Vercel).
// O navegador do celular bloqueia chamadas diretas às APIs de ADS-B (CORS), então o app pede aqui,
// no mesmo endereço do site, e esta função busca os dados do lado do servidor.
// Só repassa pedidos para as fontes abaixo, para não virar um proxy aberto.

const HOSTS_PERMITIDOS = new Set([
  'api.adsb.lol',
  'api.airplanes.live',
  'opendata.adsb.fi',
  'opensky-network.org',
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Intermediario');
  res.setHeader('X-Intermediario', '1'); // o app usa isso para saber que o intermediário existe

  let alvo;
  try {
    alvo = new URL(req.query.url || '');
  } catch {
    return res.status(400).json({ erro: 'Parâmetro "url" inválido' });
  }
  if (alvo.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(alvo.hostname)) {
    return res.status(403).json({ erro: 'Fonte não permitida' });
  }

  try {
    const r = await fetch(alvo, {
      headers: { 'User-Agent': 'RadarDeVoos/1.0 (+https://github.com/mateariamadalena-pixel/Celular)' },
      signal: AbortSignal.timeout(8000),
    });
    const corpo = await r.text();
    // Um cache curto evita repetir a mesma consulta quando várias pessoas olham a mesma área.
    res.setHeader('Cache-Control', 'public, s-maxage=5');
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.status(r.status).send(corpo);
  } catch (e) {
    return res.status(502).json({ erro: `Sem resposta de ${alvo.hostname}: ${e.message}` });
  }
};
