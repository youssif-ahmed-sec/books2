import { create } from 'zustand';
import { supabase } from './useAuthStore';


export type TransactionType = 'Receiving' | 'Issuing' | 'Transfer' | 'Adjustment' | 'Counting';

export interface InventoryBalance {
  id: string;
  product_id: string;
  warehouse_id: string;
  current_stock: number;
  updated_at: string;
  product_name?: string;
  warehouse_name?: string;
}

export interface InventoryStats {
  today_movements: number;
  low_stock_count: number;
  critical_stock_count: number;
  total_value: number;
}

export interface InventoryTransactionRecent extends InventoryTransaction {
  id: string;
  product_name: string;
  created_at: string;
}

export interface InventoryTransaction {
  id?: string;
  product_id: string;
  warehouse_id: string;
  transaction_type: TransactionType;
  quantity_changed: number;
  reference_document?: string;
  notes?: string;
}

interface InventoryState {
  // Data
  balances: InventoryBalance[];
  stats: InventoryStats | null;
  recentTransactions: InventoryTransactionRecent[];
  isLoading: boolean;
  error: string | null;

  // UI State
  isTransactionModalOpen: boolean;
  selectedProductId: string | null;

  // Actions
  setBalances: (balances: InventoryBalance[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // UI Actions
  openTransactionModal: (productId?: string) => void;
  closeTransactionModal: () => void;
  
  // Async Actions
  fetchBalances: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchRecentTransactions: () => Promise<void>;
  submitTransaction: (transaction: InventoryTransaction) => Promise<boolean>;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  // Data
  balances: [],
  stats: null,
  recentTransactions: [],
  isLoading: false,
  error: null,

  // UI State
  isTransactionModalOpen: false,
  selectedProductId: null,

  // Actions
  setBalances: (balances) => set({ balances }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // UI Actions
  openTransactionModal: (productId?: string) => set({ isTransactionModalOpen: true, selectedProductId: productId ?? null }),
  closeTransactionModal: () => set({ isTransactionModalOpen: false, selectedProductId: null }),

  // Async Actions
  fetchBalances: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const response = await fetch('/api/v1/inventory/balances', { headers }); // Assuming Next.js rewrites or proxy
      if (!response.ok) throw new Error('Failed to fetch inventory balances');
      const data = await response.json();
      set({ balances: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'An error occurred', isLoading: false });
    }
  },

  fetchStats: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const response = await fetch('/api/v1/inventory/stats', { headers });
      if (response.ok) {
        const data = await response.json();
        set({ stats: data });
      }
    } catch (err) {
      console.error("Failed to fetch stats", err);
    }
  },

  fetchRecentTransactions: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const response = await fetch('/api/v1/inventory/transactions/recent', { headers });
      if (response.ok) {
        const data = await response.json();
        set({ recentTransactions: data });
      }
    } catch (err) {
      console.error("Failed to fetch recent transactions", err);
    }
  },

  submitTransaction: async (transaction) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
      };

      const response = await fetch('/api/v1/inventory/transactions', {
        method: 'POST',
        headers,
        body: JSON.stringify(transaction),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to submit transaction');
      }
      
      // Re-fetch balances, stats, and recent transactions to get the updated stock
      await get().fetchBalances();
      await get().fetchStats();
      await get().fetchRecentTransactions();
      set({ isTransactionModalOpen: false, selectedProductId: null });
      return true;
    } catch (err: any) {
      set({ error: err.message || 'Failed to submit transaction', isLoading: false });
      return false;
    }
  }
}));
