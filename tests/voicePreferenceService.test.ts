import { describe,expect,it } from 'vitest';
import { selectPreferredMalePortugueseVoice } from '../src/services/voicePreferenceService.js';
describe('voice preference',()=>{it('prioriza voz masculina pt-BR',()=>{const v=[{name:'Maria',lang:'pt-BR'},{name:'Microsoft Daniel',lang:'pt-BR'}] as SpeechSynthesisVoice[];expect(selectPreferredMalePortugueseVoice(v)?.name).toBe('Microsoft Daniel');});});
