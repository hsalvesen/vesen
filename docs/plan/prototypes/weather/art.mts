// Throwaway prototype of the proposed pure weather core. Not part of the repo.
type Tone = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'bolt' | 'fog' | 'dim';
type ArtRow = ReadonlyArray<readonly [Tone, string]>;
type IconKey = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'heavyRain' | 'sleet' | 'snow' | 'heavySnow' | 'thunder' | 'unknown';

const C1: ArtRow = [['cloud', '     .--.    ']];
const C2: ArtRow = [['cloud', '  .-(    ).  ']];
const C3: ArtRow = [['cloud', ' (___.__)__) ']];
const BLANK: ArtRow = [['dim', '             ']];
const ART: Record<IconKey | 'clearNight' | 'partlyNight', readonly ArtRow[]> = {
  clear:      [[['sun', '    \\ | /    ']], [['sun', '   - .-. -   ']], [['sun', '  -- (   ) --']], [['sun', '   - `-\' -   ']], [['sun', '    / | \\    ']]],
  clearNight: [[['moon', '     _..     ']], [['moon', '   .\' .\'     ']], [['moon', '  :  :       ']], [['moon', '   \'. \'.     ']], [['moon', '     `\'\'     ']]],
  partly:     [[['sun', '  \\ | /      ']], [['sun', ' -  O  '], ['cloud', '.--.  ']], [['sun', '  / | '], ['cloud', '(    ).']], [['dim', '     '], ['cloud', '(___(__)']], BLANK],
  partlyNight:[[['moon', '   _..       ']], [['moon', ' .\' .\' '], ['cloud', '.--.  ']], [['moon', ' :  : '], ['cloud', '(    ).']], [['moon', '  \'. '], ['cloud', '(___(__)']], BLANK],
  cloudy:     [BLANK, C1, C2, C3, BLANK],
  fog:        [BLANK, [['fog', ' _ - _ - _ - ']], [['fog', '  _ - _ - _  ']], [['fog', ' _ - _ - _ - ']], BLANK],
  drizzle:    [C1, C2, C3, [['rain', '   \'   \'   \' ']], [['rain', '  \'   \'   \'  ']]],
  rain:       [C1, C2, C3, [['rain', '  \' \' \' \' \'  ']], [['rain', ' \' \' \' \' \'   ']]],
  heavyRain:  [C1, C2, C3, [['rain', ' ,\',\',\',\',\'  ']], [['rain', ' ,\',\',\',\',\'  ']]],
  sleet:      [C1, C2, C3, [['rain', '  \' '], ['snow', '*'], ['rain', ' \' '], ['snow', '*'], ['rain', ' \'  ']], [['snow', ' * '], ['rain', '\' '], ['snow', '* '], ['rain', '\' '], ['snow', '*   ']]],
  snow:       [C1, C2, C3, [['snow', '  *   *   *  ']], [['snow', '    *   *    ']]],
  heavySnow:  [C1, C2, C3, [['snow', ' * * * * * * ']], [['snow', '  * * * * *  ']]],
  thunder:    [C1, C2, C3, [['bolt', '   _/  _/    ']], [['rain', '  \' '], ['bolt', '/'], ['rain', ' \' '], ['bolt', '/'], ['rain', ' \'  ']]],
  unknown:    [[['dim', '     .-.     ']], [['dim', '    (   )    ']], [['dim', '      .\'     ']], [['dim', '      |      ']], [['dim', '      .      ']]],
};

interface WmoInfo { label: string; short: string; icon: IconKey }
const WMO: Record<number, WmoInfo> = {
  0: { label: 'Clear sky', short: 'Clear', icon: 'clear' },
  1: { label: 'Mainly clear', short: 'Mostly clear', icon: 'clear' },
  2: { label: 'Partly cloudy', short: 'Part cloudy', icon: 'partly' },
  3: { label: 'Overcast', short: 'Overcast', icon: 'cloudy' },
  45: { label: 'Fog', short: 'Fog', icon: 'fog' },
  48: { label: 'Depositing rime fog', short: 'Rime fog', icon: 'fog' },
  51: { label: 'Light drizzle', short: 'Drizzle', icon: 'drizzle' },
  53: { label: 'Drizzle', short: 'Drizzle', icon: 'drizzle' },
  55: { label: 'Dense drizzle', short: 'Drizzle', icon: 'drizzle' },
  56: { label: 'Light freezing drizzle', short: 'Frz drizzle', icon: 'sleet' },
  57: { label: 'Freezing drizzle', short: 'Frz drizzle', icon: 'sleet' },
  61: { label: 'Light rain', short: 'Light rain', icon: 'rain' },
  63: { label: 'Rain', short: 'Rain', icon: 'rain' },
  65: { label: 'Heavy rain', short: 'Heavy rain', icon: 'heavyRain' },
  66: { label: 'Light freezing rain', short: 'Frz rain', icon: 'sleet' },
  67: { label: 'Freezing rain', short: 'Frz rain', icon: 'sleet' },
  71: { label: 'Light snow', short: 'Light snow', icon: 'snow' },
  73: { label: 'Snow', short: 'Snow', icon: 'snow' },
  75: { label: 'Heavy snow', short: 'Heavy snow', icon: 'heavySnow' },
  77: { label: 'Snow grains', short: 'Snow grains', icon: 'snow' },
  80: { label: 'Light showers', short: 'Showers', icon: 'rain' },
  81: { label: 'Showers', short: 'Showers', icon: 'rain' },
  82: { label: 'Violent showers', short: 'Hvy showers', icon: 'heavyRain' },
  85: { label: 'Light snow showers', short: 'Snow shwrs', icon: 'snow' },
  86: { label: 'Heavy snow showers', short: 'Snow shwrs', icon: 'heavySnow' },
  95: { label: 'Thunderstorm', short: 'T-storm', icon: 'thunder' },
  96: { label: 'Thunderstorm, light hail', short: 'T-storm', icon: 'thunder' },
  99: { label: 'Thunderstorm, heavy hail', short: 'T-storm', icon: 'thunder' },
};
const wmo = (code: number | null): WmoInfo => (code != null && WMO[code]) || { label: 'Unknown', short: 'Unknown', icon: 'unknown' };
const artFor = (icon: IconKey, isDay: boolean) => (!isDay && icon === 'clear' ? ART.clearNight : !isDay && icon === 'partly' ? ART.partlyNight : ART[icon]);

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass = (deg: number | null) => (deg == null ? '' : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const span = (cls: string, text: string) => `<span class="wx-${cls}">${esc(text)}</span>`;
const t = (n: number | null) => (n == null ? '-' : String(Math.round(n) || 0));
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dayName = (iso: string, i: number) => { if (i === 0) return 'Today'; const [y,m,d] = iso.split('-').map(Number); return WD[new Date(Date.UTC(y, m-1, d)).getUTCDay()]; };
const artLine = (row: ArtRow) => row.map(([tone, s]) => span(tone, s)).join('');

function render(label: string, fx: any, compact: boolean): string {
  const c = fx.current, d = fx.daily, u = { t: '°C', w: 'km/h', p: 'mm' };
  const info = wmo(c.weather_code); const art = artFor(info.icon, c.is_day === 1);
  const L: string[] = [];
  if (compact) {
    L.push(span('place', label));
    const right = [
      span('cond', info.short),
      `${span('temp', t(c.temperature_2m) + u.t)} ${span('dim', 'feels ' + t(c.apparent_temperature))}`,
      `${span('wind', t(c.wind_speed_10m) + ' ' + u.w)} ${span('dim', compass(c.wind_direction_10m))}`,
      `${span('pct', c.relative_humidity_2m + '%')} ${span('mm', c.precipitation.toFixed(1) + u.p)}`,
      '',
    ];
    art.forEach((row, i) => L.push(artLine(row) + ' ' + right[i]));
    d.time.forEach((iso: string, i: number) => {
      const di = wmo(d.weather_code[i]);
      L.push(`${dayName(iso, i).padEnd(6)}${span('temp', (t(d.temperature_2m_min[i]) + '/' + t(d.temperature_2m_max[i]) + '°').padEnd(8))}${span('pct', String(d.precipitation_probability_max[i] ?? '-').padStart(3) + '%')} ${span('cond', di.short)}`);
    });
    L.push(span('dim', `Sun ${d.sunrise[0].slice(11)}-${d.sunset[0].slice(11)} · open-meteo.com`));
  } else {
    L.push(`${span('head', 'Weather report:')} ${span('place', label)}`);
    L.push('');
    const right = [
      span('cond', info.label),
      `${span('temp', t(c.temperature_2m) + ' ' + u.t)} ${span('dim', '(feels like ' + t(c.apparent_temperature) + ' ' + u.t + ')')}`,
      `${span('wind', compass(c.wind_direction_10m) + ' ' + t(c.wind_speed_10m) + ' ' + u.w)} ${span('dim', 'gusts ' + t(c.wind_gusts_10m) + ' ' + u.w)}`,
      `${span('pct', 'Humidity ' + c.relative_humidity_2m + '%')}`,
      `${span('mm', 'Precip ' + c.precipitation.toFixed(1) + ' ' + u.p)}`,
    ];
    art.forEach((row, i) => L.push(artLine(row) + '   ' + right[i]));
    L.push('');
    L.push(span('dim', 'Day        Low / High   Rain        Wind       Conditions'));
    d.time.forEach((iso: string, i: number) => {
      const di = wmo(d.weather_code[i]);
      const day = (i === 0 ? 'Today' : dayName(iso, i) + ' ' + iso.slice(8)).padEnd(10);
      const temps = `${t(d.temperature_2m_min[i])}° / ${t(d.temperature_2m_max[i])}°`.padEnd(13);
      const rain = `${String(d.precipitation_probability_max[i] ?? '-').padStart(3)}% ${d.precipitation_sum[i].toFixed(1)}mm`.padEnd(12);
      const wind = `${t(d.wind_speed_10m_max[i])} ${u.w}`.padEnd(11);
      L.push(`${day} ${span('temp', temps)}${span('pct', rain)}${span('wind', wind)}${span('cond', di.label)}`);
    });
    L.push('');
    L.push(span('dim', `Sunrise ${d.sunrise[0].slice(11)} · Sunset ${d.sunset[0].slice(11)} · UV ${d.uv_index_max[0] ?? '-'} · Updated ${c.time.slice(11)} ${fx.timezone_abbreviation}`));
    L.push(span('dim', 'Weather data by Open-Meteo.com (CC BY 4.0)'));
  }
  return L.join('\n');
}
const visible = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");

// width checks
for (const [k, rows] of Object.entries(ART)) {
  if (rows.length !== 5) throw new Error(k + ' rows');
  rows.forEach((r, i) => { const w = r.reduce((n, [, s]) => n + s.length, 0); if (w !== 13) throw new Error(`${k} row ${i} width ${w}`); });
}
const url = 'https://api.open-meteo.com/v1/forecast?latitude=-33.8698&longitude=151.2083&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=3';
const fx = await (await fetch(url)).json();
for (const compact of [false, true]) {
  const out = visible(render('Gadigal (Sydney), NSW, Australia', fx, compact));
  const w = Math.max(...out.split('\n').map(l => [...l].length));
  console.log(`---- ${compact ? 'compact' : 'wide'} (max ${w} cols)`); console.log(out);
}
for (const k of Object.keys(ART) as (keyof typeof ART)[]) { console.log('== ' + k); console.log(ART[k].map(r => r.map(([, s]) => s).join('')).join('\n')); }
console.log('XSS check:', render('<img src=x onerror=alert(1)>', fx, true).includes('<img') ? 'FAIL' : 'ok');
console.log('compass', [0, 22.4, 22.5, 180, 337.5, 359, 360, -10].map(compass).join(' '));
