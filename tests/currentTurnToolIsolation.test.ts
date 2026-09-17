import { describe, expect, it } from 'vitest';
import { WeatherService } from '../server/ai/weatherService.js';

describe('isolamento de ferramentas por turno', () => {
  it('não reutiliza intenção meteorológica de uma mensagem anterior', () => {
    const previousTurn = 'Qual é a temperatura atual em Araraquara?';
    const currentTurn = 'Analise este erro TypeScript e escreva testes unitários.';

    expect(WeatherService.shouldFetch(previousTurn)).toBe(true);
    expect(WeatherService.shouldFetch(currentTurn)).toBe(false);
    expect(WeatherService.extractLocation(currentTurn)).toBeNull();
  });

  it('continua reconhecendo clima e localização quando solicitados no turno atual', () => {
    const currentTurn = 'Qual é a temperatura atual na cidade de Araraquara?';
    expect(WeatherService.shouldFetch(currentTurn)).toBe(true);
    expect(WeatherService.extractLocation(currentTurn)).toBe('Araraquara');
  });
});
