# ON Empty Screenings

Find Cineplex movie showings in Ontario cities where there are few or no occupied seats.

This is an unofficial project and is not affiliated with Cineplex.

Thanks to Riley Walz for creating the original Empty Screenings idea and site: https://walzr.com/empty-screenings

## Hosting

The site runs on Vercel: the static frontend is served from `public/`, and the API runs live as serverless functions in `api/` (thin wrappers around `src/`). Every visit scans live Cineplex data — no static snapshots. Responses are cached briefly at the CDN (`s-maxage`) to keep repeat loads fast and Cineplex traffic low.

Deploying: import the repo at vercel.com (framework preset "Other", no build command). Optional environment variables:

- `CINEPLEX_SUBSCRIPTION_KEY` skips public API key discovery on cold starts.
- `SCAN_CONCURRENCY` tunes how many Cineplex calls run in parallel during a scan (default 8).

## API

Available on the deployed site and when running the Node server locally (`npm start`):

- `GET /api/cities` returns supported Ontario city choices.
- `GET /api/showings?city=ottawa&date=YYYY-MM-DD&threshold=0` returns screenings with `occupiedCount <= threshold`.
- `GET /api/showings?city=toronto&date=YYYY-MM-DD&all=1` returns all supported reserved-seat screenings for the selected city.
- `GET /api/seatmap/:theatreId/:showtimeId` returns seat-layout areas merged with availability statuses.
