# Celular
Uso pessoal

## Radar de Voos (`app/`)

Um aplicativo para celular que mostra aviões em tempo real num mapa, parecido com o Flightradar24.
É um **PWA** (Progressive Web App): roda no navegador do celular e pode ser "instalado" na tela
inicial como se fosse um app, sem precisar de loja ou de compilar nada.

### Como funciona o rastreamento de aviões

1. **ADS-B**: quase todo avião comercial tem um transponder que, cerca de 2 vezes por segundo,
   transmite por rádio (1090 MHz) a própria posição (tirada do GPS), altitude, velocidade, rumo
   e um código único (endereço ICAO de 24 bits). Ninguém precisa "perguntar": o avião transmite
   para quem estiver ouvindo.
2. **Receptores em terra**: qualquer pessoa pode captar esses sinais com uma antena e um
   receptor barato (ex.: Raspberry Pi + pendrive SDR). O alcance é de uns 250–400 km, até a linha
   do horizonte. Flightradar24, FlightAware, OpenSky e adsb.lol são redes de **milhares de
   voluntários** com esses receptores, que mandam os dados pela internet para um servidor central.
3. **Satélites (Space-based ADS-B)**: sobre oceanos, desertos e florestas não há receptores em
   terra. Por isso empresas como a **Aireon** colocaram receptores ADS-B nos satélites Iridium
   NEXT (órbita baixa, ~780 km). O satélite **não localiza** o avião por radar: ele só "escuta" a
   mesma mensagem ADS-B em que o avião já informa a posição de GPS, e retransmite para a terra.
   O Flightradar24 compra parte desses dados de satélite.
4. **MLAT (multilateração)**: aviões com transponder mais antigo (Modo S sem posição) são
   localizados comparando o instante exato em que o mesmo sinal chega em 4 ou mais receptores —
   a diferença de tempo permite calcular onde ele está (como um GPS ao contrário).
5. **Dados complementares**: rota, origem/destino e companhia vêm de bancos de dados de voos
   e de horários das companhias, cruzados com o código de chamada (callsign, ex.: `TAM3054`).

### De onde este app tira os dados

| Fonte | Custo | Observações |
|-------|-------|-------------|
| [adsb.lol](https://api.adsb.lol) | Grátis, sem cadastro | Rede comunitária, dados abertos (ODbL) |
| [airplanes.live](https://airplanes.live/api-guide/) | Grátis, sem cadastro | Rede comunitária, uso não comercial |
| [adsb.fi](https://github.com/adsbfi/opendata) | Grátis, sem cadastro | Rede comunitária, uso não comercial |
| [OpenSky Network](https://opensky-network.org) | Grátis para uso não comercial | Uso anônimo tem limite diário de consultas |

Para **origem/destino** o app consulta o [adsbdb](https://www.adsbdb.com) pelo código do voo, e
para a **foto da aeronave** o [Planespotters.net](https://www.planespotters.net) pelo código do
transponder (com o adsbdb como reserva). A foto sempre mostra o crédito do fotógrafo e leva à
página original, como o Planespotters pede.

No modo **Automático** (padrão), o app tenta as fontes nessa ordem e fica com a primeira que
responder. Se todas falharem, o erro de cada uma aparece no canto superior esquerdo.

O Flightradar24 também tem API, mas ela é paga.

### O diferencial: "Acima de você"

Na parte de baixo da tela fica sempre o avião mais próximo de você, em linguagem simples:
companhia e voo ("LATAM · TAM3054"), modelo ("Airbus A320"), altitude, distância, direção
(N, NE, L…) e quanto você precisa olhar para cima ("28° acima do horizonte").

- **Seta/bússola (🧭)**: ao ativar, a seta passa a apontar para o avião de acordo com a direção
  em que o celular está virado. Sem bússola, a seta é relativa ao norte.
- **Alertas (🔔)**:
  - *Avião passando perto*: avisa quando um avião em voo chega a 2, 5 ou 10 km de você.
  - *Emergências*: avisa quando algum avião na área declara emergência (squawk 7700),
    falha de rádio (7600) ou sequestro (7500). Esses aviões aparecem em vermelho no mapa.
  - Os avisos aparecem na tela, vibram o celular e, com o app em segundo plano, viram
    notificação do sistema. Como não há servidor, eles só funcionam enquanto o app estiver
    aberto ou em segundo plano recente (o celular pode suspender o app depois de um tempo).

### Funcionalidades

- Mapa (OpenStreetMap) com os aviões da área visível, atualizado a cada 15 s
- Ícone girado conforme o rumo; aviões no solo em cinza
- Toque num avião: rota (ex.: Porto Alegre (POA) → São Paulo (GRU)), foto da aeronave, altitude, velocidade, razão de subida/descida, modelo, matrícula, transponder
- Busca por voo, matrícula ou código ICAO
- Botão para centralizar na sua localização
- Instalável na tela inicial (manifest + service worker)

### Por que existe o `app/api/voos.js` (intermediário)

O navegador do celular bloqueia chamadas diretas às APIs de ADS-B (CORS: no iPhone aparece
"Load failed"). Por isso o app pede os dados a `/api/voos`, uma função que roda no servidor da
Vercel, no mesmo endereço do site, e que busca os dados por ele. Ela só repassa pedidos para as
quatro fontes da tabela acima. No GitHub Pages essa função não existe, então lá o app tenta as
fontes diretamente (e pode não funcionar).

### Publicar na Vercel (recomendado, grátis)

1. Entre em https://vercel.com/signup com a conta do GitHub.
2. **Add New… → Project**, escolha o repositório **Celular** e clique em **Import**.
3. Não mude nada (sem framework, sem build) e clique em **Deploy**.
4. O app fica em `https://<nome-do-projeto>.vercel.app/` se a pasta raiz (Root Directory) for `app`,
   ou em `https://<nome-do-projeto>.vercel.app/app/` se for a raiz do repositório. O intermediário
   funciona nos dois casos. Cada mudança no `main` atualiza o site.

### Aeroportos e últimas chegadas

Os aeroportos com voos comerciais aparecem no mapa com o código IATA (os grandes a partir do zoom 5,
os médios a partir do 7). Tocando num aeroporto, o app mostra os **últimos 10 voos que pousaram**
nas últimas 12 horas: número do voo, companhia, origem, horário previsto e real, atraso, modelo e
matrícula. Se o avião ainda estiver no mapa, "ver no mapa ›" leva até ele.

- Lista de aeroportos: [OurAirports](https://ourairports.com/data/) (domínio público), filtrada
  por `api/aeroportos.js`.
- Chegadas: [AeroDataBox](https://aerodatabox.com) via RapidAPI, por `api/chegadas.js`. Precisa de
  uma chave (o plano gratuito tem um limite mensal; cada aeroporto fica 10 minutos em cache).

#### Configurar a chave do AeroDataBox

1. Crie uma conta em https://rapidapi.com e abra a página do **AeroDataBox**
   (https://rapidapi.com/aedbx-aedbx/api/aerodatabox).
2. Em **Pricing**, assine o plano gratuito (**Basic**).
3. Na aba **Endpoints**, copie o valor de **X-RapidAPI-Key**.
4. Na Vercel: projeto → **Settings → Environment Variables** → nome `AERODATABOX_KEY`, cole a
   chave como valor e salve.
5. Em **Deployments**, no deploy mais recente, toque em **⋯ → Redeploy** (a chave só vale a partir
   de um deploy novo).

A chave fica só na Vercel; ela nunca vai para o código nem para o navegador.

### Como usar no celular

Para instalar como app, o navegador exige HTTPS. O jeito mais simples é o GitHub Pages:

1. No GitHub: **Settings → Pages → Source: Deploy from a branch**, escolha o branch e a pasta `/ (root)`.
2. Abra `https://<seu-usuario>.github.io/Celular/app/` no celular.
3. **Android (Chrome)**: menu ⋮ → *Adicionar à tela inicial*.
   **iPhone (Safari)**: botão Compartilhar → *Adicionar à Tela de Início*.

Para testar no computador: `cd app && python3 -m http.server 8000` e abra `http://localhost:8000`.

### Próximos passos possíveis

- Rastro (trilha) do avião
- Notificações mesmo com o app fechado (exige um pequeno servidor com Web Push)
- Empacotar como app nativo para as lojas com [Capacitor](https://capacitorjs.com)
