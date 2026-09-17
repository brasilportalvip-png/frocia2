import { describe, expect, it } from 'vitest';
import { hasFrocWakePhrase, normalizeFrocVoiceCommand } from '../src/services/voiceCommandService.js';
describe('voice commands',()=>{
 it('remove ativação',()=>{expect(hasFrocWakePhrase('Ok Froc, pesquise receitas')).toBe(true);expect(normalizeFrocVoiceCommand('Ok Froc, pesquise receitas')).toBe('pesquise receitas');});
 it('aceita fala direta',()=>{expect(normalizeFrocVoiceCommand('monte um orçamento')).toBe('monte um orçamento');});
});
