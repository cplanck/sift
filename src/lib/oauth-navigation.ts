export function oauthSearchQuery(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return query.toString();
}

// The provider adds code/state (or an error) to the registered callback. The
// browser may only follow that callback, never an unrelated response URL.
export function isOAuthCallback(candidate: string, registered: string) {
  try {
    const destination = new URL(candidate), callback = new URL(registered);
    const supported = ["https:", "http:"].includes(destination.protocol)
      || (destination.protocol.includes(".") && !destination.host); // Registered native reverse-domain callback.
    const preservesQuery = [...new Set(callback.searchParams.keys())].every((key) => {
      const expected = callback.searchParams.getAll(key), actual = destination.searchParams.getAll(key);
      return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
    });
    return supported && destination.protocol === callback.protocol
      && destination.host === callback.host
      && destination.pathname === callback.pathname
      && !destination.username && !destination.password
      && !destination.hash && preservesQuery;
  } catch { return false; }
}
