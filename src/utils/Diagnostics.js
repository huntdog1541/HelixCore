export class Diagnostics {
  constructor() {
    this.enabled = Boolean(import.meta.env?.DEV);
    this.endpoint = import.meta.env?.VITE_DIAGNOSTICS_ENDPOINT || '';
    this.ipEndpoint = import.meta.env?.VITE_DIAGNOSTICS_IP_ENDPOINT || '';
    this._cachedIp = null;
  }

  async resolveIpAddress() {
    if (!this.enabled) return null;
    if (this._cachedIp) return this._cachedIp;

    if (!this.ipEndpoint) {
      this._cachedIp = 'unavailable (set VITE_DIAGNOSTICS_IP_ENDPOINT)';
      return this._cachedIp;
    }

    try {
      const res = await fetch(this.ipEndpoint, { method: 'GET' });
      const data = await res.json();
      const ip = data?.ip || data?.address || data?.clientIp || 'unknown';
      this._cachedIp = ip;
      return ip;
    } catch {
      this._cachedIp = 'unavailable (lookup failed)';
      return this._cachedIp;
    }
  }

  async logExecution(payload) {
    if (!this.enabled) return;

    const body = {
      ...payload,
      diagnosticsMode: 'dev',
      timestamp: new Date().toISOString(),
      userIpAddress: await this.resolveIpAddress(),
    };

    console.info('[HelixCore:diagnostics]', body);

    if (!this.endpoint) return;

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn('[HelixCore:diagnostics] failed to post', err);
    }
  }
}
