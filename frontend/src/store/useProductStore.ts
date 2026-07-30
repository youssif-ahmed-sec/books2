import { create } from 'zustand';
import { supabase } from './useAuthStore';

export type PriceLevelEnum = 'Retail' | 'Semi Wholesale' | 'Wholesale' | 'Super Wholesale' | 'VIP';

export interface ProductPrice {
  id?: string;
  product_id?: string;
  unit_id?: string;
  price_level: PriceLevelEnum;
  price: number;
}

export interface ProductUnit {
  id?: string;
  product_id?: string;
  unit_name: string;
  conversion_factor: number;
  barcode?: string;
  prices: ProductPrice[];
}

export interface Product {
  id?: string;
  sku: string;
  barcode?: string;
  name_en: string;
  name_ar: string;
  category_id?: string;
  subcategory_id?: string;
  brand_id?: string;
  supplier_id?: string;
  base_unit: string;
  cost: number;
  tax_rate: number;
  min_stock_level: number;
  is_active?: boolean;
  units: ProductUnit[];
}

export interface Category {
  id: string;
  name_en: string;
  name_ar: string;
}

interface ProductState {
  // Data
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;

  // UI State
  isProductModalOpen: boolean;
  selectedProduct: Product | null;
  searchQuery: string;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSearchQuery: (query: string) => void;
  
  // UI Actions
  openProductModal: (product?: Product | null) => void;
  closeProductModal: () => void;
  
  // Async Actions
  fetchProducts: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  saveProduct: (product: Product) => Promise<boolean>;
}

export const useProductStore = create<ProductState>((set, get) => ({
  // Data
  products: [],
  categories: [],
  isLoading: false,
  error: null,

  // UI State
  isProductModalOpen: false,
  selectedProduct: null,
  searchQuery: '',

  // Actions
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // UI Actions
  openProductModal: (product = null) => set({ isProductModalOpen: true, selectedProduct: product }),
  closeProductModal: () => set({ isProductModalOpen: false, selectedProduct: null }),

  // Async Actions
  fetchProducts: async () => {
    set({ isLoading: true, error: null });
    try {
      const query = get().searchQuery;
      const url = query ? `/api/v1/products?search=${encodeURIComponent(query)}` : '/api/v1/products';
      
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error('Failed to fetch products');
      const data = await response.json();
      set({ products: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'An error occurred', isLoading: false });
    }
  },

  fetchCategories: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const response = await fetch('/api/v1/products/categories', { headers });
      if (response.ok) {
        const data = await response.json();
        set({ categories: data });
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  },

  saveProduct: async (product) => {
    set({ isLoading: true, error: null });
    try {
      const isEditing = !!product.id;
      const url = isEditing ? `/api/v1/products/${product.id}` : '/api/v1/products';
      const method = isEditing ? 'PUT' : 'POST';
      
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
      };
      
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(product),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save product');
      }
      
      await get().fetchProducts();
      set({ isProductModalOpen: false, selectedProduct: null, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.message || 'Failed to save product', isLoading: false });
      return false;
    }
  }
}));
