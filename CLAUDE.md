# Project instructions

Supermarket price comparison for Israel. Portfolio project for a junior software engineer job search: code quality, tests and clear design matter more than feature count.

## Decisions (keep to these unless the owner changes them)

- TypeScript end to end: React front end, Node.js back end, TypeScript pipeline. No Python.
- PostgreSQL. Schema changes go through numbered SQL files in `db/migrations/`, never edited after they are applied.
- Phase 1 scope: Tel Aviv, no delivery. Chains: Shufersal, Rami Levy, AM:PM, Yochananof on GitHub's runners; Carrefour and Victory on a self-hosted runner in Israel (their portals block foreign IPs).
- Promotions (owner, 18.11): for all customers only; unit price, N for X, and buy N get M of the same product. No coupons, club deals, hour-limited or minimum-purchase deals, or weighted items. Rule: buy extra units automatically only when they cost nothing or make the line cheaper; otherwise only suggest them.
- Delivery vs. in-store is the next phase.
- Close substitutes for staple categories (rule-based taxonomy in `packages/catalog`) are in scope. New ideas go to a "later" list, not into phase 1.
- Pipeline runs once a day around 06:00 Israel time, after the chains publish full price files.
- Runs must be autonomous and cheap: no LLM calls in the daily run except classifying new products, under a hard daily cap with a rule-based fallback.
- Only access chain portals with credentials published by the chain itself or by the Consumer Protection Authority (gov.il/he/pages/cpfta_prices_regulations). No guessing credentials, no scraping that bypasses access controls.
- UI in Hebrew (RTL), README and code in English.

## Interview readiness

The owner must be able to explain the core parts without AI: the schema, the price-change update, the basket query, the optimization engine, substitute pricing and promotion pricing (`packages/engine/src/promotions.ts`). Keep those parts small, well named and commented where the reasoning is not obvious.

## Commands

```bash
npm install
npm run typecheck
npm test
```
