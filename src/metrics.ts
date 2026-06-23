/** POST a metric event to the Spinix backend. Best-effort; never throws. */
export async function postMetric(
  backendUrl: string,
  token: string | null,
  event: Record<string, unknown>,
): Promise<{ billed: boolean } | null> {
  const path = token ? "/v1/metrics" : "/v1/metrics/demo";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    if (!res.ok) return null;
    return (await res.json()) as { billed: boolean };
  } catch {
    return null;
  }
}
