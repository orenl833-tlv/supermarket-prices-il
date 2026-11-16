/** A branch, as listed in a chain's Stores file. */
export interface StoreRecord {
  storeCode: string; // without leading zeros, e.g. "733"
  name: string;
  address: string | null;
  cityCode: string | null; // CBS locality code, "5000" = Tel Aviv-Yafo
}

export type Unit = "g" | "ml" | "unit" | "m";

/** One product line from a PriceFull file, normalized across chains. */
export interface PriceItem {
  itemCode: string;
  /** true when itemCode is a global barcode (ItemType 1), false for a chain-internal code. */
  isBarcode: boolean;
  name: string;
  manufacturer: string | null;
  quantity: number | null; // in `unit`
  unit: Unit | null;
  isWeighted: boolean;
  price: number;
}

export interface PriceFile {
  chainCode: string;
  storeCode: string;
  items: PriceItem[];
  /** Lines that could not be used (missing code, bad price), counted for quality checks. */
  skipped: number;
}

/** A file listed on a chain portal. */
export interface RemoteFile {
  name: string; // e.g. PriceFull7290027600007-001-001-20261115-030000.gz
  url: string;
}
