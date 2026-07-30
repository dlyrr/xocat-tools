// ============================================================
// Weather Service — OpenWeatherMap
// ============================================================
const axios = require('axios');

async function getCurrentWeather(location) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new Error('OPENWEATHER_API_KEY not configured');
  const { data } = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
    params: { q: location, appid: apiKey, units: 'imperial' },
    timeout: 10000,
  });
  return {
    city: data.name, country: data.sys.country,
    temp: data.main.temp, feelsLike: data.main.feels_like,
    tempMin: data.main.temp_min, tempMax: data.main.temp_max,
    humidity: data.main.humidity, windSpeed: data.wind.speed, windDeg: data.wind.deg,
    clouds: data.clouds.all, visibility: data.visibility,
    weather: data.weather[0],
    sunrise: data.sys.sunrise, sunset: data.sys.sunset,
    icon: `https://openweathermap.org/img/wn/${data.weather[0].icon}@4x.png`,
  };
}

function getWeatherEmoji(id) {
  if (id >= 200 && id < 300) return '⛈️';
  if (id >= 300 && id < 400) return '🌦️';
  if (id >= 500 && id < 600) return '🌧️';
  if (id >= 600 && id < 700) return '🌨️';
  if (id >= 700 && id < 800) return '🌫️';
  if (id === 800) return '☀️';
  return '☁️';
}

function getWindDirection(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

module.exports = { getCurrentWeather, getWeatherEmoji, getWindDirection };
