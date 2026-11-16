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
    defaults: { size: "L", type: "regular" },
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
    defaults: { fat: "3%", lactose: "regular" },
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
    defaults: { fat: "5%" },
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
    defaults: { fat: "5%" },
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
    defaults: { salt: "unsalted" },
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
    defaults: { kind: "white" },
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
    // Everyday rice in Israel is Persian rice.
    defaults: { kind: "persian" },
    name: "אורז",
    unit: "g",
    weighted: false,
    match: /^אורז/,
    exclude: /פריכיות|עוגיות|קרקר|משקה|חלב|אטריות|נייר|קמח|מוכן|תבשיל|בשקיות בישול|\+|עדשים|טונה|ירקות|פטריות|מוקפץ|ממולא|תערובת/,
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
            [/עגול|סושי|סטיקי|דביק|ריזוטו|ארבוריו/, "round"],
            [/פרא/, "wild"],
            [/מיקס/, "mix"],
            [/אדום|שחור/, "red-black"],
          ],
          "white",
        ),
      },
    ],
  },
  {
    key: "cooking-oil",
    defaults: { kind: "canola" },
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
  {
    key: "pasta",
    name: "פסטה יבשה",
    unit: "g",
    weighted: false,
    match: /^(פסטה|ספגטי|ספגטיני|פנה|פוזילי|ספירלי|פרפלה)/,
    exclude:
      /רוטב|טונה|\+|מוכנ|גלוטן|ללג|(^|\s)מלאה?(\s|$)|כוסמין|עדשים|חומוס|ילדים|לזניה|ניוקי|טרי|ממולא|ברוטב|מוקפא|סלט|טורטל|רביולי|קפלטי/,
    shelfLifeDays: 730,
    attributes: [
      {
        key: "shape",
        mismatchPenalty: 1,
        read: (name) => (/ספגטי|לינגוויני|טגליאטלה|פטוצ/.test(name) ? "long" : "short"),
      },
    ],
  },
  {
    key: "tuna",
    defaults: { packed: "oil" },
    name: "טונה בקופסה",
    unit: "g",
    weighted: false,
    match: /^טונה/,
    exclude: /סלט|פסטה|עם |ממרח|ניסואז|חריף|לימון|פלפל|עגבני|שום|מתובל/,
    shelfLifeDays: 1095,
    attributes: [
      {
        key: "packed",
        mismatchPenalty: 1.5,
        read: pick([
          [/מים|מי מלח/, "water"],
          [/שמן|בש\./, "oil"],
        ]),
      },
      { key: "olive", mismatchPenalty: 1, read: (n) => (/זית/.test(n) ? "olive" : null) },
    ],
  },
  {
    key: "sour-cream",
    defaults: { fat: "15%" },
    name: "שמנת חמוצה",
    unit: "ml",
    weighted: false,
    match: /^שמנת חמוצה/,
    exclude: /צמחית|בטעם|שום|עשבי/,
    typicalSize: 200,
    shelfLifeDays: 21,
    attributes: [
      fat(
        [
          [10, "9%"],
          [17, "15%"],
          [25, "20%"],
          [35, "27-30%"],
        ],
        1,
      ),
    ],
  },
  {
    key: "cooking-cream",
    defaults: { fat: "15%" },
    name: "שמנת לבישול",
    unit: "ml",
    weighted: false,
    match: /^שמנת (ל)?בישול/,
    exclude: /צמחית|סויה|קוקוס|שקדים/,
    shelfLifeDays: 30,
    attributes: [
      fat(
        [
          [12, "10%"],
          [20, "15%"],
        ],
        0.5,
      ),
    ],
  },
  {
    key: "whipping-cream",
    defaults: { fat: "38%" },
    name: "שמנת מתוקה להקצפה",
    unit: "ml",
    weighted: false,
    match: /^שמנת ?(מתוקה )?ל?הקצפה|^שמנת מתוקה/,
    exclude: /צמחית|סויה|קוקוס|תרסיס|ספריי|מוקצפת/,
    typicalSize: 250,
    shelfLifeDays: 30,
    attributes: [
      fat(
        [
          [27, "24%"],
          [35, "32%"],
          [40, "38%"],
          [45, "42%"],
        ],
        0.5,
      ),
    ],
  },
  {
    key: "plain-yogurt",
    defaults: { fat: "3%", lactose: "regular" },
    name: "יוגורט טבעי",
    unit: "g",
    weighted: false,
    match: /^יוגורט( ביו| טבעי)/,
    exclude:
      /תות|וניל|פירות|שוקו|קפה|דבש|גרנולה|חלבון|GO|עיזים|עזים|כבשים|יווני|שתיה|משקה|אפרסק|בננה|דובדבן|ענבים|מנגו|טעם|לימון|תמר|ריבה/,
    shelfLifeDays: 21,
    attributes: [
      fat(
        [
          [0.5, "0%"],
          [2, "1.5%"],
          [4.5, "3%"],
        ],
        1,
      ),
      { key: "lactose", hard: true, mismatchPenalty: 0, read: (n) => (/לקטו|לקטז/.test(n) ? "free" : "regular") },
    ],
  },
  {
    key: "salt",
    defaults: { grain: "fine" },
    name: "מלח",
    unit: "g",
    weighted: false,
    match: /^מלח (שולחן|ים|בישול|הארץ|דק|גס|עדין)/,
    exclude: /לימון|הימלאיה|מופחת|ורוד|שום|צ'ילי|עשבי|שחור|פלפל|מעושן|לשטיפ/,
    shelfLifeDays: 3650,
    attributes: [{ key: "grain", mismatchPenalty: 1, read: pick([[/גס/, "coarse"]], "fine") }],
  },
  {
    key: "crushed-tomatoes",
    name: "עגבניות מרוסקות",
    unit: "g",
    weighted: false,
    match: /^עגבניות מרוסקות/,
    // Names are often cut short in the files: "מרוכ" (concentrate), "בזיל" (basil), "תוספ" (with additions).
    exclude: /בזיל|שום|פלפל|בצל|אורגני|עשבי|מרוכ|תוספ|עם /,
    shelfLifeDays: 730,
    attributes: [],
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
