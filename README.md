# Supermarket Prices IL

Find the cheapest nearby supermarket for your whole shopping basket in Israel.

Under Israel's food price transparency law, large supermarket chains publish the price of every product in every branch as XML files. The data is public but hard to use: each chain has its own portal and format. This project downloads those files daily, normalizes them into one PostgreSQL database, and (soon) serves a web app that compares a full basket across nearby branches.

## Status

Phase 1 (MVP) in progress: Tel Aviv, two chains (Shufersal, Rami Levy), regular prices, no delivery.

- [x] Repository skeleton
- [ ] Daily ingest pipeline (download, parse, load)
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

## Design notes

- **Store price changes, not snapshots.** `price_changes` keeps one row per price period (`valid_from` / `valid_to`). A daily run only writes rows for prices that changed, so the database stays small and price history comes for free.
- **Idempotent runs.** Every processed file is recorded in `ingest_runs`; re-running on the same file changes nothing.
- **One engine, two cost models** (planned): picking branches within a radius and splitting an online order across chains are the same problem, a choice of sources with a fixed cost per source.

## Data sources

| Chain | Portal | Access |
| --- | --- | --- |
| Shufersal | prices.shufersal.co.il | Public |
| Rami Levy | url.publishedprices.co.il | Public username, no password |
