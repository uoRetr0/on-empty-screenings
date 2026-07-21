const form = document.querySelector('#filters');
const cityInput = form.elements.city;
const dateInput = form.elements.date;
const thresholdInput = form.elements.threshold;
const anyOccupiedInput = form.elements.anyOccupied || { checked: false, addEventListener() {} };
const cineplexInput = form.elements.cineplex;
const movieInput = form.elements.movie;
const statusEl = document.querySelector('#status');
const showingsEl = document.querySelector('#showings');
const timeFormatter = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const SHOWINGS_CACHE_TTL_MS = 90_000;
const defaultCities = [
  ['ottawa', 'Ottawa'],
  ['toronto', 'Toronto'],
  ['scarborough', 'Scarborough'],
  ['mississauga', 'Mississauga'],
  ['brampton', 'Brampton'],
  ['vaughan', 'Vaughan'],
  ['markham', 'Markham'],
  ['richmond-hill', 'Richmond Hill'],
  ['oakville', 'Oakville'],
  ['burlington', 'Burlington'],
  ['hamilton', 'Hamilton'],
  ['waterloo', 'Waterloo'],
  ['kitchener', 'Kitchener'],
  ['guelph', 'Guelph'],
  ['london', 'London'],
  ['windsor', 'Windsor'],
  ['barrie', 'Barrie'],
  ['oshawa', 'Oshawa'],
  ['kingston', 'Kingston'],
  ['niagara-falls', 'Niagara Falls'],
  ['sudbury', 'Sudbury'],
  ['thunder-bay', 'Thunder Bay']
];
const defaultCityLabels = new Map(defaultCities);
const defaultCineplexTheatresByCity = {
  ottawa: [
    'Cineplex Cinemas Ottawa',
    'Cineplex Cinemas Lansdowne and VIP',
    'Cineplex Odeon Barrhaven Cinemas',
    'Cineplex Odeon South Keys Cinemas',
    'Scotiabank Theatre Ottawa'
  ],
  toronto: [
    'Cineplex Cinemas Empress Walk',
    'Cineplex Cinemas Fairview Mall',
    'Cineplex Cinemas Queensway and VIP',
    'Cineplex Cinemas Varsity and VIP',
    'Cineplex Cinemas Yonge-Dundas and VIP',
    'Cineplex Cinemas Yonge-Eglinton and VIP',
    'Cineplex Cinemas Yorkdale',
    'Cineplex Odeon Eglinton Town Centre Cinemas',
    'Cineplex VIP Cinemas Don Mills (age restricted 19+)',
    'Scotiabank Theatre Toronto'
  ],
  scarborough: [
    'Cineplex Cinemas Scarborough',
    'Cineplex Odeon Morningside Cinemas'
  ],
  mississauga: [
    'Cineplex Cinemas Courtney Park',
    'Cineplex Cinemas Mississauga Square One',
    'Cineplex Cinemas Winston Churchill & VIP',
    'Cineplex Junxion Erin Mills'
  ],
  brampton: ['SilverCity Brampton Cinemas'],
  vaughan: ['Cineplex Cinemas Vaughan'],
  markham: ['Cineplex Cinemas Markham and VIP'],
  'richmond-hill': ['SilverCity Richmond Hill Cinemas'],
  oakville: [
    'Cineplex Cinemas Oakville and VIP',
    'Cineplex Cinemas Winston Churchill & VIP'
  ],
  burlington: ['SilverCity Burlington Cinemas'],
  hamilton: ['Cineplex Cinemas Ancaster', 'Cineplex Cinemas Hamilton Mountain'],
  waterloo: ['Galaxy Cinemas Waterloo'],
  kitchener: ['Cineplex Cinemas Kitchener and VIP'],
  guelph: ['Cineplex Cinemas Pergola Commons', 'Galaxy Cinemas Guelph'],
  london: ['Cineplex Odeon Westmount Cinemas and VIP', 'SilverCity London Cinemas'],
  windsor: ['Cineplex Odeon Devonshire Mall Cinemas'],
  barrie: ['Galaxy Cinemas Barrie'],
  oshawa: ['Cineplex Odeon Oshawa Cinemas'],
  kingston: ['Cineplex Odeon Gardiners Road Cinemas'],
  'niagara-falls': ['Cineplex Odeon Niagara Square Cinemas'],
  sudbury: ['SilverCity Sudbury Cinemas'],
  'thunder-bay': ['SilverCity Thunder Bay Cinemas']
};

let allShowings = [];
let loadController = null;
let lastLoadError = null;
let loadedScanKey = null;
let lastLoadedAt = null;
let statusBase = '';
let openSeatmap = null;
const showingsResponseCache = new Map();
const seatmapResponseCache = new Map();

dateInput.value = todayLocal();
replaceOptions(cityInput, '', defaultCities.map(([slug, label]) => ({ value: slug, label })));
updateFilterOptions(allShowings);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadShowings({ force: true });
});

cityInput.addEventListener('change', () => loadShowings());
dateInput.addEventListener('change', () => loadShowings());
thresholdInput.addEventListener('input', applyFilters);
anyOccupiedInput.addEventListener('change', applyFilters);
cineplexInput.addEventListener('change', applyFilters);
movieInput.addEventListener('change', applyFilters);

document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lastLoadedAt && Date.now() - lastLoadedAt > SHOWINGS_CACHE_TTL_MS && !loadController) {
    loadShowings();
  }
});

if (typeof setInterval === 'function') {
  setInterval(refreshStatusAge, 30_000);
}

loadCities().finally(() => loadShowings());

async function loadCities() {
  try {
    const body = await fetchJson('api/cities');
    const selectedCity = cityInput.value;
    replaceOptions(cityInput, '', body.cities.map((city) => ({ value: city.slug, label: city.label })));
    cityInput.value = hasOption(cityInput, selectedCity) ? selectedCity : body.defaultCity || 'ottawa';
    updateFilterOptions(allShowings);
  } catch {
    // The default city list is already rendered.
  }
}

async function loadShowings({ force = false } = {}) {
  loadController?.abort();
  loadController = new AbortController();
  const { signal } = loadController;
  const scanKey = `${cityInput.value}:${dateInput.value}`;

  form.classList.add('is-loading');
  showingsEl.setAttribute('aria-busy', 'true');
  if (scanKey === loadedScanKey && allShowings.length > 0) {
    setStatus('Refreshing...');
  } else {
    setStatus('Scanning...');
    renderSkeletons();
  }

  try {
    const body = await fetchShowings(cityInput.value, dateInput.value, signal, { force });
    if (signal.aborted) {
      return;
    }

    allShowings = prepareShowings(body.showings || []);
    loadedScanKey = scanKey;
    lastLoadedAt = Date.now();
    lastLoadError = null;
    updateFilterOptions(allShowings);
    applyFilters();
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    lastLoadError = error;
    updateFilterOptions(allShowings);
    applyFilters();
  } finally {
    if (loadController?.signal === signal) {
      loadController = null;
      form.classList.remove('is-loading');
      showingsEl.setAttribute('aria-busy', 'false');
    }
  }
}

async function fetchShowings(city, date, signal, { force = false } = {}) {
  const cacheKey = `${city}:${date}`;
  const cached = showingsResponseCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.body;
  }

  const params = new URLSearchParams({ city, date, all: '1' });
  const body = await fetchJson(`api/showings?${params}`, signal);
  showingsResponseCache.set(cacheKey, { body, expiresAt: Date.now() + SHOWINGS_CACHE_TTL_MS });
  return body;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.error || `Unable to load ${url}`);
  }

  return body;
}

function applyFilters() {
  const cineplex = cineplexInput.value;
  const movie = movieInput.value;
  const threshold = parseThreshold(thresholdInput.value);
  const showAnyOccupancy = anyOccupiedInput.checked;
  const filtered = [];

  for (const showing of allShowings) {
    if ((showAnyOccupancy || showing.occupiedCount <= threshold)
      && (!cineplex || showing.theatreName === cineplex)
      && (!movie || showing.movieTitle === movie)) {
      filtered.push(showing);
    }
  }

  renderShowings(filtered, { filtered: Boolean(cineplex || movie || (!showAnyOccupancy && threshold > 0)) });
}

function prepareShowings(showings) {
  for (const showing of showings) {
    showing.displayTime = formatTime(showing.startLocal);
    showing.displayAuditorium = formatAuditorium(showing.auditorium);
    showing.sortStartLocal = String(showing.startLocal || '');
  }

  return showings;
}

function updateFilterOptions(showings) {
  const selectedCineplex = cineplexInput.value;
  const selectedMovie = movieInput.value;
  const theatreNames = new Set(defaultCineplexTheatresByCity[cityInput.value] || []);
  const movieTitles = new Set();

  for (const showing of showings) {
    if (showing.theatreName) {
      theatreNames.add(showing.theatreName);
    }
    if (showing.movieTitle) {
      movieTitles.add(showing.movieTitle);
    }
  }

  replaceOptions(cineplexInput, 'All Cineplex theatres', sortedValues(theatreNames));
  replaceOptions(movieInput, 'All movies', sortedValues(movieTitles));

  cineplexInput.value = hasOption(cineplexInput, selectedCineplex) ? selectedCineplex : '';
  movieInput.value = hasOption(movieInput, selectedMovie) ? selectedMovie : '';
  cineplexInput.disabled = theatreNames.size === 0;
  movieInput.disabled = movieTitles.size === 0;
}

function renderShowings(showings, { filtered = false } = {}) {
  closeSeatmap();
  const theatreGroups = groupByTheatre(showings);
  const groupCount = theatreGroups.length;
  const errorAlert = lastLoadError ? errorState(lastLoadError, { stale: allShowings.length > 0 }) : null;
  if (lastLoadError) {
    setStatus(allShowings.length === 0 ? 'Error loading screenings' : 'Error loading new scan');
  } else {
    setStatus(`${showings.length} found${filtered ? ' after filters' : ` across ${groupCount} Cineplex theatres`}`);
  }

  if (showings.length === 0) {
    showingsEl.replaceChildren(...withErrorAlert(errorAlert, emptyResultsMessage({ filtered })));
    return;
  }

  let rowIndex = 0;
  const fragment = document.createDocumentFragment();
  if (errorAlert) {
    fragment.append(errorAlert);
  }

  for (const { theatreName, showings: theatreShowings } of theatreGroups) {
    const section = document.createElement('section');
    section.className = 'theatre-group';

    const city = theatreShowings.find((showing) => showing.city)?.city;
    section.append(theatreHeading(theatreName, city, theatreShowings.length));

    const list = document.createElement('div');
    list.className = 'showing-list';

    for (const showing of theatreShowings) {
      list.append(showingRow(showing, Math.min(rowIndex++, 8) * 45));
    }

    section.append(list);
    fragment.append(section);
  }

  showingsEl.replaceChildren(fragment);
}

function renderSkeletons() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 6; index += 1) {
    const row = document.createElement('article');
    row.className = 'showing-row showing-row--skeleton';
    for (let block = 0; block < 3; block += 1) {
      const shimmer = document.createElement('div');
      shimmer.className = 'skeleton-block';
      row.append(shimmer);
    }
    fragment.append(row);
  }

  showingsEl.replaceChildren(fragment);
}

function setStatus(text) {
  statusBase = text;
  statusEl.textContent = text;
}

function refreshStatusAge() {
  if (loadController || !lastLoadedAt || lastLoadError) {
    return;
  }

  const age = Date.now() - lastLoadedAt;
  if (age >= 45_000) {
    statusEl.textContent = `${statusBase} · updated ${formatAge(age)}`;
  }
}

function formatAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) {
    return `${seconds}s ago`;
  }

  return `${Math.round(seconds / 60)}m ago`;
}

function emptyResultsMessage({ filtered }) {
  if (allShowings.length === 0) {
    return emptyState('No screenings found', `No reserved-seat Cineplex screenings were found for ${selectedCityLabel()} on ${displayDate(dateInput.value)}.`);
  }

  if (filtered) {
    return emptyState('No matches', 'Try a higher max occupied number, or clear the theatre and movie filters.');
  }

  return emptyState('No empty screenings', 'There are screenings for this city and date, but none are completely empty. Raise max occupied to widen the search.');
}

function groupByTheatre(showings) {
  const groups = new Map();

  for (const showing of showings) {
    const theatreName = showing.theatreName || 'Unknown Cineplex';
    if (!groups.has(theatreName)) {
      groups.set(theatreName, []);
    }
    groups.get(theatreName).push(showing);
  }

  const theatreGroups = [];
  for (const [theatreName, theatreShowings] of groups) {
    theatreGroups.push({
      theatreName,
      showings: theatreShowings.sort((a, b) => a.sortStartLocal.localeCompare(b.sortStartLocal))
    });
  }

  return theatreGroups.sort((a, b) => a.theatreName.localeCompare(b.theatreName));
}

function theatreHeading(theatreName, city, screeningCount) {
  const heading = document.createElement('div');
  heading.className = 'theatre-heading';

  const title = document.createElement('h3');
  title.textContent = theatreName;

  const details = document.createElement('p');
  details.textContent = city ? `${city} · ${screeningCount} screenings` : `${screeningCount} screenings`;

  heading.append(title, details);
  return heading;
}

function showingRow(showing, animationDelay) {
  const row = document.createElement('article');
  row.className = 'showing-row';
  row.style.animationDelay = `${animationDelay}ms`;

  const time = document.createElement('div');
  const timeValue = document.createElement('strong');
  timeValue.textContent = showing.displayTime;
  const auditorium = document.createElement('span');
  auditorium.textContent = showing.displayAuditorium;
  time.append(timeValue, auditorium);

  const movie = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = showing.movieTitle;
  const experience = document.createElement('span');
  experience.textContent = showing.experienceTypes.join(', ') || 'Standard';
  movie.append(title, experience);

  const seats = document.createElement('div');
  seats.className = 'seat-count';
  const occupied = document.createElement('strong');
  occupied.textContent = showing.occupiedCount;
  const total = document.createElement('span');
  total.textContent = `${showing.totalSeats} seats`;
  seats.append(occupied, total);

  row.append(time, movie, seats);

  if (showing.theatreId && showing.showtimeId) {
    const chevron = document.createElement('span');
    chevron.className = 'row-chevron';
    chevron.textContent = '▾';
    row.append(chevron);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => toggleSeatmap(showing, row));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSeatmap(showing, row);
      }
    });
  }

  return row;
}

function toggleSeatmap(showing, row) {
  const key = `${showing.theatreId}:${showing.showtimeId}`;
  if (openSeatmap?.key === key) {
    closeSeatmap();
    return;
  }

  closeSeatmap();

  const panel = document.createElement('article');
  panel.className = 'seatmap-panel';
  const controller = new AbortController();
  openSeatmap = { key, row, panel, controller };
  row.setAttribute('aria-expanded', 'true');
  row.classList.add('is-open');
  row.after(panel);
  loadSeatmapPanel(showing, panel, controller.signal);
}

function closeSeatmap() {
  if (!openSeatmap) {
    return;
  }

  openSeatmap.controller.abort();
  openSeatmap.panel.remove();
  openSeatmap.row.setAttribute('aria-expanded', 'false');
  openSeatmap.row.classList.remove('is-open');
  openSeatmap = null;
}

async function loadSeatmapPanel(showing, panel, signal) {
  const key = `${showing.theatreId}:${showing.showtimeId}`;
  const message = document.createElement('p');
  message.className = 'seatmap-message';
  message.textContent = 'Loading seat map...';
  panel.replaceChildren(message);

  let seatmap = null;
  const cached = seatmapResponseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    seatmap = cached.body;
  } else {
    try {
      seatmap = await fetchJson(`api/seatmap/${encodeURIComponent(showing.theatreId)}/${encodeURIComponent(showing.showtimeId)}`, signal);
      seatmapResponseCache.set(key, { body: seatmap, expiresAt: Date.now() + SHOWINGS_CACHE_TTL_MS });
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) {
        return;
      }

      renderSeatmapError(showing, panel, signal);
      return;
    }
  }

  if (signal.aborted) {
    return;
  }

  renderSeatmap(panel, seatmap);
}

function renderSeatmapError(showing, panel, signal) {
  const message = document.createElement('p');
  message.className = 'seatmap-message';
  message.textContent = 'Could not load the seat map.';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'seatmap-retry';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => loadSeatmapPanel(showing, panel, signal));

  panel.replaceChildren(message, retry);
}

function renderSeatmap(panel, seatmap) {
  const screen = document.createElement('div');
  screen.className = 'seatmap-screen';
  screen.textContent = 'SCREEN';

  const areas = (seatmap.areas || []).map((area) => seatmapAreaEl(area, seatmap.areas.length > 1));
  panel.replaceChildren(screen, ...areas, seatmapLegend());
}

function seatmapAreaEl(area, showLabel) {
  const element = document.createElement('div');
  element.className = 'seat-area';

  if (showLabel) {
    const heading = document.createElement('h3');
    heading.textContent = seatmapAreaLabel(area.name);
    element.append(heading);
  }

  // Cineplex often reports totalColumns as 0, so measure the real column span.
  const { minColumn, columnCount } = areaColumnRange(area);
  for (const row of area.rows || []) {
    const rowEl = document.createElement('div');
    rowEl.className = 'seat-row';
    rowEl.style.gridTemplateColumns = `24px repeat(${columnCount}, var(--seat-size, 20px))`;

    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = row.label;
    rowEl.append(label);

    for (const seat of row.seats || []) {
      const seatEl = document.createElement('span');
      seatEl.className = `seat seat--${seatStatusClass(seat.status)}`;
      seatEl.style.gridColumnStart = seatColumnStart(seat, minColumn);
      seatEl.title = `${seat.label || row.label} · ${seat.status}`;
      rowEl.append(seatEl);
    }

    element.append(rowEl);
  }

  return element;
}

function areaColumnRange(area) {
  let minColumn = Infinity;
  let maxColumn = -Infinity;
  for (const row of area.rows || []) {
    for (const seat of row.seats || []) {
      if (Number.isFinite(seat.column)) {
        minColumn = Math.min(minColumn, seat.column);
        maxColumn = Math.max(maxColumn, seat.column);
      }
    }
  }

  if (!Number.isFinite(minColumn)) {
    return { minColumn: 0, columnCount: Math.max(1, area.totalColumns || 1) };
  }

  return { minColumn, columnCount: maxColumn - minColumn + 1 };
}

function seatColumnStart(seat, minColumn) {
  return (Number.isFinite(seat.column) ? seat.column - minColumn : 0) + 2;
}

function seatStatusClass(status) {
  if (status === 'Available') return 'available';
  if (status === 'Occupied') return 'occupied';
  return 'unknown';
}

function seatmapAreaLabel(name) {
  if (name === 'standardSeats') return 'Standard';
  if (name === 'dboxSeats') return 'D-BOX';
  if (name === 'balconySeats') return 'Balcony';
  return name;
}

function seatmapLegend() {
  const legend = document.createElement('div');
  legend.className = 'seatmap-legend';

  for (const [statusClass, label] of [['available', 'Available'], ['occupied', 'Occupied'], ['unknown', 'Unknown']]) {
    const item = document.createElement('span');
    item.className = 'seatmap-legend-item';
    const swatch = document.createElement('span');
    swatch.className = `seat seat--${statusClass}`;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(swatch, text);
    legend.append(item);
  }

  return legend;
}

function formatTime(value) {
  if (!value) return 'TBD';
  return timeFormatter.format(new Date(value));
}

function formatAuditorium(value) {
  const label = String(value || '').trim();
  if (!label) {
    return 'AUD ?';
  }

  const match = label.match(/^(?:auditorium|aud)\s*(.*)$/i);
  if (match) {
    const number = match[1].trim();
    return number ? `AUD ${number}` : 'AUD';
  }

  return `AUD ${label}`;
}

function emptyState(title, message, { plain = false } = {}) {
  const element = document.createElement('article');
  element.className = plain ? 'empty-state empty-state--plain' : 'empty-state';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = message;
  element.append(heading, body);
  return element;
}

function errorState(error, { stale }) {
  const message = stale
    ? `An error occurred while loading ${selectedCityLabel()} on ${displayDate(dateInput.value)}, so these are the previous results. Try again in a moment.`
    : `An error occurred while loading ${selectedCityLabel()} on ${displayDate(dateInput.value)}. ${friendlyLoadError(error)}`;
  const element = emptyState('Could not load screenings', message);
  element.className = 'empty-state empty-state--error';
  element.setAttribute('role', 'alert');
  return element;
}

function withErrorAlert(errorAlert, element) {
  return errorAlert ? [errorAlert, element] : [element];
}

function friendlyLoadError(error) {
  const message = String(error?.message || '');
  if (message.includes('api/showings')) {
    return `No scan is available for ${selectedCityLabel()} on ${displayDate(dateInput.value)} yet. Try another city or date.`;
  }

  return 'Cineplex data could not be reached. Wait a moment and try again.';
}

function selectedCityLabel() {
  return cityInput.selectedOptions?.[0]?.textContent || defaultCityLabels.get(cityInput.value) || cityInput.value || 'this city';
}

function displayDate(value) {
  if (!value) {
    return 'the selected date';
  }

  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function replaceOptions(select, defaultLabel, values) {
  const offset = defaultLabel ? 1 : 0;
  const options = new Array(values.length + offset);
  if (defaultLabel) {
    options[0] = new Option(defaultLabel, '');
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = typeof values[index] === 'string' ? values[index] : values[index].value;
    const label = typeof values[index] === 'string' ? values[index] : values[index].label;
    options[index + offset] = new Option(label, value);
  }

  select.replaceChildren(...options);
}

function sortedValues(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function hasOption(select, value) {
  for (const option of select.options) {
    if (option.value === value) {
      return true;
    }
  }

  return false;
}

function parseThreshold(value) {
  const threshold = Number(value || 0);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
}

function todayLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}
