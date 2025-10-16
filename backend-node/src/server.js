import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
app.use(express.json({ limit: '2mb' }));

// Supabase client (service role key required for server-side writes without auth)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Health
app.get('/api', (_req, res) => {
  res.json({ message: 'GST Billing Node API' });
});

// Shops
app.get('/api/shop', async (_req, res) => {
  const { data, error } = await supabase.from('shops').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/shop', async (req, res) => {
  const { name, address, gst_number, state, phone } = req.body || {};
  if (!name || !address || !gst_number || !state) return res.status(400).json({ error: 'Missing fields' });
  const id = nanoid();
  const payload = { id, name, address, gst_number, state, phone: phone || null };
  const { data, error } = await supabase.from('shops').insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Invoices
app.get('/api/invoices', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const { data, error } = await supabase
    .from('invoices_view')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'Invoice not found' });
  const { data: items, error: itemsErr } = await supabase.from('invoice_items').select('*').eq('invoice_id', id);
  if (itemsErr) return res.status(500).json({ error: itemsErr.message });
  res.json({ ...data, products: items });
});

app.post('/api/invoices', async (req, res) => {
  const inv = req.body;
  if (!inv || !inv.shop_details || !inv.customer_details || !Array.isArray(inv.products)) {
    return res.status(400).json({ error: 'Invalid invoice payload' });
  }
  // Allow client-provided id/invoice_number; otherwise generate
  const id = inv.id || nanoid();
  const invoice_number = inv.invoice_number || `INV-${Date.now()}`;

  // Insert invoice
  const invoicePayload = {
    id,
    invoice_number,
    shop_details: inv.shop_details,
    customer_details: inv.customer_details,
    reverse_charge: !!inv.reverse_charge,
    qr_code_base64: inv.qr_code_base64 || null,
    total_taxable_value: inv.total_taxable_value || 0,
    total_cgst: inv.total_cgst || 0,
    total_sgst: inv.total_sgst || 0,
    total_tax: inv.total_tax || 0,
    round_off: inv.round_off || 0,
    final_amount: inv.final_amount || 0,
    amount_in_words: inv.amount_in_words || '',
  };

  const { error: invErr } = await supabase.from('invoices').insert(invoicePayload);
  if (invErr) return res.status(500).json({ error: invErr.message });

  // Insert items
  const itemsPayload = (inv.products || []).map((p) => ({
    id: nanoid(),
    invoice_id: id,
    name: p.name,
    quantity: p.quantity,
    unit_rate: p.unit_rate,
    discount_percentage: p.discount_percentage || 0,
    gst_rate: p.gst_rate || 18,
  }));

  if (itemsPayload.length) {
    const { error: itemsErr } = await supabase.from('invoice_items').insert(itemsPayload);
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });
  }

  res.status(201).json({ id, invoice_number, ...invoicePayload, products: itemsPayload });
});

app.delete('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  const { error: itemsErr } = await supabase.from('invoice_items').delete().eq('invoice_id', id);
  if (itemsErr) return res.status(500).json({ error: itemsErr.message });
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ message: 'Invoice deleted successfully' });
});

app.listen(PORT, () => {
  console.log(`Node API listening on http://localhost:${PORT}`);
});
