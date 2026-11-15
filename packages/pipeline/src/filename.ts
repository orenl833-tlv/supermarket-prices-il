/**
 * Parse the standard file name used by all chains:
 *   PriceFull<chain>-<subchain>-<store>-<YYYYMMDD>-<HHMM[SS]>.gz
 *   Stores<chain>-<subchain>-<YYYYMMDD>-<HHMMSS>.xml
 *
 * File times are Israel local time. We keep them as an ISO string with the
 * Asia/Jerusalem offset of that date, so Postgres stores the right instant.
 */
export interface FileNameInfo {
  kind: string; // "PriceFull", "Price", "Stores", ...
  chainCode: string;
  storeCode: string | null; // without leading zeros; null for Stores files
  time: Date;
}

const PATTERN =
  /^([A-Za-z]+)(\d{13})-(\d+)(?:-(\d+))?-(\d{8})-(\d{4,6})(?:\.\w+)*$/;

export function parseFileName(name: string): FileNameInfo | null {
  const m = PATTERN.exec(name);
  if (!m) return null;
  const [, kind, chainCode, , store, date, time] = m;
  if (!kind || !chainCode || !date || !time) return null;
  return {
    kind,
    chainCode,
    storeCode: store ? stripZeros(store) : null,
    time: israelTimeToDate(date, time.padEnd(6, "0")),
  };
}

export function stripZeros(code: string): string {
  return code.replace(/^0+(?=\d)/, "");
}

function israelTimeToDate(yyyymmdd: string, hhmmss: string): Date {
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
  // Treat the wall-clock time as UTC, then subtract Israel's offset at that moment.
  const asUtc = new Date(`${iso}Z`);
  return new Date(asUtc.getTime() - israelOffsetMinutes(asUtc) * 60_000);
}

function israelOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT+02:00" or "GMT+03:00"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!m) return 120;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}
