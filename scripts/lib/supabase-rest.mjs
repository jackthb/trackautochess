/**
 * Minimal PostgREST client for the standalone Node scripts.
 *
 * The desktop app and the web viewer both use `@supabase/supabase-js`, but the
 * scripts run outside any bundler and only need a handful of verbs, so they
 * hand-rolled this. Two copies had grown — one in the Cronicle poller, one in
 * the legacy-snapshot importer — and drifted (`searchParams.append` vs `.set`,
 * and only one guarding the error-body read). This is the merged version.
 */
export class SupabaseRest {
  constructor(url, key) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    this.key = key;
  }

  async request(path, { method = "GET", query, body, headers = {} } = {}) {
    const url = new URL(`${this.base}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      // Tolerate an unreadable body so the thrown error still names the status.
      const text = await response.text().catch(() => "");
      throw new Error(`${method} ${url.pathname}${url.search} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  select(table, query) {
    return this.request(table, { query });
  }

  upsert(table, rows, onConflict) {
    return this.request(table, {
      method: "POST",
      query: { on_conflict: onConflict },
      body: rows,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }

  patch(table, query, body) {
    return this.request(table, {
      method: "PATCH",
      query,
      body,
      headers: { Prefer: "return=minimal" },
    });
  }

  rpc(functionName, body) {
    return this.request(`rpc/${functionName}`, {
      method: "POST",
      body,
      headers: { Prefer: "return=minimal" },
    });
  }

  delete(table, query) {
    return this.request(table, {
      method: "DELETE",
      query,
      headers: { Prefer: "return=minimal" },
    });
  }
}
