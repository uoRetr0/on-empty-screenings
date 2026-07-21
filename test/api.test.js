import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApiHandlers } from '../api/_lib.js';

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(body) {
      this.body = JSON.parse(body);
    }
  };
}

const showtimesFixture = {
  movies: [
    {
      name: 'Quiet Movie',
      experiences: [
        {
          name: 'Regular',
          sessions: [
            {
              vistaSessionId: '1001',
              showStartDateTime: '2026-05-23T21:50:00',
              isReservedSeating: true,
              isShowtimeEnabledOnline: true,
              isInThePast: false
            }
          ]
        }
      ]
    }
  ]
};

function fakeCineplex(overrides = {}) {
  return {
    async getTheatres() {
      return [{ id: '7247', name: 'Cineplex Odeon South Keys Cinemas' }];
    },
    async getShowtimes() {
      return showtimesFixture;
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available', A2: 'Available' } };
    },
    async getSeatLayout() {
      return {
        standardSeats: {
          totalColumns: 2,
          rows: [{ label: 'A', seats: [{ id: 'A1', label: '1', column: 1 }, { id: 'A2', label: '2', column: 2 }] }]
        }
      };
    },
    ...overrides
  };
}

test('cities handler returns supported cities with long CDN caching', async () => {
  const handlers = createApiHandlers({ cineplex: fakeCineplex() });
  const response = mockResponse();

  await handlers.cities({ method: 'GET', url: '/api/cities' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.defaultCity, 'ottawa');
  assert.ok(response.body.cities.some((city) => city.slug === 'toronto'));
  assert.ok(response.headers['cache-control'].includes('s-maxage=86400'));
});

test('showings handler returns scanned screenings with CDN caching', async () => {
  const handlers = createApiHandlers({ cineplex: fakeCineplex() });
  const response = mockResponse();

  await handlers.showings({ method: 'GET', url: '/api/showings?city=ottawa&date=2026-05-23&threshold=0' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.city, 'ottawa');
  assert.deepEqual(response.body.showings.map((showing) => showing.id), ['7247:1001']);
  assert.equal(response.body.showings[0].occupiedCount, 0);
  assert.ok(response.headers['cache-control'].includes('s-maxage=90'));
});

test('showings handler rejects unsupported cities without caching', async () => {
  const handlers = createApiHandlers({ cineplex: fakeCineplex() });
  const response = mockResponse();

  await handlers.showings({ method: 'GET', url: '/api/showings?city=not-real&date=2026-05-23' }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('showings handler reports upstream failures without caching', async () => {
  const handlers = createApiHandlers({
    cineplex: fakeCineplex({
      async getTheatres() {
        throw new Error('Cineplex API 500: boom');
      }
    })
  });
  const response = mockResponse();

  await handlers.showings({ method: 'GET', url: '/api/showings?city=ottawa&date=2026-05-23' }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.body.error.includes('Cineplex'));
});

test('seatmap handler merges layout with availability and caches warm results', async () => {
  let layoutCalls = 0;
  const handlers = createApiHandlers({
    cineplex: fakeCineplex({
      async getSeatLayout() {
        layoutCalls += 1;
        return {
          standardSeats: {
            totalColumns: 2,
            rows: [{ label: 'A', seats: [{ id: 'A1', label: '1', column: 1 }, { id: 'A2', label: '2', column: 2 }] }]
          }
        };
      },
      async getSeatAvailability() {
        return { seatAvailabilities: { A1: 'Available', A2: 'Occupied' } };
      }
    })
  });

  const request = { method: 'GET', url: '/api/seatmap/7247/1001', query: { theatreId: '7247', showtimeId: '1001' } };
  const first = mockResponse();
  await handlers.seatmap(request, first);

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.areas.length, 1);
  assert.equal(first.body.areas[0].rows[0].seats[1].status, 'Occupied');
  assert.ok(first.headers['cache-control'].includes('s-maxage=60'));

  const second = mockResponse();
  await handlers.seatmap(request, second);

  assert.equal(second.statusCode, 200);
  assert.equal(layoutCalls, 1);
});

test('seatmap handler requires theatre and showtime ids', async () => {
  const handlers = createApiHandlers({ cineplex: fakeCineplex() });
  const response = mockResponse();

  await handlers.seatmap({ method: 'GET', url: '/api/seatmap' }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['cache-control'], 'no-store');
});
