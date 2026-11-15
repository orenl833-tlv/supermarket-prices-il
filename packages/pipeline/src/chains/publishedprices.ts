import { parseFileName } from "../filename.js";
import { fetchBytes, fetchWithRetry } from "../http.js";
import type { RemoteFile } from "../types.js";
import { newest, type ChainSource } from "./types.js";

/**
 * url.publishedprices.co.il is a shared portal used by several chains.
 * Each chain publishes a username for public access, with an empty password.
 * Only use usernames a chain publishes itself.
 */
const BASE = "https://url.publishedprices.co.il";

export function publishedPricesChain(opts: {
  code: string;
  name: string;
  username: string;
}): ChainSource {
  let session: Session | null = null;
  const getSession = async () => (session ??= await login(opts.username));
  // One listing of all PriceFull files per run, instead of one request per store.
  let priceFullFiles: Promise<RemoteFile[]> | null = null;
  const allPriceFull = () =>
    (priceFullFiles ??= getSession().then((s) => s.list(`PriceFull${opts.code}`)));

  return {
    code: opts.code,
    name: opts.name,

    async latestStoresFile() {
      const file = newest(await (await getSession()).list(`Stores${opts.code}`));
      if (!file) throw new Error(`${opts.name}: no Stores file listed`);
      return file;
    },

    async latestPriceFullFile(storeCode) {
      const files = (await allPriceFull()).filter(
        (f) => parseFileName(f.name)?.storeCode === storeCode,
      );
      return newest(files);
    },

    async download(file) {
      return fetchBytes(file.url, { headers: { cookie: (await getSession()).cookie } });
    },
  };
}

interface Session {
  cookie: string;
  list(search: string): Promise<RemoteFile[]>;
}

async function login(username: string): Promise<Session> {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const remember = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair!.indexOf("=");
      jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
  };
  const csrf = async (path: string) => {
    const res = await fetchWithRetry(`${BASE}${path}`, { headers: { cookie: cookie() } });
    remember(res);
    const token = /name="csrftoken" content="([^"]+)"/.exec(await res.text())?.[1];
    if (!token) throw new Error(`publishedprices: no CSRF token on ${path}`);
    return token;
  };

  const loginToken = await csrf("/login");
  const res = await fetchWithRetry(`${BASE}/login/user`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password: "", csrftoken: loginToken }),
  });
  remember(res);
  if (res.status !== 302 || !res.headers.get("location")?.includes("/file")) {
    throw new Error(`publishedprices: login failed for ${username} (HTTP ${res.status})`);
  }

  const listToken = await csrf("/file");

  return {
    get cookie() {
      return cookie();
    },
    async list(search) {
      const res = await fetchWithRetry(`${BASE}/file/json/dir`, {
        method: "POST",
        headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          sEcho: "1",
          iDisplayStart: "0",
          iDisplayLength: "100000",
          sSearch: search,
          csrftoken: listToken,
          cd: "/",
        }),
      });
      if (!res.ok) throw new Error(`publishedprices listing: HTTP ${res.status}`);
      const body = (await res.json()) as { aaData?: Array<{ fname?: string }> };
      return (body.aaData ?? [])
        .map((row) => row.fname)
        .filter((name): name is string => !!name && name.startsWith(search))
        .map((name) => ({ name, url: `${BASE}/file/d/${encodeURIComponent(name)}` }));
    },
  };
}

export const ramiLevy = publishedPricesChain({
  code: "7290058140886",
  name: "רמי לוי",
  username: "RamiLevi",
});
