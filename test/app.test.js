import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.checked = false;
    this.disabled = false;
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.parent = null;
    this.classList = {
      add: (className) => {
        this.className = sortedClassName(`${this.className} ${className}`);
      },
      remove: (className) => {
        this.className = sortedClassName(this.className.split(/\s+/).filter((name) => name && name !== className).join(' '));
      }
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ preventDefault() {} });
  }

  append(...children) {
    for (const child of children) {
      if (child instanceof FakeElement) {
        child.parent = this;
      }
    }
    this.children.push(...children);
  }

  replaceChildren(...children) {
    for (const child of children) {
      if (child instanceof FakeElement) {
        child.parent = this;
      }
    }
    this.children = children;
  }

  after(node) {
    node.parent = this.parent;
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index + 1, 0, node);
  }

  remove() {
    const index = this.parent ? this.parent.children.indexOf(this) : -1;
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeSelect extends FakeElement {
  constructor() {
    super();
    this.options = [];
  }

  replaceChildren(...options) {
    this.options = options;
    if (!this.options.some((option) => option.value === this.value)) {
      this.value = this.options[0]?.value || '';
    }
  }
}

function sortedClassName(value) {
  return [...new Set(String(value).split(/\s+/).filter(Boolean))].sort().join(' ');
}

class FakeDocument {
  constructor(form, status, showings) {
    this.form = form;
    this.status = status;
    this.showings = showings;
  }

  querySelector(selector) {
    if (selector === '#filters') return this.form;
    if (selector === '#status') return this.status;
    if (selector === '#showings') return this.showings;
    return null;
  }

  createElement() {
    return new FakeElement();
  }

  createDocumentFragment() {
    return new FakeElement();
  }
}

async function boot(fetchImpl) {
  const form = new FakeElement();
  const city = new FakeSelect();
  const date = new FakeElement();
  const threshold = new FakeElement();
  const anyOccupied = new FakeElement();
  const cineplex = new FakeSelect();
  const movie = new FakeSelect();
  const status = new FakeElement();
  const showings = new FakeElement();
  form.elements = { city, date, threshold, anyOccupied, cineplex, movie };

  const context = {
    document: new FakeDocument(form, status, showings),
    Intl,
    Date,
    AbortController,
    URLSearchParams,
    Option: class {
      constructor(label, value) {
        this.label = label;
        this.text = label;
        this.textContent = label;
        this.value = value;
      }
    },
    fetch: fetchImpl
  };

  vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  return { form, city, date, threshold, anyOccupied, cineplex, movie, status, showings, context };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    async json() {
      return body;
    }
  });
}

const citiesBody = {
  defaultCity: 'ottawa',
  cities: [
    { slug: 'ottawa', label: 'Ottawa' },
    { slug: 'toronto', label: 'Toronto' }
  ]
};

function showing(overrides = {}) {
  return {
    theatreId: '7247',
    showtimeId: '1001',
    theatreName: 'Cineplex Cinemas Ottawa',
    city: 'Ottawa',
    movieTitle: 'Quiet Movie',
    startLocal: '2026-05-23T19:00:00',
    auditorium: '1',
    experienceTypes: ['Regular'],
    occupiedCount: 0,
    totalSeats: 100,
    ...overrides
  };
}

test('city selection is not reset when async city options finish loading', async () => {
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  const harness = await boot(() => fetchPromise);
  harness.city.value = 'toronto';
  harness.city.dispatch('change');

  resolveFetch({
    ok: true,
    async json() {
      return citiesBody;
    }
  });
  await flush();

  assert.equal(harness.city.value, 'toronto');
});

test('page load scans screenings automatically', async () => {
  const requestedUrls = [];
  const harness = await boot((url) => {
    requestedUrls.push(String(url));
    if (String(url) === 'api/cities') {
      return jsonResponse(citiesBody);
    }
    return jsonResponse({ showings: [showing()] });
  });

  await flush();

  assert.equal(requestedUrls[0], 'api/cities');
  assert.ok(requestedUrls.some((url) => url.startsWith('api/showings?city=ottawa&')));
  assert.ok(harness.cineplex.options.some((option) => option.value === 'Cineplex Odeon Barrhaven Cinemas'));
  assert.ok(harness.movie.options.some((option) => option.value === 'Quiet Movie'));
});

test('changing city scans automatically and aborts the previous load', async () => {
  const requests = [];
  const harness = await boot((url, options = {}) => {
    requests.push({ url: String(url), signal: options.signal });
    if (String(url) === 'api/cities') {
      return jsonResponse(citiesBody);
    }
    return new Promise(() => {});
  });

  await flush();
  const firstScan = requests.find((request) => request.url.startsWith('api/showings?city=ottawa&'));
  assert.ok(firstScan);

  harness.city.value = 'toronto';
  harness.city.dispatch('change');
  await flush();

  assert.ok(requests.some((request) => request.url.startsWith('api/showings?city=toronto&')));
  assert.equal(firstScan.signal.aborted, true);
});

test('skeleton rows render while a scan is loading', async () => {
  const harness = await boot((url) => {
    if (String(url) === 'api/cities') {
      return jsonResponse(citiesBody);
    }
    return new Promise(() => {});
  });

  await flush();

  assert.equal(harness.status.textContent, 'Scanning...');
  const skeletons = harness.showings.children[0].children;
  assert.equal(skeletons.length, 6);
  assert.ok(skeletons.every((row) => row.className.includes('showing-row--skeleton')));
});

test('manual refresh forces a fresh scan past the response cache', async () => {
  const requestedUrls = [];
  const harness = await boot((url) => {
    requestedUrls.push(String(url));
    if (String(url) === 'api/cities') {
      return jsonResponse(citiesBody);
    }
    return jsonResponse({ showings: [] });
  });

  await flush();
  harness.form.dispatch('submit');
  await flush();

  assert.equal(requestedUrls.filter((url) => url.startsWith('api/showings?city=ottawa&')).length, 2);
});

test('any occupied toggle shows screenings above the max occupied value', async () => {
  const harness = await boot((url) => {
    if (String(url) === 'api/cities') {
      return jsonResponse({ defaultCity: 'ottawa', cities: [{ slug: 'ottawa', label: 'Ottawa' }] });
    }
    return jsonResponse({
      showings: [
        showing({ movieTitle: 'Empty Movie', occupiedCount: 0 }),
        showing({ showtimeId: '1002', movieTitle: 'Busy Movie', startLocal: '2026-05-23T21:00:00', auditorium: '2', occupiedCount: 8 })
      ]
    });
  });
  harness.threshold.value = '0';

  await flush();
  assert.equal(harness.status.textContent, '1 found across 1 Cineplex theatres');

  harness.anyOccupied.checked = true;
  harness.anyOccupied.dispatch('change');
  assert.equal(harness.status.textContent, '2 found across 1 Cineplex theatres');
});

test('failed load keeps previous results and shows an error card', async () => {
  let failShowings = false;
  const harness = await boot((url) => {
    if (String(url) === 'api/cities') {
      return jsonResponse({ defaultCity: 'ottawa', cities: [{ slug: 'ottawa', label: 'Ottawa' }] });
    }
    if (failShowings) {
      return jsonResponse({ error: 'Cineplex data could not be reached' }, false);
    }
    return jsonResponse({ showings: [showing()] });
  });

  await flush();
  assert.equal(harness.movie.disabled, false);
  assert.equal(harness.movie.options.some((option) => option.value === 'Quiet Movie'), true);

  failShowings = true;
  harness.date.value = '2026-05-24';
  harness.date.dispatch('change');
  await flush();

  assert.equal(harness.status.textContent, 'Error loading new scan');
  assert.equal(harness.movie.disabled, false);
  assert.equal(harness.movie.options.some((option) => option.value === 'Quiet Movie'), true);
  assert.equal(harness.showings.children[0].children[0].className, 'empty-state empty-state--error');
});

test('clicking a showing toggles its seat map panel', async () => {
  const requestedUrls = [];
  const harness = await boot((url) => {
    requestedUrls.push(String(url));
    if (String(url) === 'api/cities') {
      return jsonResponse({ defaultCity: 'ottawa', cities: [{ slug: 'ottawa', label: 'Ottawa' }] });
    }
    if (String(url).startsWith('api/seatmap/')) {
      return jsonResponse({
        theatreId: '7247',
        showtimeId: '1001',
        areas: [
          {
            name: 'standardSeats',
            totalColumns: 2,
            rows: [
              {
                label: 'A',
                seats: [
                  { id: 'A1', label: '1', column: 1, status: 'Available' },
                  { id: 'A2', label: '2', column: 2, status: 'Occupied' }
                ]
              }
            ]
          }
        ]
      });
    }
    return jsonResponse({
      showings: [
        showing(),
        showing({ showtimeId: '1002', movieTitle: 'Other Movie', startLocal: '2026-05-23T21:00:00' })
      ]
    });
  });

  await flush();
  const fragment = harness.showings.children[0];
  const list = fragment.children[0].children[1];
  const [firstRow, secondRow] = list.children;

  firstRow.dispatch('click');
  await flush();

  assert.ok(requestedUrls.includes('api/seatmap/7247/1001'));
  assert.equal(firstRow.attributes.get('aria-expanded'), 'true');
  const panel = list.children[1];
  assert.equal(panel.className, 'seatmap-panel');
  assert.equal(panel.children[0].className, 'seatmap-screen');
  assert.equal(panel.children.at(-1).className, 'seatmap-legend');
  const seatRow = panel.children[1].children[0];
  assert.equal(seatRow.children[1].className, 'seat seat--available');
  assert.equal(seatRow.children[1].style.gridColumnStart, 2);
  assert.equal(seatRow.children[2].className, 'seat seat--occupied');

  secondRow.dispatch('click');
  await flush();

  assert.ok(requestedUrls.includes('api/seatmap/7247/1002'));
  assert.equal(firstRow.attributes.get('aria-expanded'), 'false');
  assert.equal(list.children.filter((child) => child.className === 'seatmap-panel').length, 1);
  assert.equal(list.children[2].className, 'seatmap-panel');

  secondRow.dispatch('click');
  assert.equal(list.children.filter((child) => child.className === 'seatmap-panel').length, 0);
  assert.equal(secondRow.attributes.get('aria-expanded'), 'false');
});

test('pure formatting helpers', async () => {
  const harness = await boot(() => new Promise(() => {}));
  const { context } = harness;

  assert.equal(context.formatAuditorium('7'), 'AUD 7');
  assert.equal(context.formatAuditorium('Auditorium 12'), 'AUD 12');
  assert.equal(context.formatAuditorium('Aud 4'), 'AUD 4');

  assert.equal(context.formatAge(30_000), '30s ago');
  assert.equal(context.formatAge(300_000), '5m ago');

  assert.equal(context.seatmapAreaLabel('standardSeats'), 'Standard');
  assert.equal(context.seatmapAreaLabel('dboxSeats'), 'D-BOX');
  assert.equal(context.seatmapAreaLabel('balconySeats'), 'Balcony');

  assert.equal(context.seatColumnStart({ column: 3 }, 1), 4);
  assert.equal(context.seatColumnStart({ column: 0 }, 0), 2);
});
