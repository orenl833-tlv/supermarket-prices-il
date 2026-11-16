import type { AttributeDef, CategoryDef } from "./types.js";

/**
 * Staple categories where products of different brands are close substitutes.
 * Rules are written against real product names from the chains' files (see
 * test/classify.test.ts). Note: JavaScript's \b only knows ASCII letters, so
 * Hebrew word edges are written as (?=\s|$) or not at all.
 *
 * Kept deliberately small and curated: a wrong category is worse than none,
 * because it would offer a wrong substitute.
 */

/** Fat percentage bucket: "3%", "3.6%", "3.8%" all count as full-fat. */
const fat = (buckets: Array<[number, string]>, penalty: number): AttributeDef => ({
  key: "fat",
  mismatchPenalty: penalty,
  read: (name) => {
    // "5%" or, in some files, "%5".
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(name) ?? /%\s*(\d+(?:\.\d+)?)/.exec(name);
    if (!m) return null;
    const value = Number(m[1]);
    for (const [max, label] of buckets) if (value <= max) return label;
    return null;
  },
});

const pick =
  (options: Array<[RegExp, string]>, fallback: string | null = null) =>
  (name: string) => {
    for (const [re, value] of options) if (re.test(name)) return value;
    return fallback;
  };

export const CATEGORIES: CategoryDef[] = [
  {
    key: "eggs",
    name: "ביצים",
    unit: "egg",
    weighted: false,
    match: /^ביצ(ים|י)\s/,
    exclude: /קינדר|שוקו|הפתעה|סוניק|פסחא|מרציפן|אטריות|איטריות|פסטה|שליו/,
    typicalSize: 12,
    shelfLifeDays: 30,
    attributes: [
      {
        key: "size",
        mismatchPenalty: 1,
        read: pick([
          [/XL/, "XL"],
          [/(^|[^A-Z])L([^A-Z]|$)|גדול/, "L"],
          [/(^|[^A-Z])M([^A-Z]|$)|בינוני/, "M"],
        ]),
      },
      {
        key: "type",
        mismatchPenalty: 2,
        read: pick(
          [
            [/אורגני/, "organic"],
            [/חופש/, "free-range"],
            [/אומגה/, "omega-3"],
          ],
          "regular",
        ),
      },
    ],
  },
  {
    key: "milk",
    name: "חלב",
    unit: "ml",
    weighted: false,
    match: /^חלב(?!ה)/,
    exclude:
      /עיזים|עזים|וניל|שוקו|מרוכז|להקצפה|קוקוס|שקד|סויה|שיבולת|אורז|אבקה|בננה|תות|קפה|ממותק|חלבון|עמיד|תינוק|מטרנה|גוף|פנים|ניקוי|משזף|הזנה|קרם|שיער|ידיים|רחצה/,
    requires: ["fat"],
    shelfLifeDays: 7,
    attributes: [
      fat(
        [
          [1.5, "1%"],
          [2.5, "2%"],
          [4.5, "3%"],
        ],
        1,
      ),
      { key: "lactose", hard: true, mismatchPenalty: 0, read: (n) => (/לקטוז|לקטז/.test(n) ? "free" : "regular") },
    ],
  },
  {
    key: "cottage",
    name: "קוטג'",
    unit: "g",
    weighted: false,
    match: /^(גבינת )?קוטג/,
    exclude: /עם |זיתים|בטעם|שום|עשבי|פלפל/,
    shelfLifeDays: 10,
    attributes: [
      fat(
        [
          [1.5, "1%"],
          [3.5, "3%"],
          [6, "5%"],
          [10, "9%"],
          [13, "12%"],
        ],
        1.5,
      ),
    ],
  },
  {
    key: "white-cheese",
    name: "גבינה לבנה",
    unit: "g",
    weighted: false,
    match: /^גבינה לבנה/,
    exclude: /עיזים|עזים|כבשים|בטעם|שום|זיתים/,
    shelfLifeDays: 14,
    attributes: [
      fat(
        [
          [1.5, "1%"],
          [3.5, "3%"],
          [6, "5%"],
          [10, "9%"],
        ],
        1.5,
      ),
    ],
  },
  {
    key: "butter",
    name: "חמאה",
    unit: "g",
    weighted: false,
    match: /^חמאה/,
    exclude: /בוטנים|שקד|קקאו|קשיו|צמחית|מרגרינה|עוגיות|שום|עשבי/,
    shelfLifeDays: 60,
    attributes: [
      {
        key: "salt",
        mismatchPenalty: 1,
        // "לל"ת מלח" / "ללא מלח" means unsalted, so check for it first.
        read: pick([
          [/ל"ת|ללא מלח|ללת/, "unsalted"],
          [/מלוח|עם מלח/, "salted"],
        ], "unsalted"),
      },
    ],
  },
  produce("tomatoes", "עגבניות", /^עגבני(ה|יה|ות)/, /שרי|קוביות|קצוצ|מרוסק|חתוכ|רסק|מיובש|לחה/, 7),
  produce("cucumbers", "מלפפונים", /^מלפפו/, /מלח|חומץ|כבוש|חמוצ|חמוץ|\//, 7),
  produce("onions", "בצל", /^בצל (יבש|לבן|אדום|סגול)\s*$/, undefined, 30, [
    { key: "color", mismatchPenalty: 1, read: pick([[/אדום|סגול/, "red"]], "white") },
  ]),
  produce("potatoes", "תפוחי אדמה", /^(תפוח|תפוחי) אדמה/, /מיקרוגל|צ'יפס|מטוגן|פירה|קפוא/, 30),
  produce("carrots", "גזר", /^גזר( ארוז| בתפזורת)?\s*$/, undefined, 21),
  produce("bananas", "בננות", /^בננ(ה|ות)\s*$/, undefined, 5),
  {
    key: "sugar",
    name: "סוכר לבן",
    unit: "g",
    weighted: false,
    match: /^סוכר( לבן)?\s*(דק|לבן)?\s*\d/,
    exclude: /חום|דמררה|קנים|אבקה|וניל|תחליף|קוקוס/,
    shelfLifeDays: 730,
    attributes: [],
  },
  {
    key: "flour",
    name: "קמח",
    unit: "g",
    weighted: false,
    match: /^קמח (לבן|חיטה|מלא|תופח|לחם)/,
    exclude: /כוסמין|שיפון|תירס|אורז|שקדים|ללא גלוטן|מצה/,
    shelfLifeDays: 365,
    attributes: [
      { key: "kind", mismatchPenalty: 2, read: pick([[/מלא/, "whole"], [/תופח/, "self-raising"]], "white") },
    ],
  },
  {
    key: "rice",
    name: "אורז",
    unit: "g",
    weighted: false,
    match: /^אורז/,
    exclude: /פריכיות|עוגיות|קרקר|משקה|חלב|אטריות|נייר|קמח|מוכן|תבשיל|בשקיות בישול/,
    shelfLifeDays: 730,
    attributes: [
      {
        key: "kind",
        mismatchPenalty: 2,
        read: pick(
          [
            [/בסמ[טת]י/, "basmati"],
            [/יסמין|תאילנדי/, "jasmine"],
            [/פרסי/, "persian"],
            [/מלא|חום/, "brown"],
            [/עגול|סושי/, "round"],
            [/פרא/, "wild"],
            [/אדום|שחור/, "red-black"],
          ],
          "white",
        ),
      },
    ],
  },
  {
    key: "cooking-oil",
    name: "שמן לבישול",
    unit: "ml",
    weighted: false,
    match: /^שמן (קנולה|סויה|חמניות|חמנייה|תירס)/,
    exclude: /תרסיס|ספריי/,
    shelfLifeDays: 365,
    attributes: [
      {
        key: "kind",
        mismatchPenalty: 1.5,
        read: pick([[/קנולה/, "canola"], [/סויה/, "soy"], [/חמני/, "sunflower"], [/תירס/, "corn"]]),
      },
    ],
  },
];

function produce(
  key: string,
  name: string,
  match: RegExp,
  exclude: RegExp | undefined,
  shelfLifeDays: number,
  attributes: AttributeDef[] = [],
): CategoryDef {
  return { key, name, unit: "g", weighted: true, match, exclude, attributes, shelfLifeDays };
}
