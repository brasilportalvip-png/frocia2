# Voz neural masculina humanizada — 2026-09-17

## Objetivo

Substituir a voz feminina e robótica fornecida pelo Android por áudio neural consistente
em todos os dispositivos, mantendo a síntese do navegador apenas como contingência.

## Implementação

- Endpoint autenticado `POST /api/ai/speech`.
- Limite de 20 gerações por minuto por usuário/IP.
- Modelo configurável por `GEMINI_TTS_MODEL` e voz por `GEMINI_TTS_VOICE`.
- Padrão: `gemini-3.1-flash-tts-preview`, voz `Charon`, idioma `pt-BR`.
- Direção de atuação: homem adulto, natural, caloroso, amigável e sem voz de locutor.
- Conversão segura de PCM 16-bit/24 kHz para WAV quando necessária.
- Áudio temporário é revogado depois da execução ou cancelamento.
- Falha do TTS neural aciona automaticamente a síntese local do navegador.
- Texto limitado, normalizado e protegido contra fechamento das tags de fala.

## Limites

O modelo TTS é um recurso Preview do Gemini e depende da disponibilidade e cobrança da
API. Nenhuma chave é enviada ao navegador; a chamada ocorre exclusivamente no servidor.
