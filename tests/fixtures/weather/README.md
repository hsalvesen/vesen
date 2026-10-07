# Recorded weather fixtures

Response bodies for the tests of `src/services/weather` and the weather command, served by the fetch in `tests/support/weather.ts` so no test touches the network; the end-to-end tests (`e2e/weather.spec.ts`, through `page.route`) answer from them too. Captured on 2026-10-06 at about 14:15 Sydney time (03:15 UTC) with curl, sending the User-Agent `vesen-fixture-recorder/1.0 (+https://www.vesen.app)` and, for Nominatim, the Referer `https://www.vesen.app/`, with Nominatim requests more than a second apart.

The forecast query is the one `forecastUrl` builds:
`current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`.

| File | Request | Notes |
|---|---|---|
| `forecast-sydney.json` | `GET https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093&…` | Daytime, clear now, a thunderstorm code (95) today. |
| `forecast-oslo.json` | `GET https://api.open-meteo.com/v1/forecast?latitude=59.9127&longitude=10.7461&…` | Night (`is_day` 0), so the card draws the moon. |
| `forecast-error-400.json` | `GET https://api.open-meteo.com/v1/forecast?latitude=200&longitude=0&…` | Open-Meteo's HTTP 400 body. |
| `geocode-oslo.json` | `GET https://geocoding-api.open-meteo.com/v1/search?name=Oslo&count=10&language=en&format=json` | |
| `geocode-springfield.json` | `…/search?name=Springfield&count=10&language=en&format=json` | Missouri first, then Illinois and Massachusetts. |
| `geocode-paris.json` | `…/search?name=Paris&count=10&language=en&format=json` | |
| `geocode-paris-fr.json` | `…/search?name=Paris&count=10&language=en&format=json&countryCode=FR` | |
| `geocode-paris-france.json` | `…/search?name=Paris%20France&count=10&language=en&format=json` | Empty: no `results` key. |
| `geocode-gadigal.json` | `…/search?name=Gadigal&count=10&language=en&format=json` | Empty; Gadigal is curated for this reason. |
| `nominatim-gadigal.json` | `GET https://nominatim.openstreetmap.org/search?q=Gadigal&format=jsonv2&limit=5&addressdetails=1&accept-language=en` | Sydney, `addresstype` city. |
| `nominatim-aotearoa.json` | `…/search?q=Aotearoa&format=jsonv2&limit=5&addressdetails=1&accept-language=en` | New Zealand, `addresstype` country. |
| `nominatim-reverse-sydney.json` | `GET https://nominatim.openstreetmap.org/reverse?lat=-33.87&lon=151.21&format=jsonv2&zoom=10&accept-language=en` | |
| `geojs.json` | `GET https://get.geojs.io/v1/ip/geo.json` | Shape as captured; `ip`, `asn`, the organisation, city, region and coordinates are replaced with a documentation address (203.0.113.0/24, AS64496) and central Sydney. |
| `ipinfo.json` | `GET https://ipinfo.io/json` | Same treatment as `geojs.json`. |

Every other body is exactly as captured.
