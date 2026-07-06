# Better Get Out

A faster way to browse [GetOut](https://getout.com) membership venues. Two parts:

1. **Fetcher** (`fetch-data.js`) pulls every market and venue from GetOut's public
   API, normalizes it, and writes `data/venues.json` + `data/meta.json`. A daily
   GitHub Action runs it and commits any changes, so git history is a free change log.
2. **Viewer** (`index.html`) is a single-file vanilla app that loads the committed
   JSON and gives you real search and filtering: text search, market / category /
   city / open-on-day filters, and NEW / has-website / has-events toggles, with a
   detail modal per venue (about, what you get, hours, events, map, phone, website).

No framework, no build step, no secrets. The API is public and unauthenticated.

## Why fetch server-side

GetOut's API is CORS-locked to `https://getout.com`, so a browser on any other
origin can't call it. Node has no CORS restriction, so the Action fetches the data
and commits it; the viewer just reads static JSON.

## Local use

```sh
node fetch-data.js          # refresh data/*.json  (Node 20+)
python3 -m http.server      # then open http://localhost:8000  (file:// blocks fetch)
```

The viewer cache-busts its data requests, so a hard reload always shows the latest commit.

## Data shape

- `data/venues.json` — array of normalized venues (id, name, market, category,
  description, inclusions, phone, website, address+coords, per-day availability, events).
- `data/meta.json` — `{ generatedAt, marketCount, venueCount, markets[], categories[] }`.

## Deploy

Hosted on GitHub Pages from `main` (root). The daily Action commits refreshed data
and Pages serves it automatically.

Unofficial. Not affiliated with GetOut.
