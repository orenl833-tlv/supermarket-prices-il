import type { RemoteFile } from "../types.js";

/** What the pipeline needs from each chain's portal. */
export interface ChainSource {
  code: string; // ChainID, e.g. 7290027600007
  name: string;
  /** The newest Stores file (list of branches). */
  latestStoresFile(): Promise<RemoteFile>;
  /** The newest full price file of one branch, or null if none is published. */
  latestPriceFullFile(storeCode: string): Promise<RemoteFile | null>;
  download(file: RemoteFile): Promise<Uint8Array>;
}

/** Pick the newest file by the timestamp in its name (names sort by time within one store). */
export function newest(files: RemoteFile[]): RemoteFile | null {
  return files.reduce<RemoteFile | null>(
    (best, f) => (best === null || f.name > best.name ? f : best),
    null,
  );
}
