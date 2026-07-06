// Fetches all GetOut markets + venues from the public API, normalizes them,
// and writes data/venues.json + data/meta.json. Zero deps (Node 20 native fetch).
//
// The API is public/unauthenticated but CORS-locked to https://getout.com, so a
// browser cannot call it live. We fetch server-side and commit the JSON; git
// history doubles as a change log.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_BASE = process.env.GETOUT_API_BASE || "https://app.getout.com/api/v1/public";
const ORIGIN = "https://getout.com";
const DELAY_MS = 250;
const RETRIES = 3;
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(DIR, "data");

// Abort the write if more than this fraction of market fetches fail, so we
// never clobber last-good data with a partial pull.
const MAX_FAIL_FRACTION = 0.25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(path) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { Origin: ORIGIN, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await sleep(DELAY_MS * attempt * 2);
    }
  }
  throw new Error(`GET ${url} failed after ${RETRIES} tries: ${lastErr.message}`);
}

const unwrap = (j) => (j && j.value !== undefined ? j.value : j);

function marketPrice(p) {
  if (!p) return null;
  return p.promotional_price_in_dollars || p.list_price_in_dollars || null;
}

function normalizeVenue(v, market) {
  const cat = (v.categories && v.categories[0]) || null;
  const addr = v.address || (v.addresses && v.addresses[0]) || {};
  const hours = v.operating_hours || {};
  const day = (name) => hours[name] && hours[name].open === true;
  const lat = addr.latitude ?? (v.location && v.location.lat) ?? null;
  const lng = addr.longitude ?? (v.location && v.location.lng) ?? null;

  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    market: market.slug,
    marketName: market.name,
    state: v.state || addr.state || null,
    city: v.city || addr.city || null,
    category: cat && cat.parent ? cat.parent.name : null,
    subcategory: cat ? cat.name : null,
    categoryIcon: cat ? cat.icon || cat.thumbnail_url || null : null,
    tier: v.tier_display || v.tier || null,
    description: v.description || "",
    frequency: v.frequency || null,
    inclusionOverview: v.inclusion_overview || "",
    inclusionDetails: v.inclusion_details || "",
    phone: v.phone_number || null,
    website: v.website_url || null,
    websiteVisible: v.website_visible === 1 || v.website_visible === true,
    isNew: /new/i.test(v.banner_text || ""),
    logo: v.location_specific_logo || null,
    banner: v.location_specific_banner || null,
    address: {
      line1: addr.address_line_1 || addr.address || null,
      line2: addr.address_line_2 || null,
      city: addr.city || null,
      state: addr.state || null,
      zip: addr.zip_code || addr.zip || null,
      lat,
      lng,
    },
    days: {
      mon: day("monday"),
      tue: day("tuesday"),
      wed: day("wednesday"),
      thu: day("thursday"),
      fri: day("friday"),
      sat: day("saturday"),
      sun: day("sunday"),
    },
    events: (v.events || []).map((e) => ({
      name: e.name || "",
      startsAt: e.starts_at || null,
      endsAt: e.ends_at || null,
      description: e.description || "",
    })),
  };
}

async function main() {
  console.log(`Fetching markets from ${API_BASE} …`);
  const markets = (unwrap(await fetchJSON("/markets")) || []).filter((m) => m.visible !== false);

  if (!markets.length) {
    console.error("No markets returned — refusing to write empty data.");
    process.exit(1);
  }
  console.log(`Got ${markets.length} visible markets.`);

  const venues = [];
  const metaMarkets = [];
  let failures = 0;

  for (const m of markets) {
    try {
      const detail = unwrap(await fetchJSON(`/markets/${m.id}`));
      const raw = (detail && detail.venues) || [];
      for (const v of raw) venues.push(normalizeVenue(v, m));
      metaMarkets.push({
        slug: m.slug,
        name: m.name,
        state: (m.city && m.city.state_name) || (m.state_ids && m.state_ids[0]) || null,
        city: (m.city && m.city.name) || null,
        venueCount: raw.length,
        price: marketPrice(m.price),
      });
      console.log(`  ${m.name} (${m.slug}): ${raw.length} venues`);
    } catch (e) {
      failures++;
      console.error(`  FAILED ${m.name} (${m.slug}): ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  const failFraction = failures / markets.length;
  if (failFraction > MAX_FAIL_FRACTION) {
    console.error(
      `Too many market fetches failed (${failures}/${markets.length}) — refusing to write partial data.`
    );
    process.exit(1);
  }
  if (!venues.length) {
    console.error("No venues collected — refusing to write empty data.");
    process.exit(1);
  }

  venues.sort((a, b) => (a.marketName || "").localeCompare(b.marketName || "") || (a.name || "").localeCompare(b.name || ""));

  const categories = [...new Set(venues.map((v) => v.category).filter(Boolean))].sort();
  metaMarkets.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const meta = {
    generatedAt: new Date().toISOString(),
    marketCount: metaMarkets.length,
    venueCount: venues.length,
    markets: metaMarkets,
    categories,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, "venues.json"), JSON.stringify(venues) + "\n");
  await writeFile(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(
    `\nWrote ${venues.length} venues across ${metaMarkets.length} markets ` +
      `(${categories.length} categories, ${failures} market fetch failures).`
  );
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
