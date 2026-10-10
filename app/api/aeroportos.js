// Lista de aeroportos com voos comerciais (função serverless da Vercel).
// Vem do OurAirports (domínio público). O arquivo original tem ~12 MB, então a função filtra
// e devolve só o necessário, guardando o resultado em memória e no cache da Vercel por um dia.

const URL_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const TIPOS = { large_airport: 'grande', medium_airport: 'medio' };

let emMemoria = null;

// Lê CSV com campos entre aspas (que podem ter vírgulas e aspas duplicadas dentro).
function lerCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function filtrar(texto) {
  const [cabecalho, ...linhas] = lerCsv(texto);
  const col = Object.fromEntries(cabecalho.map((nome, i) => [nome, i]));
  const aeroportos = [];
  for (const l of linhas) {
    const tipo = TIPOS[l[col.type]];
    const iata = l[col.iata_code];
    if (!tipo || !iata || l[col.scheduled_service] !== 'yes') continue;
    const icao = l[col.icao_code] || l[col.gps_code] || l[col.ident];
    if (!/^[A-Z]{4}$/.test(icao)) continue;
    aeroportos.push({
      icao, iata, tipo,
      nome: l[col.name],
      cidade: l[col.municipality],
      pais: l[col.iso_country],
      lat: Number(Number(l[col.latitude_deg]).toFixed(4)),
      lon: Number(Number(l[col.longitude_deg]).toFixed(4)),
    });
  }
  return aeroportos;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Intermediario');
  res.setHeader('X-Intermediario', '1');
  try {
    if (!emMemoria) {
      const r = await fetch(URL_CSV, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`OurAirports HTTP ${r.status}`);
      emMemoria = filtrar(await r.text());
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(emMemoria);
  } catch (e) {
    return res.status(502).json({ erro: `Não foi possível carregar os aeroportos: ${e.message}` });
  }
};

module.exports.filtrar = filtrar; // usado nos testes
