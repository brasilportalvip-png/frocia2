# Voz móvel — Android/Chrome — 2026-09-17

## Sintoma reproduzido pelo usuário

Ao dizer “Ok Froc” no Chrome para Android, o navegador encerrava a sessão e a
interface reiniciava o reconhecimento após 350 ms. Cada nova abertura do microfone
produzia outro aviso sonoro, sem garantir que a frase seguinte chegasse ao site.

## Correção

- Android/Chrome usa reconhecimento de sessão única (`continuous = false`).
- Um toque no microfone autoriza uma frase completa e o envio é automático.
- “Ok Froc, pedido” e apenas “pedido” são aceitos após o toque.
- “Ok Froc” sem pedido encerra a sessão e apresenta uma orientação clara, sem loop.
- Erros `no-speech` e encerramentos do Chrome não reiniciam o microfone.
- Depois da resposta falada, a sessão móvel termina de forma previsível.
- O modo contínuo existente permanece disponível em desktop.

## Limite da plataforma

Uma página web móvel não pode manter um hotword permanente em segundo plano com as
mesmas permissões de um aplicativo Android nativo. A experiência confiável no Chrome
móvel exige um toque por pergunta; o envio e a resposta continuam automáticos.
