'use strict';
/*
 * Weather from Open-Meteo (free, no API key, CC BY 4.0 data). The cat reacts to it: an
 * umbrella and rain on screen when it is wet, snow when it snows, and a weather line in
 * the morning hello.
 */

// WMO weather interpretation codes -> our conditions.
function condition(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const LABEL = {
  clear: 'clear skies', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'foggy', drizzle: 'drizzly',
  rain: 'raining', snow: 'snowing', storm: 'stormy',
};
const ICON = { clear: '☀️', partly: '⛅', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' };

class Weather {
  constructor(store, opts) {
    this.store = store;
    this.fetch = (opts && opts.fetch) || globalThis.fetch;
    this.cache = null;
    this.fetchedAt = 0;
  }

  async search(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(name)}`;
    const res = await this.fetch(url);
    if (!res.ok) throw new Error('Location search failed');
    const j = await res.json();
    return (j.results || []).map((r) => ({ name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude, timezone: r.timezone }));
  }

  // Coarse location from the public IP (only when the user presses "Detect").
  async detect() {
    const res = await this.fetch('https://ipwho.is/');
    const j = await res.json();
    if (!j || j.success === false) throw new Error('Could not detect your location');
    return { name: j.city, admin: j.region, country: j.country, lat: j.latitude, lon: j.longitude, timezone: j.timezone && j.timezone.id };
  }

  setLocation(loc) {
    this.store.update('user', { location: loc });
    this.cache = null;
  }

  async current(force, locationOverride) {
    const loc = locationOverride || this.store.get('user.location');
    if (!loc) return null;
    if (!force && !locationOverride && this.cache && Date.now() - this.fetchedAt < 25 * 60000) return this.cache;
    const metric = (this.store.get('user.units') || 'metric') === 'metric';
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto`
      + '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,precipitation,relative_humidity_2m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=3'
      + (metric ? '' : '&temperature_unit=fahrenheit&wind_speed_unit=mph');
    const res = await this.fetch(url);
    if (!res.ok) throw new Error('Weather service unavailable');
    const j = await res.json();
    const c = j.current || {};
    const cond = condition(c.weather_code);
    const unit = metric ? '°C' : '°F';
    const days = (j.daily && j.daily.time ? j.daily.time : []).map((t, i) => ({
      date: t, condition: condition(j.daily.weather_code[i]), max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]),
      rainChance: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[i] : null,
      sunrise: j.daily.sunrise && j.daily.sunrise[i], sunset: j.daily.sunset && j.daily.sunset[i],
    }));
    const w = {
      place: [loc.name, loc.country].filter(Boolean).join(', '),
      condition: cond, label: LABEL[cond], icon: ICON[cond], code: c.weather_code,
      temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), unit,
      wind: Math.round(c.wind_speed_10m), windUnit: metric ? 'km/h' : 'mph', humidity: c.relative_humidity_2m,
      isDay: c.is_day === 1, days, at: Date.now(),
    };
    if (!locationOverride) { this.cache = w; this.fetchedAt = Date.now(); }
    return w;
  }

  summary(w) {
    if (!w) return 'I don\'t know where you are yet. Set your city in Settings and I\'ll keep an eye on the sky.';
    const today = w.days[0];
    let s = `${w.icon} It's ${w.temp}${w.unit} and ${w.label} in ${w.place}`;
    if (today) s += `, with a high of ${today.max}${w.unit} and a low of ${today.min}${w.unit}`;
    if (today && today.rainChance >= 50 && w.condition !== 'rain') s += `. ${today.rainChance}% chance of rain, so maybe take an umbrella`;
    return s + '.';
  }
}

module.exports = { Weather, condition };
