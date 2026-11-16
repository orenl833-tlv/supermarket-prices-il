# Project instructions

Supermarket price comparison for Israel. Portfolio project for a junior software engineer job search: code quality, tests and clear design matter more than feature count.

## Decisions (keep to these unless the owner changes them)

- TypeScript end to end: React front end, Node.js back end, TypeScript pipeline. No Python.
- PostgreSQL. Schema changes go through numbered SQL files in `db/migrations/`, never edited after they are applied.
- Phase 1 scope: Tel Aviv, regular prices only (no promotions), no delivery. Chains: Shufersal, Rami Levy, AM:PM, Yochananof; Carrefour and Victory once the pipeline runs from an Israeli IP (their portals block foreign IPs). Close substitutes for staple categories (rule-based taxonomy in `packages/catalog`) are in scope. New ideas go to a "later" list, not into phase 1.
- Pipeline runs once a day around 06:00 Israel time, after the chains publish full price files.
- Runs must be autonomous and cheap: no LLM calls in the daily run except classifying new products, under a hard daily cap with a rule-based fallback.
- Only access chain portals with credentials published by the chain itself or by the Consumer Protection Authority (gov.il/he/pages/cpfta_prices_regulations). No guessing credentials, no scraping that bypasses access controls.
- UI in Hebrew (RTL), README and code in English.

## Interview readiness

The owner must be able to explain the core parts without AI: the schema, the price-change update, the basket query, the optimization engine and substitute pricing. Keep those parts small, well named and commented where the reasoning is not obvious.

## Commands

```bash
npm install
npm run typecheck
npm test
```
