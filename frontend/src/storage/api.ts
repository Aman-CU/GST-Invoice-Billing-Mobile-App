import { Invoice, ShopDetails } from './types';

const API_BASE = process.env.EXPO_PUBLIC_NODE_API_URL || process.env.EXPO_PUBLIC_BACKEND_URL || '';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 120)}`);
  }
  if (!contentType.includes('application/json')) {
    const t = await res.text().catch(() => '');
    throw new Error(`Unexpected response format (${contentType || 'unknown'}): ${t.slice(0, 120)}`);
  }
  return res.json();
}

export const Api = {
  async getShops(): Promise<ShopDetails[]> {
    if (!API_BASE) throw new Error('API base URL not configured');
    return getJson<ShopDetails[]>(`${API_BASE}/api/shop`);
  },
  async createShop(shop: ShopDetails): Promise<ShopDetails> {
    if (!API_BASE) throw new Error('API base URL not configured');
    return getJson<ShopDetails>(`${API_BASE}/api/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shop),
    });
  },
  async getInvoices(): Promise<Invoice[]> {
    if (!API_BASE) throw new Error('API base URL not configured');
    return getJson<Invoice[]>(`${API_BASE}/api/invoices`);
  },
  async getInvoice(id: string): Promise<Invoice> {
    if (!API_BASE) throw new Error('API base URL not configured');
    return getJson<Invoice>(`${API_BASE}/api/invoices/${id}`);
  },
  async createInvoice(inv: Invoice): Promise<Invoice> {
    if (!API_BASE) throw new Error('API base URL not configured');
    return getJson<Invoice>(`${API_BASE}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv),
    });
  },
  async deleteInvoice(id: string): Promise<void> {
    if (!API_BASE) throw new Error('API base URL not configured');
    const res = await fetch(`${API_BASE}/api/invoices/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  },
};
