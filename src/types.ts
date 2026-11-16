export type UserRole = 'super_admin' | 'admin' | 'audit' | 'user' | 'staff';

export type CategoryItemType = 'reusable' | 'consumable';

export type RequestStatus =
  | 'Awaiting'
  | 'Approved'
  | 'Awaiting Pick Up'
  | 'Checked-out'
  | 'Checked-in'
  | 'Denied'
  | 'Stationed Usage'
  | 'Test';

export type Category = {
  id: string | number;
  name: string;
  item_type?: CategoryItemType;
  image_url?: string;
  kit_yield?: number;
  low_stock_threshold?: number;
  is_requestable?: number;
  current_count?: number;
  total_procured?: number;
  total_checked_out?: number;
  currently_deployed?: number;
  available_to_promise?: number;
  reserved_count?: number;
  bulk_unit_label?: string;
  bulk_unit_size?: number;
  is_deleted?: boolean;
};

export type InventoryItem = {
  id: string;
  name: string;
  item_type?: CategoryItemType;
  category_id?: string | number;
  category_name?: string;
  category?: string;
  image_url?: string;
  kit_yield?: number;
  is_requestable?: number;
  total_procured?: number;
  total_checked_out?: number;
  currently_deployed?: number;
  current_count?: number;
  count?: number;
  pack_size?: number;
  available_to_promise?: number;
  reserved_count?: number;
  bulk_unit_label?: string;
  bulk_unit_size?: number;
  is_deleted?: boolean;
};

export type RequestLineItem = {
  category_id: string | number;
  quantity: number;
  category_name: string;
  pack_hint?: string;
};

export type Request = {
  id: string;
  request_id?: string | number;
  requester_name: string;
  requester_email?: string;
  requester_phone?: string;
  department: string;
  event_name: string;
  check_out_date: string;
  check_in_date: string;
  status: RequestStatus | string;
  line_items: RequestLineItem[];
  handled_by?: string;
  is_deleted?: boolean;
  is_recurring_instance?: boolean;
  created_at?: string;
};

export type KitComponent = {
  id?: number;
  item_number?: string;
  category_id: string | number;
  yield_multiplier: number;
  category_name?: string;
};

export type Item = {
  id?: string;
  item_number: string;
  vendor: string;
  type: string;
  name: string;
  price: number;
  pack_size: number;
  reorder_url?: string;
  image_url?: string;
  current_count?: number;
  total_procured?: number;
  total_checked_out?: number;
  is_deleted?: boolean;
  kit_components: KitComponent[];
};

export type ConsumableFulfillmentMode = 'per_cycle' | 'on_demand';

export type RecurringFrequency =
  | 'weekly'
  | 'monthly_exact'
  | 'monthly_nth_weekday'
  | 'quarterly'
  | 'annually'
  | 'on_demand';

export type RecurringTemplate = {
  id: string;
  department: string;
  event_name: string;
  frequency: RecurringFrequency;
  next_run_date: string | null;
  line_items: RequestLineItem[];
  is_stationed: boolean;
  stationed_schema_v2?: boolean;
  consumable_mode?: ConsumableFulfillmentMode;
  ordinal?: string;
  weekday?: string;
  is_deleted?: boolean;
  created_at?: string;
};
