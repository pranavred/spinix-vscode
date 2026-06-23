import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Ad {
  ad_id: string;
  campaign_id: string;
  ad_text: string;
  click_url: string;
  icon_url: string | null;
  brand: string | null;
  view_token?: string;
}

export interface Portfolio {
  ads: Ad[];
  ttl_seconds: number;
  view_threshold_seconds: number;
  /** Server-side killswitch state; when true the server returns no ads. */
  killed?: boolean;
}

/** Fetch the current ad portfolio and write the top ad to the CLI cache. */
export async function refreshPortfolio(
  backendUrl: string,
  dir: string,
  token: string | null,
  clientId: string,
): Promise<Portfolio | null> {
  const url = token
    ? `${backendUrl}/v1/portfolio?client_id=${encodeURIComponent(clientId)}`
    : `${backendUrl}/v1/portfolio/demo`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const blank = async () => {
    try {
      await writeFile(join(dir, "cli-ad.json"), JSON.stringify({}));
    } catch {
      /* ignore cache write errors */
    }
  };

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    // Network dark: fail closed so no stale ad lingers to meter. This used to be
    // the separate killswitch check's job; folding it here lets one fetch cover
    // both serving and the kill, halving the extension's request rate.
    await blank();
    return null;
  }
  if (!res.ok) {
    await blank();
    return null;
  }
  const pf = (await res.json()) as Portfolio;

  // The server enforces the killswitch: a killed response carries no ads. Blank
  // the cache on killed/empty so nothing is shown or metered.
  const ad = pf.killed ? undefined : pf.ads[0];
  try {
    await writeFile(join(dir, "cli-ad.json"), JSON.stringify(ad ?? {}));
  } catch {
    /* ignore cache write errors */
  }
  return pf;
}
