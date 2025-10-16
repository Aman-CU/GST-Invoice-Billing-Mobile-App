import { getDb } from './db';
import { Invoice, ShopDetails } from './types';
import { customAlphabet } from 'nanoid/non-secure';

const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16);

export async function getShopsLocal(): Promise<ShopDetails[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM shops ORDER BY datetime(created_at) DESC');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    gst_number: r.gst_number,
    state: r.state,
    phone: r.phone,
  }));
}

export async function saveShopLocal(shop: ShopDetails): Promise<ShopDetails> {
  const db = await getDb();
  const id = shop.id || nano();
  await db.runAsync(
    `INSERT OR REPLACE INTO shops (id, name, address, gst_number, state, phone) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, shop.name, shop.address, shop.gst_number, shop.state, shop.phone || null]
  );
  return { ...shop, id };
}

export async function getInvoicesLocal(): Promise<Invoice[]> {
  const db = await getDb();
  const invoices = await db.getAllAsync<any>('SELECT * FROM invoices ORDER BY datetime(created_at) DESC');
  const items = await db.getAllAsync<any>('SELECT * FROM invoice_items');
  const byInvoice: Record<string, any[]> = {};
  for (const it of items) {
    (byInvoice[it.invoice_id] ||= []).push({
      name: it.name,
      quantity: it.quantity,
      unit_rate: it.unit_rate,
      discount_percentage: it.discount_percentage,
      gst_rate: it.gst_rate,
    });
  }
  return invoices.map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    shop_details: JSON.parse(inv.shop_details_json),
    customer_details: JSON.parse(inv.customer_details_json),
    products: byInvoice[inv.id] || [],
    reverse_charge: !!inv.reverse_charge,
    qr_code_base64: inv.qr_code_base64,
    total_taxable_value: inv.total_taxable_value,
    total_cgst: inv.total_cgst,
    total_sgst: inv.total_sgst,
    total_tax: inv.total_tax,
    round_off: inv.round_off,
    final_amount: inv.final_amount,
    amount_in_words: inv.amount_in_words,
    created_at: inv.created_at,
  }));
}

export async function saveInvoiceLocal(inv: Invoice): Promise<Invoice> {
  const db = await getDb();
  const id = inv.id || nano();
  await db.runAsync(
    `INSERT OR REPLACE INTO invoices (
      id, invoice_number, shop_details_json, customer_details_json, reverse_charge, qr_code_base64,
      total_taxable_value, total_cgst, total_sgst, total_tax, round_off, final_amount, amount_in_words
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      inv.invoice_number || null,
      JSON.stringify(inv.shop_details),
      JSON.stringify(inv.customer_details),
      inv.reverse_charge ? 1 : 0,
      inv.qr_code_base64 || null,
      inv.total_taxable_value || 0,
      inv.total_cgst || 0,
      inv.total_sgst || 0,
      inv.total_tax || 0,
      inv.round_off || 0,
      inv.final_amount || 0,
      inv.amount_in_words || '',
    ]
  );
  if (Array.isArray(inv.products)) {
    await db.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    for (const p of inv.products) {
      await db.runAsync(
        `INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_rate, discount_percentage, gst_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nano(), id, p.name, p.quantity, p.unit_rate, p.discount_percentage || 0, p.gst_rate || 18]
      );
    }
  }
  return { ...inv, id };
}

export async function deleteInvoiceLocal(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
  await db.runAsync('DELETE FROM invoices WHERE id = ?', [id]);
}

export async function enqueue(type: string, payload: any) {
  const db = await getDb();
  await db.runAsync('INSERT INTO outbox (id, type, payload_json) VALUES (?, ?, ?)', [nano(), type, JSON.stringify(payload)]);
}

export async function getOutbox(): Promise<{ id: string; type: string; payload: any }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM outbox ORDER BY datetime(created_at) ASC');
  return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload_json) }));
}

export async function deleteOutboxById(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
}

// App settings helpers (persist default QR code, etc.)
const DEFAULT_QR_KEY = 'default_qr_base64';

export async function getDefaultQr(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>('SELECT value FROM app_settings WHERE key = ?', [DEFAULT_QR_KEY]);
  return row?.value ?? null;
}

export async function setDefaultQr(base64: string | null): Promise<void> {
  const db = await getDb();
  if (base64 == null || base64 === '') {
    await db.runAsync('DELETE FROM app_settings WHERE key = ?', [DEFAULT_QR_KEY]);
    return;
  }
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [DEFAULT_QR_KEY, base64]);
}

export async function clearDefaultQr(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM app_settings WHERE key = ?', [DEFAULT_QR_KEY]);
}
