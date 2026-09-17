import { describe,expect,it,vi } from 'vitest';
import { WeatherService } from '../server/ai/weatherService.js';
describe('WeatherService',()=>{
 it('preserva cidade no contexto',()=>{const t='temperatura atual\nem cidade de Araraquara\nbusque na rede';expect(WeatherService.shouldFetch(t)).toBe(true);expect(WeatherService.extractLocation(t)).toBe('Araraquara');});
 it('consulta medição com fonte',async()=>{const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({results:[{name:'Araraquara',admin1:'São Paulo',country:'Brasil',latitude:-21.79,longitude:-48.17,timezone:'America/Sao_Paulo'}]}),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({timezone:'America/Sao_Paulo',current:{time:'2026-09-17T08:00',temperature_2m:18.4,apparent_temperature:17.9,relative_humidity_2m:70,wind_speed_10m:8.2}}),{status:200}));const r=await WeatherService.current('Araraquara',f as typeof fetch);expect(r.temperatureC).toBe(18.4);expect(r.sourceUrl).toContain('open-meteo.com');});
});
