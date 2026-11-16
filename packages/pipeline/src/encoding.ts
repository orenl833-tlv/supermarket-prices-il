import { gunzipSync } from "node:zlib";

/**
 * Decode a downloaded price file to text.
 *
 * Chains are not consistent: Rami Levy publishes its Stores file in UTF-16 LE
 * and its PriceFull files in UTF-8 with a BOM. We sniff the byte-order mark
 * and fall back to UTF-8. Gzipped input is unpacked first.
 */
export function decodeFile(bytes: Uint8Array): string {
  let data = bytes;
  if (data[0] === 0x1f && data[1] === 0x8b) {
    data = gunzipSync(data);
  }
  if (data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(data.subarray(2));
  }
  if (data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(data.subarray(2));
  }
  // TextDecoder drops a UTF-8 BOM by default.
  return new TextDecoder("utf-8").decode(data);
}
