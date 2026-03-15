type BrowserVersionResponse = {
  webSocketDebuggerUrl?: unknown;
};

type FetchResponse = {
  ok: boolean;
  json: () => Promise<BrowserVersionResponse>;
};

type FetchLike = (input: string) => Promise<FetchResponse>;

export async function getExistingBrowserWSEndpoint(
  port: number,
  fetchLike: FetchLike = (input) => fetch(input) as Promise<FetchResponse>,
) {
  try {
    const response = await fetchLike(`http://127.0.0.1:${port}/json/version`);

    if (!response.ok) {
      return null;
    }

    const body = await response.json();

    return typeof body.webSocketDebuggerUrl === 'string' ? body.webSocketDebuggerUrl : null;
  } catch {
    return null;
  }
}
