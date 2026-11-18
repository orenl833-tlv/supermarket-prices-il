import { parseFileName } from "../filename.js";
import type { RemoteFile } from "../types.js";

/** What the pipeline needs from each chain's portal. */
export interface ChainSource {
  code: string; // ChainID, e.g. 7290027600007
  name: string;
  /**
   * Branches to include even though their Stores entry has no usable city
   * (Yochananof sets City to 0). Checked by hand against the branch address.
   */
  extraStoreCodes?: string[];
  /** The newest Stores file (list of branches). */
  latestStoresFile(): Promise<RemoteFile>;
  /** The newest full price file of one branch, or null if none is published. */
  latestPriceFullFile(storeCode: string): Promise<RemoteFile | null>;
  /** The newest full promotion file of one branch, or null if none is published. */
  latestPromoFullFile(storeCode: string): Promise<RemoteFile | null>;
  download(file: RemoteFile): Promise<Uint8Array>;
}

/**
 * Pick the newest file by the timestamp in its name. Comparing names as
 * strings is not enough: "-7999-" sorts after "-000-" whatever the date.
 * Files whose name does not parse are ignored.
 */
export function newest(files: RemoteFile[]): RemoteFile | null {
  let best: { file: RemoteFile; time: number } | null = null;
  for (const file of files) {
    const time = parseFileName(file.name)?.time.getTime();
    if (time !== undefined && (best === null || time > best.time)) best = { file, time };
  }
  return best?.file ?? null;
}
