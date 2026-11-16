import { missingPenalties, optimize, walkingCost, type BasketItem } from "@spil/engine";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { currentPrices, findSubstitutes, freshness, productNames, searchProducts, storesNear } from "./queries.js";

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
  opts: { logger?: boolean; webRoot?: string } = {},
): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

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

  app.get<{ Querystring: { q: string } }>(
    "/api/products",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 1, maxLength: 60 } },
        },
      },
    },
    async (req) => ({ products: await searchProducts(db, req.query.q) }),
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
      const substitutes = await findSubstitutes(db, items, stores.map((s) => s.id), prices);

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
      });

      // Items no nearby store sells, not even as a substitute: shown separately,
      // not as a fault of any plan.
      const unavailable = productIds.filter(
        (id) => !stores.some((s) => prices.get(s.id)?.has(id) || substitutes.get(s.id)?.has(id)),
      );
      const usedIds = plans.flatMap((p) => p.stops.flatMap((s) => s.lines.map((l) => l.productId)));
      const names = await productNames(db, [...new Set([...productIds, ...usedIds])]);
      const storeById = new Map(stores.map((s) => [s.id, s]));

      return {
        storesConsidered: stores.length,
        unavailable,
        productNames: Object.fromEntries(names),
        plans: plans.map((p) => ({
          ...p,
          stops: p.stops.map((s) => ({ ...s, store: storeById.get(s.store.id) })),
        })),
      };
    },
  );

  app.get("/api/status", async () => ({ chains: await freshness(db) }));

  return app;
}
