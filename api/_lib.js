import { DEFAULT_CITY_SLUG, createCineplexClient, getCityLocation, getSupportedCities } from '../src/cineplex.js';
import { cached, loadSeatmap, loadShowings, parseThreshold, publicErrorMessage } from '../src/server.js';

const CACHE_TTL_MS = 90_000;

export function createApiHandlers({
  cineplex = createCineplexClient(),
  cacheTtlMs = CACHE_TTL_MS,
  now = () => Date.now(),
  scanConcurrency = Number(process.env.SCAN_CONCURRENCY) || 8
} = {}) {
  const showingsCache = new Map();
  const seatmapCache = new Map();
  const seatAvailabilityCache = new Map();
  const cachedCineplex = {
    getTheatres: (date, location) => cineplex.getTheatres(date, location),
    getShowtimes: (theatreId, date) => cineplex.getShowtimes(theatreId, date),
    getSeatLayout: (theatreId, showtimeId) => cineplex.getSeatLayout(theatreId, showtimeId),
    getSeatAvailability: (theatreId, showtimeId) => {
      return cached(seatAvailabilityCache, `${theatreId}:${showtimeId}`, cacheTtlMs, now, () => {
        return cineplex.getSeatAvailability(theatreId, showtimeId);
      });
    }
  };

  return {
    async cities(request, response) {
      sendJson(response, 200, { cities: getSupportedCities(), defaultCity: DEFAULT_CITY_SLUG }, 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
    },

    async showings(request, response) {
      const query = queryParams(request);
      const date = query.get('date') || todayLocal();
      const location = getCityLocation(query.get('city') || DEFAULT_CITY_SLUG);
      if (!location) {
        sendJson(response, 400, { error: 'Unsupported city' });
        return;
      }

      const threshold = parseThreshold(query.get('threshold'), query.get('all'));

      try {
        const showings = await cached(showingsCache, `${location.slug}:${date}:${threshold}`, cacheTtlMs, now, () => {
          return loadShowings(cachedCineplex, { date, location, threshold, scanConcurrency, showtimeConcurrency: scanConcurrency });
        });
        sendJson(response, 200, { city: location.slug, showings }, 'public, max-age=0, s-maxage=90, stale-while-revalidate=300');
      } catch (error) {
        sendJson(response, 502, { error: publicErrorMessage(error) });
      }
    },

    async seatmap(request, response) {
      const query = queryParams(request);
      const theatreId = query.get('theatreId');
      const showtimeId = query.get('showtimeId');
      if (!theatreId || !showtimeId) {
        sendJson(response, 400, { error: 'Missing theatre or showtime' });
        return;
      }

      try {
        const seatmap = await cached(seatmapCache, `${theatreId}:${showtimeId}`, cacheTtlMs, now, () => {
          return loadSeatmap(cachedCineplex, { theatreId, showtimeId });
        });
        sendJson(response, 200, seatmap, 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
      } catch (error) {
        sendJson(response, 502, { error: publicErrorMessage(error) });
      }
    }
  };
}

function queryParams(request) {
  const params = new URL(request.url || '/', 'http://localhost').searchParams;
  for (const [key, value] of Object.entries(request.query || {})) {
    if (!params.has(key)) {
      params.set(key, Array.isArray(value) ? value[0] : value);
    }
  }

  return params;
}

// Errors are sent with no-store so the CDN never caches a failure.
function sendJson(response, status, body, cacheControl = 'no-store') {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', status === 200 ? cacheControl : 'no-store');
  response.end(JSON.stringify(body));
}

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

export const handlers = createApiHandlers();
