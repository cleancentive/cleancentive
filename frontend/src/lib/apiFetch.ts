/**
 * Turn a non-2xx `fetch` response into a thrown Error, so a mutation cannot fall through to
 * its success path. The message is the API's `message` field when the body is JSON (Nest's
 * BadRequest/NotFound shape), otherwise `HTTP <status>` — e.g. `HTTP 502` when Caddy answers
 * for a backend that is restarting.
 */
export async function throwIfNotOk(res: Response): Promise<Response> {
  if (res.ok) return res
  const data = await res.json().catch(() => null) as { message?: unknown } | null
  const message = typeof data?.message === 'string' && data.message.trim()
    ? data.message
    : Array.isArray(data?.message) && data.message.length > 0
      ? String(data.message[0])
      : `HTTP ${res.status}`
  throw new Error(message)
}

/** Message for a failed request, whether it was rejected by the API or never reached it. */
export function requestErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}
