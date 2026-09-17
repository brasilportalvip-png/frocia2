# Isolamento de fontes e robustez de voz — 2026-09-17

## Defeito confirmado

Uma solicitação meteorológica anterior permanecia dentro de `assembled.userMessage`.
O acionamento do `WeatherService` inspecionava esse contexto agregado e podia executar
novamente a ferramenta em um turno atual não relacionado, anexando uma citação antiga
de clima a uma resposta de programação.

## Correção

- A ativação e a extração de localização meteorológica usam exclusivamente o prompt
  sanitizado do turno atual.
- O histórico continua disponível para raciocínio e memória, mas não pode acionar a
  ferramenta meteorológica nem produzir sua evidência.
- A leitura por voz remove sintaxe Markdown, URLs e blocos de código.
- Respostas longas são reproduzidas em fila de trechos curtos e naturais para evitar
  interrupções silenciosas do Web Speech no Chromium.
- Cada reprodução recebe uma sessão própria, impedindo que um temporizador antigo
  volte a falar depois de cancelamento ou desativação da conversa por voz.

## Evidências executadas

- TypeScript: aprovado (`npm run lint`).
- Testes: 480/480 aprovados em 73 arquivos (`npm test`).
- Build de produção: aprovado (`npm run build`).
- Tracker: 563/563 requisitos únicos.
- Migrations: válidas.
- Integridade de produção: 186 arquivos aprovados.
- E2E remoto: dois gates implantados aprovados; os gates locais não iniciaram neste
  ambiente porque o binário Chromium do Playwright não estava disponível e seu CDN
  respondeu 502/timeout. O código do site não foi executado nesses casos bloqueados.

## Limite técnico transparente

A seleção masculina usa a melhor voz portuguesa instalada no dispositivo. Navegadores
que não disponibilizem uma voz masculina local utilizarão a voz portuguesa padrão;
um timbre idêntico em todos os dispositivos exige um provedor TTS de servidor dedicado.
