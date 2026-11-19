import { carrefour } from "./chains/carrefour.js";
import { victory } from "./chains/laibcatalog.js";
import { shufersal } from "./chains/shufersal.js";
import { doralon, ramiLevy, yochananof } from "./chains/publishedprices.js";
import type { ChainSource } from "./chains/types.js";
import { decodeFile } from "./encoding.js";
import { parseFileName } from "./filename.js";
import { diagnosePromoFull } from "./promotions.js";

/**
 * Print why one branch's promotions are left out, with examples. Reads the
 * chain's newest PromoFull file and writes nothing.
 *   npm run diagnose-promotions -w @spil/pipeline -- carrefour 85
 */
const CHAINS: Record<string, ChainSource> = { carrefour, victory, shufersal, ramiLevy, doralon, yochananof };

const [chainKey = "", storeCode = ""] = process.argv.slice(2);
const chain = CHAINS[chainKey];
if (!chain || !storeCode) {
  console.error(`usage: diagnose-promotions <${Object.keys(CHAINS).join("|")}> <store code>`);
  process.exit(2);
}
const file = await chain.latestPromoFullFile(storeCode);
if (!file) {
  console.log(`${chain.name} #${storeCode}: no PromoFull file`);
  process.exit(0);
}
const time = parseFileName(file.name)?.time ?? new Date();
console.log(`${chain.name} #${storeCode}: ${file.name}`);
for (const [reason, { count, examples }] of Object.entries(diagnosePromoFull(decodeFile(await chain.download(file)), time))) {
  console.log(`\n${reason}: ${count}`);
  for (const e of examples) console.log(`  - ${e}`);
}
