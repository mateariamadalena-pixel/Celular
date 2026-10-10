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
| [adsb.lol](https://api.adsb.lol) (padrão) | Grátis, sem cadastro | Rede comunitária, dados abertos (ODbL) |
| [OpenSky Network](https://opensky-network.org) | Grátis para uso não comercial | Uso anônimo tem limite diário de consultas |

O Flightradar24 também tem API, mas ela é paga.

### Funcionalidades

- Mapa (OpenStreetMap) com os aviões da área visível, atualizado a cada 15 s
- Ícone girado conforme o rumo; aviões no solo em cinza
- Toque num avião: altitude, velocidade, razão de subida/descida, modelo, matrícula, transponder
- Busca por voo, matrícula ou código ICAO
- Botão para centralizar na sua localização
- Instalável na tela inicial (manifest + service worker)

### Como usar no celular

Para instalar como app, o navegador exige HTTPS. O jeito mais simples é o GitHub Pages:

1. No GitHub: **Settings → Pages → Source: Deploy from a branch**, escolha o branch e a pasta `/ (root)`.
2. Abra `https://<seu-usuario>.github.io/Celular/app/` no celular.
3. **Android (Chrome)**: menu ⋮ → *Adicionar à tela inicial*.
   **iPhone (Safari)**: botão Compartilhar → *Adicionar à Tela de Início*.

Para testar no computador: `cd app && python3 -m http.server 8000` e abra `http://localhost:8000`.

### Próximos passos possíveis

- Mostrar origem/destino (exige uma base de rotas, ex.: adsb.lol `/api/0/routeset`)
- Rastro (trilha) do avião
- Alertas quando um voo específico se aproximar
- Empacotar como app nativo para as lojas com [Capacitor](https://capacitorjs.com)
