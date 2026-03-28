export type Category = {
  id: string | number;
  name: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  category_id?: string | number;
  category_name?: string;
  category?: string;
  total_procured?: number;
  total_checked_out?: number;
  current_count?: number;
  count?: number;
  pack_size?: number;
};

export type RequestLineItem = {
  category_id: string | number;
  quantity: number;
  category_name: string;
};

export type Request = {
  id: string;
  request_id: string | number;
  requester_name: string;
  requester_email?: string;
  requester_phone?: string;
  department: string;
  event_name: string;
  check_out_date: string;
  check_in_date: string;
  status: string;
  line_items: RequestLineItem[];
  handled_by?: string;
};

export type KitComponent = {
  id: number;
  item_number: string;
  category_id: number;
  yield_multiplier: number;
  category_name: string;
};

export type Item = {
  item_number: string;
  vendor: string;
  type: string;
  name: string;
  price: number;
  pack_size: number;
  reorder_url?: string;
  kit_components: KitComponent[];
};
