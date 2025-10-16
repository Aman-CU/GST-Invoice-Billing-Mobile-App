export type ShopDetails = {
  id?: string;
  name: string;
  address: string;
  gst_number: string;
  state: string;
  phone?: string | null;
};

export type ProductItem = {
  name: string;
  quantity: number;
  unit_rate: number;
  discount_percentage: number;
  gst_rate: number;
};

export type CustomerDetails = {
  name: string;
  mobile: string;
  address?: string | null;
  state?: string | null;
};

export type Invoice = {
  id?: string;
  invoice_number?: string;
  shop_details: ShopDetails;
  customer_details: CustomerDetails;
  products: ProductItem[];
  reverse_charge?: boolean;
  qr_code_base64?: string | null;
  total_taxable_value?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_tax?: number;
  round_off?: number;
  final_amount?: number;
  amount_in_words?: string;
  created_at?: string;
};
