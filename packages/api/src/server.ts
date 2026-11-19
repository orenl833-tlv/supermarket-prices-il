import { missingPenalties, optimize, walkingCost, type BasketItem } from "@spil/engine";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { nominatim, type AddressLookup, type ReverseLookup } from "./geocode.js";
import {
  activePromotions,
  categorySuggestion,
  currentPrices,
  findSubstitutes,
  freshness,
  productNames,
  productsByIds,
  searchProducts,
  unlockableDeals,
  segmentList,
  storesNear,
} from "./queries.js";

/** Most stores considered in one comparison; keeps 2-store search at C(30,2) = 435 pairs. */
const MAX_CANDIDATE_STORES = 30;

interface CompareBody {
  items: BasketItem[];
  lat: number;
  lon: number;
  radiusKm: number;
  maxStores: 1 | 2;
  extraStopCost: number;
}

export function buildServer(
  db: pg.Pool,
  opts: { logger?: boolean; webRoot?: string; lookup?: AddressLookup; reverse?: ReverseLookup } = {},
): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const geocoder = opts.lookup && opts.reverse ? null : nominatim();
  const lookup = opts.lookup ?? geocoder!.search;
  const reverse = opts.reverse ?? geocoder!.reverse;

  // In production the API also serves the built web app, so the whole site is one service.
  if (opts.webRoot) {
    // Files are looked up on each request (not registered once at startup), so a
    // rebuild of the web app is served without restarting the API.
    app.register(fastifyStatic, { root: opts.webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }

  app.get("/api/health", async () => ({ ok: true }));

  // The street address of "my location", so the user can check it is right.
  app.get<{ Querystring: { lat: number; lon: number } }>(
    "/api/reverse",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["lat", "lon"],
          properties: {
            // Israel and its surroundings; anything else is a mistake or abuse.
            lat: { type: "number", minimum: 29, maximum: 34 },
            lon: { type: "number", minimum: 34, maximum: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        return { address: await reverse(req.query.lat, req.query.lon) };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        req.log.warn({ detail }, "reverse lookup failed");
        return reply.code(502).send({ error: "Reverse lookup is unavailable", detail });
      }
    },
  );

  // A typed starting address ("דיזנגוף 50"), for when the browser cannot give a location.
  app.get<{ Querystring: { q: string } }>(
    "/api/geocode",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 2, maxLength: 80 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return { place: await lookup(req.query.q) };
      } catch (err) {
        // The cause (e.g. "Nominatim: HTTP 403") is not secret and helps diagnose a failing deploy.
        const detail = err instanceof Error ? err.message : String(err);
        req.log.warn({ detail }, "address search failed");
        return reply.code(502).send({ error: "Address search is unavailable", detail });
      }
    },
  );

  app.get<{ Querystring: { q: string } }>(
    "/api/products",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req) => {
      const [products, suggestion] = await Promise.all([
        searchProducts(db, req.query.q),
        categorySuggestion(db, req.query.q),
      ]);
      // Nothing matches the whole text: it may be a list typed with spaces.
      const items = products.length === 0 && !suggestion ? await segmentList(db, req.query.q) : null;
      return { products, suggestion, items };
    },
  );

  // Used to open a shared list: the link carries product ids only.
  app.get<{ Querystring: { ids: string } }>(
    "/api/products/by-id",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["ids"],
          properties: { ids: { type: "string", pattern: "^\\d+(,\\d+){0,59}$" } },
        },
      },
    },
    async (req) => ({ products: await productsByIds(db, req.query.ids.split(",").map(Number)) }),
  );

  app.post<{ Body: CompareBody }>(
    "/api/compare",
    {
      schema: {
        body: {
          type: "object",
          required: ["items", "lat", "lon"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 60,
              items: {
                type: "object",
                required: ["productId", "quantity"],
                properties: {
                  productId: { type: "integer" },
                  quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 },
                  importance: { enum: ["must", "normal", "optional"], default: "normal" },
                  anyBrand: { type: "boolean", default: false },
                },
              },
            },
            // Roughly Israel, to reject swapped or garbage coordinates.
            lat: { type: "number", minimum: 29, maximum: 34 },
            lon: { type: "number", minimum: 34, maximum: 36 },
            radiusKm: { type: "number", minimum: 0.2, maximum: 5, default: 2 },
            maxStores: { enum: [1, 2], default: 1 },
            extraStopCost: { type: "number", minimum: 0, maximum: 200, default: 15 },
          },
        },
      },
    },
    async (req) => {
      const { items, lat, lon, radiusKm, maxStores, extraStopCost } = req.body;
      const stores = (await storesNear(db, { lat, lon }, radiusKm)).slice(0, MAX_CANDIDATE_STORES);
      const productIds = items.map((i) => i.productId);
      const prices = await currentPrices(db, stores.map((s) => s.id), productIds);
      const [substitutes, promotions] = await Promise.all([
        findSubstitutes(db, items, stores.map((s) => s.id), prices),
        activePromotions(db, stores.map((s) => s.id), productIds),
      ]);

      const plans = optimize({
        basket: items,
        stores,
        prices,
        costModel: walkingCost({ extraStopCost }),
        maxStores,
        penalties: missingPenalties(items, stores, prices),
        missingTripCost: extraStopCost,
        onePerChain: true,
        substitutes,
        promotions,
      });

      // Items no nearby store sells, not even as a substitute: shown separately,
      // not as a fault of any plan.
      const unavailable = productIds.filter(
        (id) => !stores.some((s) => prices.get(s.id)?.has(id) || substitutes.get(s.id)?.has(id)),
      );
      const usedIds = plans.flatMap((p) => p.stops.flatMap((s) => s.lines.map((l) => l.productId)));
      const names = await productNames(db, [...new Set([...productIds, ...usedIds])]);
      const storeById = new Map(stores.map((s) => [s.id, s]));
      // Deals the basket unlocks in each store it uses ("מעל 100"), on products not in the basket.
      const planStoreIds = [...new Set(plans.flatMap((p) => p.stops.map((s) => s.store.id)))];
      const deals = await unlockableDeals(db, planStoreIds, productIds);

      return {
        storesConsidered: stores.length,
        unavailable,
        productNames: Object.fromEntries(names),
        plans: plans.map((p) => ({
          ...p,
          stops: p.stops.map((s) => ({
            ...s,
            store: storeById.get(s.store.id),
            unlockedDeals: (deals.get(s.store.id) ?? []).filter((d) => d.minPurchase <= s.subtotal),
          })),
        })),
      };
    },
  );

  app.get("/api/status", async () => ({ chains: await freshness(db) }));

  return app;
}
