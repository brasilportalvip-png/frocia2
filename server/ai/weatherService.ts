export interface CurrentWeatherReport { location:string; timezone:string; observedAt:string; temperatureC:number; apparentTemperatureC:number; humidityPercent:number; windSpeedKmh:number; sourceUrl:string; retrievedAt:string }
export class WeatherServiceError extends Error {}
export class WeatherService {
  static shouldFetch(text:string){ return /\b(temperatura|clima|tempo|previs[aã]o|graus|chuva|umidade|vento)\b/i.test(text); }
  static extractLocation(text:string):string|null { const matches=[...text.matchAll(/\b(?:em|para|de)\s+(?:cidade\s+de\s+)?([\p{L}][\p{L}\s.'-]{1,70}?)(?=\s*(?:,|\?|\.|\n|$|\b(?:agora|hoje|atual)\b))/giu)]; return matches.at(-1)?.[1]?.replace(/\s+/g,' ').trim()||null; }
  static async current(location:string, fetchFn:typeof fetch=fetch):Promise<CurrentWeatherReport>{
    const geoUrl=new URL('https://geocoding-api.open-meteo.com/v1/search'); geoUrl.search=new URLSearchParams({name:location,count:'1',language:'pt',format:'json'}).toString();
    const geoResponse=await fetchFn(geoUrl,{signal:AbortSignal.timeout(8000)}); if(!geoResponse.ok) throw new WeatherServiceError('Falha ao localizar a cidade.');
    const geo=await geoResponse.json() as {results?:Array<Record<string,unknown>>}; const place=geo.results?.[0]; if(!place||typeof place.latitude!=='number'||typeof place.longitude!=='number') throw new WeatherServiceError('Cidade não encontrada.');
    const sourceUrl=new URL('https://api.open-meteo.com/v1/forecast'); sourceUrl.search=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',timezone:'auto',forecast_days:'1'}).toString();
    const response=await fetchFn(sourceUrl,{signal:AbortSignal.timeout(8000)}); if(!response.ok) throw new WeatherServiceError('Falha meteorológica.'); const data=await response.json() as {timezone?:string;current?:Record<string,unknown>}; const c=data.current; if(!c||typeof c.temperature_2m!=='number') throw new WeatherServiceError('Medição inválida.');
    return {location:[place.name,place.admin1,place.country].filter(v=>typeof v==='string').join(', '),timezone:data.timezone||String(place.timezone||'UTC'),observedAt:String(c.time||''),temperatureC:c.temperature_2m,apparentTemperatureC:Number(c.apparent_temperature),humidityPercent:Number(c.relative_humidity_2m),windSpeedKmh:Number(c.wind_speed_10m),sourceUrl:sourceUrl.toString(),retrievedAt:new Date().toISOString()};
  }
  static toGroundingContext(r:CurrentWeatherReport){return `\n\n[DADOS METEOROLÓGICOS VERIFICADOS]\nLocal: ${r.location}\nMedição: ${r.observedAt} (${r.timezone})\nTemperatura: ${r.temperatureC} °C\nSensação: ${r.apparentTemperatureC} °C\nUmidade: ${r.humidityPercent}%\nVento: ${r.windSpeedKmh} km/h\nFonte: Open-Meteo (${r.sourceUrl})\n[/DADOS METEOROLÓGICOS VERIFICADOS]`;}
}
