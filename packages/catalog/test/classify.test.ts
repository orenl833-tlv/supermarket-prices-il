import { describe, expect, it } from "vitest";
import { bestSubstitute, classify, eggCount, type PricedProduct, type ProductInfo } from "../src/index.js";

let nextId = 1;
const p = (name: string, extra: Partial<ProductInfo> = {}): ProductInfo => ({
  id: nextId++,
  name,
  quantity: null,
  unit: null,
  isWeighted: false,
  ...extra,
});
const key = (name: string, extra: Partial<ProductInfo> = {}) => classify(p(name, extra))?.category.key ?? null;

describe("classify, real names from the chains' files", () => {
  it.each([
    ["ביצים L ארוזות  12 י", "eggs"],
    ["ביצי חופש 30יח L", "eggs"],
    ["ביצים 12 יח גדול L", "eggs"],
    ["ביצי קינדר סופרייז20*3ג", null],
    ["ביצי שוקול.סוניק 3*20גרם", null],
    ["חלב 3% מהדרין 2ל תנובה", "milk"],
    ["חלב נטול לקטוז 2% 1 ליטר", "milk"],
    ["חלבה מסולסלת 450 גרם", null],
    ["חלב עיזים4%שומן 1ל תנובה", null],
    ["חלב וניל2% 1ליטר תנובה", null],
    ["קוטג 5% 250ג שטראוס", "cottage"],
    ["גבינה לבנה 5% שומן 250 ג", "white-cheese"],
    ["גבינה לבנה 5% עיזים 250ג", null],
    ["חמאה מהדרין 200ג תנובה", "butter"],
    ["אורז בסמטי 1 ק\"ג", "rice"],
    ["פריכיות אורז", null],
    ["אורז ועדשים+טונה 160ג", null],
    ["ספגטי מס 5 ברילה500גר", "pasta"],
    ["פסטה פוזילי 500גרם ברילה", "pasta"],
    ["פסטה עם רוטב גבינה156ג", null],
    ["פסטה+טונה בשמן זית 160ג", null],
    ["טונה במי מלח4*160ג", "tuna"],
    ["טונה ריו שמן זית לימ3*65", "tuna"],
    ["שמנת חמוצה15% 200מ תנובה", "sour-cream"],
    ["שמנת לבישול 10%שומן250מ", "cooking-cream"],
    ["שמנת צמחית בישול250אלפרו", null],
    ["שמנת להקצפה38% תנובה500מ", "whipping-cream"],
    ["שמנתלהקצפה 38% 250 גרם", "whipping-cream"],
    ["יוגורט ביו 3% 200ג תנובה", "plain-yogurt"],
    ["יוגורט GO קרמי תות 200ג", null],
    ["יוגורט יווני 6.5% 130גר", null],
    ["מלח ים דק 500ג מלח הארץ", "salt"],
    ["מלח לימון 170 גרם", null],
    ["מלח הימלאיה דק 1 ק\"ג", null],
    ["עגבניות מרוסקות800ג יכין", "crushed-tomatoes"],
    ["ספגטי קמח מלא אורגני500ג", null],
    ["ספגטי מלא אורגני גרין500", null],
    ["פסטה ספירלי ללג400 ברילה", null],
    ["פסטה טורטליוני500ג ברילה", null],
    ["עגבניות מרוסקות מרוכ", null],
    ["עגבניות מרוסקות בזיל", null],
    // False positives found by running the rules over all 35,852 products:
    ["חלב גוף משזף 240מ\"ל", null],
    ["חלב פנים גאלאטה קונפורט", null],
    ["קוטג 5% עם זיתים 250 גר", null],
    ["מלפפון חמוץ במשקל", null],
  ])("%s -> %s", (name, expected) => {
    expect(key(name)).toBe(expected);
  });

  it("puts fresh produce in a category only when it is sold by weight", () => {
    expect(key("עגבנייה", { isWeighted: true })).toBe("tomatoes");
    expect(key("עגבניות מגי", { isWeighted: true })).toBe("tomatoes");
    expect(key("עגבניות שרי במשקל", { isWeighted: true })).toBeNull();
    expect(key("עגבניות קצוצות יכין 240")).toBeNull();
    expect(key("בצל יבש", { isWeighted: true })).toBe("onions");
    expect(key("בצל ירוק", { isWeighted: true })).toBeNull();
    expect(key("מלפפון", { isWeighted: true })).toBe("cucumbers");
    expect(key("מלפפון במלח 7-9 560 גרם")).toBeNull();
  });

  it("reads attributes", () => {
    expect(classify(p("ביצי חופש 12יח M"))?.attributes).toEqual({ size: "M", type: "free-range" });
    expect(classify(p("חלב מלא 3.8% 1ליטר תנובה"))?.attributes).toEqual({ fat: "3%", lactose: "regular" });
    expect(classify(p("חמאה לל\"ת מלח200ג ואליו"))?.attributes).toEqual({ salt: "unsalted" });
    expect(classify(p("חמאה מלוחה 200 גרם ווליו"))?.attributes).toEqual({ salt: "salted" });
    expect(classify(p("חמאה לה גל זהב עם מלח200"))?.attributes).toEqual({ salt: "salted" });
    expect(classify(p("גבינת קוטג%5מהדרין250גר"))?.attributes).toEqual({ fat: "5%" });
    expect(classify(p("אורז בסמתי 'גולד' מו"))?.attributes).toEqual({ kind: "basmati" });
    expect(classify(p("טונה בשמן זית 3*65 גרם"))?.attributes).toEqual({ packed: "oil", olive: "olive" });
    expect(classify(p("טונה סטארקיסט במים4*160ג"))?.attributes).toEqual({ packed: "water", olive: null });
    expect(classify(p("ספגטי מס 7 500 גרם"))?.attributes).toEqual({ shape: "long" });
    expect(classify(p("מלח הארץ גס צנצנת 1 ק\"ג"))?.attributes).toEqual({ grain: "coarse" });
    expect(classify(p("שמנת להקצפה 24% 250"))?.attributes).toEqual({ fat: "24%" });
    expect(classify(p("שמנת להקצפה 42% רמת"))?.attributes).toEqual({ fat: "42%" });
    expect(classify(p("יוגורט ביו נטול לקטו"))?.attributes).toEqual({ fat: null, lactose: "free" });
  });
});

describe("sizes", () => {
  it("counts eggs from the name, since Quantity says 1 for a 12-pack", () => {
    expect(eggCount("ביצים L ארוזות  12 י")).toBe(12);
    expect(eggCount("ביצים ארוזות 18יח M")).toBe(18);
    expect(eggCount("ביצים אומגה L שופרסל 6יח")).toBe(6);
    expect(eggCount("ביצים בינוני M12")).toBe(12);
    expect(eggCount("ביצים L אומגה 3 לבן")).toBeNull(); // "3" is omega-3, not a count
    expect(classify(p("ביצים 12 יח גדול L", { quantity: 1, unit: "unit" }))?.size).toEqual({ amount: 12, unit: "egg" });
  });

  it("uses the normalized quantity, or the name when it is missing", () => {
    expect(classify(p("חלב 3% מהדרין 2ל תנובה", { quantity: 2000, unit: "ml" }))?.size).toEqual({ amount: 2000, unit: "ml" });
    expect(classify(p("חלב תנובה 3% שומן 2ל"))?.size).toEqual({ amount: 2000, unit: "ml" });
    expect(classify(p("בצל יבש", { isWeighted: true }))?.size).toEqual({ amount: 1000, unit: "g" });
  });
});

describe("bestSubstitute", () => {
  const priced = (name: string, price: number, extra: Partial<ProductInfo> = {}): PricedProduct => ({
    ...p(name, extra),
    price,
  });

  it("replaces eggs with other eggs, paying for whole packs", () => {
    const wanted = p("ביצים L אומגה 3 לבן 12יח");
    const choice = bestSubstitute(wanted, 1, [
      priced("ביצים ארוזות 18יח L", 20.1), // one pack of 18 covers 12
      priced("ביצים L ארוזות 12 י", 14.5),
      priced("ביצי קינדר סופרייז20*3ג", 9.9), // not eggs
    ]);
    expect(choice).toMatchObject({ quantity: 1, unitPrice: 14.5, lineTotal: 14.5, differences: ["type"] });
    expect(choice?.penalty).toBe(2.5); // base 0.5 + 2 for omega-3 vs regular
  });

  it("buys two small packs when that is what covers the amount", () => {
    const choice = bestSubstitute(p("ביצים L ארוזות 12 י"), 1, [priced("ביצים אומגה L שופרסל 6יח", 8)]);
    expect(choice).toMatchObject({ quantity: 2, lineTotal: 16 });
  });

  it("never replaces regular milk with lactose-free milk", () => {
    const wanted = p("חלב 3% מהדרין 2ל תנובה", { quantity: 2000, unit: "ml" });
    expect(bestSubstitute(wanted, 1, [priced("חלב נטול לקטוז 3% 1 ליטר", 6, { quantity: 1000, unit: "ml" })])).toBeNull();
    const choice = bestSubstitute(wanted, 1, [priced("חלב בקרטון 3% שומן 1 ל", 6.5, { quantity: 1000, unit: "ml" })]);
    expect(choice).toMatchObject({ quantity: 2, lineTotal: 13, penalty: 0.5, differences: [] });
  });

  it("assumes a typical size when the name has none, at a small extra cost", () => {
    // No count in the name: a carton of eggs is assumed to hold 12, so 6-packs need two.
    const wanted = p("ביצים L אומגה 3 לבן");
    expect(bestSubstitute(wanted, 1, [priced("ביצים אומגה L שופרסל 6יח", 17.5)])).toMatchObject({
      quantity: 2,
      lineTotal: 35,
      penalty: 1.5, // base 0.5 + 1 for the guessed size
    });
    expect(bestSubstitute(wanted, 1, [priced("ביצים אומגה3 12יחידות L", 23.9)])).toMatchObject({ quantity: 1 });
  });

  it("assumes one pack for one pack when no size is known at all", () => {
    const choice = bestSubstitute(p("שמן קנולה נוגדי חמצון"), 1, [priced("שמן קנולה מזוכך 1 ליטר", 11, { quantity: 1000, unit: "ml" })]);
    expect(choice).toMatchObject({ quantity: 1, lineTotal: 11, penalty: 1.5 });
  });

  it("compares produce by weight", () => {
    const wanted = p("עגבנייה", { isWeighted: true });
    const choice = bestSubstitute(wanted, 1.5, [priced("עגבניות מגי", 9.9, { isWeighted: true })]);
    expect(choice).toMatchObject({ quantity: 1.5, lineTotal: 14.85 });
  });

  it("drops the base penalty for 'any brand', but still charges differences", () => {
    const wanted = p("ביצים L ארוזות 12 י");
    const sameKind = [priced("ביצים 12 יח גדול L", 12)];
    const otherSize = [priced("ביצים 12 יח בינוני M", 11)];
    expect(bestSubstitute(wanted, 1, sameKind, { anyBrand: true })?.penalty).toBe(0);
    expect(bestSubstitute(wanted, 1, otherSize, { anyBrand: true })?.penalty).toBe(1); // size L vs M
  });

  it("returns null for a product outside the taxonomy", () => {
    expect(bestSubstitute(p("במבה 80 גרם"), 1, [priced("במבה 60 גרם", 4)])).toBeNull();
  });
});
