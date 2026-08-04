"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    try {
      const formData = new URLSearchParams();
      formData.append("username", email);
      formData.append("password", password);

      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "فشل تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.");
      }

      const data = await res.json();
      localStorage.setItem("access_token", data.access_token);
      window.location.href = "/inventory";
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Atmospheric Background */}
      <div className="fixed inset-0 -z-10" style={{
        backgroundColor: "#131313",
        backgroundImage: `
          radial-gradient(at 0% 0%, hsla(25, 100%, 50%, 0.15) 0px, transparent 50%),
          radial-gradient(at 100% 0%, hsla(25, 100%, 50%, 0.10) 0px, transparent 50%),
          radial-gradient(at 50% 100%, hsla(25, 100%, 50%, 0.05) 0px, transparent 50%)
        `,
      }}>
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255, 107, 0, 0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 107, 0, 0.05) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }}
        />
        {/* Ambient blurs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[120px]" />
      </div>

      {/* Login Card */}
      <main
        className="w-full max-w-[480px] px-5 md:px-0 py-8 animate-fade-in"
        style={{ animationDelay: "0ms" }}
      >
        <div
          className="relative overflow-hidden p-8 md:p-12"
          style={{
            background: "rgba(28, 27, 27, 0.7)",
            backdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255, 182, 147, 0.1)",
            borderRadius: "2rem",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* Header */}
          <header className="flex flex-col items-center mb-10">
            {/* Logo */}
            <div className="w-24 h-24 mb-8 flex items-center justify-center bg-white rounded-2xl p-4 shadow-2xl hover:scale-105 transition-transform duration-500 cursor-pointer">
              <Image
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCnYzlCHXbTGRvUDf6QHYXyoiCWMmMDs049CGlXG6JwSIv6GaCKxmUyNOQ7jtsO6PlsF9PmSc7V8YNKZHIeSzMaYo8mWmbEkQky7eJkcAx1OfUAniX7ImtIjnOEAWzZEImCOqyCrC4TuHat5Q2R2Wr8JBRrjZj4zZ0FvETgVu16tAsChqvrWXKnw6j2e6tGD2tHf9URiKzPbhb70oFTLMI4MwWO7QRyjxqSGmlKK5EuBwybQA5FB71HeDbcmtpavb6Ujw"
                alt="مكتبة سعود الشافعي"
                width={80}
                height={80}
                className="w-full h-full object-contain"
                unoptimized
              />
            </div>


            <h1 className="text-3xl md:text-2xl font-bold text-[#e5e2e1] text-center mb-2">
              تسجيل الدخول للنظام
            </h1>
            <p className="text-base text-[#e2bfb0] text-center opacity-80">
              نظام إدارة الموارد - الإصدار ٢٠٢٦
            </p>
          </header>

          {/* Form */}
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm text-center mb-4">
                {error}
              </div>
            )}
            {/* Email Field */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="text-[13px] font-semibold text-[#e2bfb0] block mr-1"
              >
                البريد الإلكتروني المهني
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 pr-5 flex items-center pointer-events-none text-[#e2bfb0]/60 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">account_circle</span>
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  placeholder="name@saudalshafie.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pr-14 pl-5 py-4 bg-[#1c1b1b] border border-white/5 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-[16px] text-[#e5e2e1] placeholder:text-[#e2bfb0]/30"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex justify-between items-center mr-1">
                <label
                  htmlFor="password"
                  className="text-[13px] font-semibold text-[#e2bfb0] block"
                >
                  كلمة المرور المشفرة
                </label>
                <a
                  href="#"
                  className="text-[13px] text-primary hover:text-orange-300 transition-all underline decoration-primary/20 underline-offset-4"
                >
                  نسيت كلمة المرور؟
                </a>
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 pr-5 flex items-center pointer-events-none text-[#e2bfb0]/60 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">key</span>
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pr-14 pl-14 py-4 bg-[#1c1b1b] border border-white/5 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-[16px] text-[#e5e2e1] placeholder:text-[#e2bfb0]/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 left-0 pl-5 flex items-center text-[#e2bfb0]/60 hover:text-primary transition-colors"
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
              className="w-full bg-primary text-white font-bold text-[18px] py-5 rounded-xl hover:brightness-110 active:scale-[0.97] transition-all flex items-center justify-center gap-3 mt-8 disabled:opacity-70 disabled:cursor-not-allowed relative overflow-hidden"
              style={{
                boxShadow: "0 10px 30px -10px rgba(255, 107, 0, 0.5)",
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <>
                  <span>تأكيد الهوية والدخول</span>
                  <span className="material-symbols-outlined">fingerprint</span>
                </>
              )}
            </button>
          </form>

          {/* Rights & Version */}
        </div>
        <div className="text-center mt-10 space-y-2 opacity-40">
          <p className="text-[13px]">جميع الحقوق محفوظة © ٢٠٢٦ مكتبة سعود الشافعي</p>
        </div>
      </main>

      <style jsx global>{`
        @keyframes pulse-glow {
          0% { box-shadow: 0 0 5px rgba(255, 107, 0, 0.2); border-color: rgba(255, 107, 0, 0.3); }
          100% { box-shadow: 0 0 15px rgba(255, 107, 0, 0.5); border-color: rgba(255, 107, 0, 0.6); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
