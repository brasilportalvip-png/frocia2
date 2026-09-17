import { describe, expect, it } from 'vitest';
import { classifyFrocVoiceTranscript, getFinalFrocVoiceCommand, hasFrocWakePhrase, normalizeFrocVoiceCommand } from '../src/services/voiceCommandService.js';
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
 it('reconhece o comando para desligar a escuta',()=>{
  expect(classifyFrocVoiceTranscript('Froc, pare a escuta',true,true)).toEqual({type:'stop'});
 });
});
