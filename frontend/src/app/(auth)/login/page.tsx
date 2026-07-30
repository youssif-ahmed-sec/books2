"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

// Initialize Supabase client safely
const supabaseUrl = "http://127.0.0.1:54321";
const supabaseAnonKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Authenticate with Supabase
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      const user = data.user;
      if (!user) throw new Error("No user returned from Supabase.");

      // 2. Sync with backend API
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
      const response = await fetch(`${apiUrl}/auth/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: user.id,
          email: user.email,
          role: "Admin" // For phase 1, role parsing can be extended via metadata
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to sync user with backend.");
      }

      // 3. Redirect to dashboard
      router.push("/inventory");

    } catch (err: any) {
      setError(err.message || "An error occurred during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen relative text-on-surface">
      {/* Atmospheric Background */}
      <div className="fixed inset-0 overflow-hidden -z-10 bg-mesh">
        <div className="bg-grid-pattern absolute inset-0 opacity-20"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[120px]"></div>
      </div>

      <main className="w-full max-w-[480px] px-margin-mobile md:px-0 py-8 fade-in-up">
        {/* Login Card */}
        <div className="glass-card p-8 md:p-12 relative overflow-hidden">
          {/* Header Section */}
          <header className="flex flex-col items-center mb-10">
            {/* Brand Logo */}
            <div className="w-24 h-24 mb-8 flex items-center justify-center bg-white rounded-2xl p-4 shadow-2xl transition-transform hover:scale-105 duration-500">
              <Image 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCnYzlCHXbTGRvUDf6QHYXyoiCWMmMDs049CGlXG6JwSIv6GaCKxmUyNOQ7jtsO6PlsF9PmSc7V8YNKZHIeSzMaYo8mWmbEkQky7eJkcAx1OfUAniX7ImtIjnOEAWzZEImCOqyCrC4TuHat5Q2R2Wr8JBRrjZj4zZ0FvETgVu16tAsChqvrWXKnw6j2e6tGD2tHf9URiKzPbhb70oFTLMI4MwWO7QRyjxqSGmlKK5EuBwybQA5FB71HeDbcmtpavb6Ujw" 
                alt="مكتبة سعود الشافعي" 
                width={96} 
                height={96} 
                className="w-full h-full object-contain" 
              />
            </div>
            {/* Access Badge */}
            <div className="badge-glow inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-6">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              <span className="text-[11px] font-bold tracking-widest text-primary uppercase">Secure Employee Access</span>
            </div>
            <h1 className="text-display-lg-mobile md:text-headline-md font-bold text-on-surface text-center mb-2">تسجيل الدخول للنظام</h1>
            <p className="text-body-md text-on-surface-variant text-center opacity-80">نظام إدارة الموارد - الإصدار ٢٠٢٦</p>
          </header>

          {/* Login Form */}
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-error-container text-on-error-container p-4 rounded-xl text-sm">
                {error}
              </div>
            )}
            
            {/* Username/Email Field */}
            <div className="space-y-2">
              <label className="text-label-sm text-on-surface-variant block mr-1" htmlFor="email">
                البريد الإلكتروني المهني
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 pr-5 flex items-center pointer-events-none text-on-surface-variant/60 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">account_circle</span>
                </div>
                <input 
                  className="w-full pr-14 pl-5 py-4 bg-surface-container-low border-white/5 border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-body-md text-on-surface placeholder:text-on-surface-variant/30" 
                  id="email" 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@saudalshafie.com" 
                  required 
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex justify-between items-center mr-1">
                <label className="text-label-sm text-on-surface-variant block" htmlFor="password">
                  كلمة المرور المشفرة
                </label>
                <a className="text-label-sm text-primary hover:text-primary-fixed-dim transition-all underline decoration-primary/20 underline-offset-4" href="#">نسيت كلمة المرور؟</a>
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 pr-5 flex items-center pointer-events-none text-on-surface-variant/60 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">key</span>
                </div>
                <input 
                  className="w-full pr-14 pl-14 py-4 bg-surface-container-low border-white/5 border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-body-md text-on-surface placeholder:text-on-surface-variant/30" 
                  id="password" 
                  type={showPassword ? "text" : "password"} 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••" 
                  required 
                />
                <button 
                  className="absolute inset-y-0 left-0 pl-5 flex items-center text-on-surface-variant/60 hover:text-primary transition-colors" 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 bg-primary hover:bg-primary-fixed-dim text-on-primary font-bold rounded-xl transition-all shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin">refresh</span>
              ) : (
                <>
                  <span>دخول آمن</span>
                  <span className="material-symbols-outlined text-[20px]">arrow_left_alt</span>
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
