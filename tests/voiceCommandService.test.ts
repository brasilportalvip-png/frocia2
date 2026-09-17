import { describe, expect, it } from 'vitest';
import { classifyFrocVoiceTranscript, getFinalFrocVoiceCommand, hasFrocWakePhrase, normalizeFrocVoiceCommand } from '../src/services/voiceCommandService.js';
import { normalizeTextForSpeech, splitTextForSpeech } from '../src/services/voicePreferenceService.js';
describe('voice commands',()=>{
 it('remove ativação',()=>{expect(hasFrocWakePhrase('Ok Froc, pesquise receitas')).toBe(true);expect(normalizeFrocVoiceCommand('Ok Froc, pesquise receitas')).toBe('pesquise receitas');});
 it('aceita fala direta',()=>{expect(normalizeFrocVoiceCommand('monte um orçamento')).toBe('monte um orçamento');});
 it('só envia automaticamente comandos finais iniciados pela ativação',()=>{
  expect(getFinalFrocVoiceCommand('Ok Froc pesquise notícias de hoje',true)).toBe('pesquise notícias de hoje');
  expect(getFinalFrocVoiceCommand('Ok Froc pesquisando',false)).toBeNull();
  expect(getFinalFrocVoiceCommand('pesquise notícias de hoje',true)).toBeNull();
 });
 it('mantém o Froc armado quando a ativação é dita sozinha',()=>{
  expect(classifyFrocVoiceTranscript('Ok Froc',true,false)).toEqual({type:'wake'});
  expect(classifyFrocVoiceTranscript('procure uma receita',true,true)).toEqual({type:'command',command:'procure uma receita'});
 });
 it.each(['Ok Rock','Ok Frog','Okay Frock','Olá Fróqui'])(
  'aceita a variação fonética produzida pelo navegador: %s',
  (wake)=>expect(classifyFrocVoiceTranscript(wake,true,false)).toEqual({type:'wake'})
 );
 it('envia o comando quando o navegador entende Ok Froc como Ok Rock',()=>{
  expect(classifyFrocVoiceTranscript('Ok Rock como você está hoje',true,false)).toEqual({type:'command',command:'como você está hoje'});
 });
 it('reconhece o comando para desligar a escuta',()=>{
  expect(classifyFrocVoiceTranscript('Froc, pare a escuta',true,true)).toEqual({type:'stop'});
 });
 it('transforma markdown em fala natural sem ler URLs ou símbolos',()=>{
  expect(normalizeTextForSpeech('## Olá\n- Veja [a fonte](https://example.com) e `npm test`.')).toBe('Olá Veja a fonte e npm test.');
 });
 it('divide respostas longas em trechos seguros sem perder o conteúdo',()=>{
  const original='Primeira frase curta. Segunda frase um pouco maior para validar a fila de reprodução. Terceira frase final.';
  const chunks=splitTextForSpeech(original,55);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.join(' ')).toBe(original);
  expect(chunks.every((chunk)=>chunk.length<=55)).toBe(true);
 });
});
