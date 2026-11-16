# Supermarket Prices IL

Find the cheapest nearby supermarket for your whole shopping basket in Israel.

Under Israel's food price transparency law, large supermarket chains publish the price of every product in every branch as XML files. The data is public but hard to use: each chain has its own portal and format. This project downloads those files daily, normalizes them into one PostgreSQL database, and (soon) serves a web app that compares a full basket across nearby branches.

## Status

Phase 1 (MVP) in progress: Tel Aviv, regular prices, no delivery. Four chains, 74 branches.

- [x] Repository skeleton
- [x] Ingest pipeline: download, parse, quality checks, load (74 Tel Aviv branches, about a minute)
- [x] Branch coordinates (73 of 74 branches geocoded with OpenStreetMap)
- [ ] Scheduled daily run on hosted Postgres
- [ ] Basket optimization engine
- [ ] Web app (React + TypeScript)
- [ ] Public deployment

## Stack

| Layer | Choice |
| --- | --- |
| Front end | React + TypeScript (mobile-first, Hebrew RTL) |
| Back end | Node.js + TypeScript |
| Database | PostgreSQL |
| Pipeline | TypeScript, scheduled daily |
| Tests | Vitest |

## Repository layout

```
db/migrations/      SQL schema migrations, applied in order
packages/pipeline/  Download, parse and load the chains' price files
```

## Running locally

Requires Node 22+ and PostgreSQL 16.

```bash
npm install
cp .env.example .env    # then edit the connection strings
export $(cat .env | xargs)
npm run migrate -w @spil/pipeline
npm run ingest -w @spil/pipeline
npm test                # integration tests run when TEST_DATABASE_URL is set
```

A first run loads about 190,000 prices (49 MB). Later runs write only the prices that changed, and skip files already processed.

## How a daily run works

1. Download each chain's Stores file and keep the branches in the target cities.
2. For every branch, find its newest PriceFull file. Skip it if it was already processed, or if a newer file was.
3. Decode (gzip, UTF-8 or UTF-16), parse, and normalize units to grams, millilitres or units.
4. Quality checks: drop absurd prices, reject the file if too many lines are unusable or if the list shrank by more than half since the last good run (a cut-off download). A rejected file leaves the previous prices in place.
5. In one transaction: upsert products (barcoded products are shared across chains), close changed prices, open new ones.
6. Geocode branches that are new or whose address changed (Nominatim structured search, one request per second). A normal day makes no requests.

## Design notes

- **Store price changes, not snapshots.** `price_changes` keeps one row per price period (`valid_from` / `valid_to`). A daily run only writes rows for prices that changed, so the database stays small and price history comes for free.
- **Idempotent runs.** Every processed file is recorded in `ingest_runs`; re-running on the same file changes nothing.
- **One engine, two cost models** (planned): picking branches within a radius and splitting an online order across chains are the same problem, a choice of sources with a fixed cost per source.

## Data sources

Links and public usernames come from each chain's price-transparency page and the [Consumer Protection Authority](https://www.gov.il/he/pages/cpfta_prices_regulations).

| Chain | Tel Aviv branches | Portal | Access |
| --- | --- | --- | --- |
| Shufersal | 33 | prices.shufersal.co.il | Public |
| AM:PM (Dor Alon) | 31 | url.publishedprices.co.il | Public username, no password |
| Rami Levy | 6 | url.publishedprices.co.il | Public username, no password |
| Yochananof | 4 | url.publishedprices.co.il | Public username, no password |
| Carrefour | 23 | prices.carrefour.co.il | Public, Israeli IPs only |
| Victory | 8 | laibcatalog.co.il | Public, Israeli IPs only |

Branches are matched to the city by CBS locality code, by city name, or, when a chain leaves the city empty (Yochananof), by a hand-checked list of branch codes.
