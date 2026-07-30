import { create } from 'zustand';
import { createClient, User } from '@supabase/supabase-js';

const supabaseUrl = "http://127.0.0.1:54321";
const supabaseAnonKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

console.log("Supabase URL:", supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface AuthState {
  user: User | null;
  role: string | null;
  isLoading: boolean;
  initialize: () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  isLoading: true,
  initialize: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ 
        user: session?.user ?? null, 
        role: session?.user?.user_metadata?.role || "Admin",
        isLoading: false 
      });
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ 
        user: session?.user ?? null, 
        role: session?.user?.user_metadata?.role || "Admin",
        isLoading: false 
      });
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
  }
}));
