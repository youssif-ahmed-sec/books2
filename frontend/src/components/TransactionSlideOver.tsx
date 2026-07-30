"use client";

import React, { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useInventoryStore, TransactionType } from '@/store/useInventoryStore';

const transactionTypes: { value: TransactionType; label: string }[] = [
  { value: 'Receiving', label: 'وارد (Receiving)' },
  { value: 'Issuing', label: 'صادر (Issuing)' },
  { value: 'Transfer', label: 'نقل (Transfer)' },
  { value: 'Adjustment', label: 'تسوية (Adjustment)' },
  { value: 'Counting', label: 'جرد (Counting)' }
];

export default function TransactionSlideOver() {
  const { isTransactionModalOpen, closeTransactionModal, submitTransaction, selectedProductId } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const [formData, setFormData] = useState({
    product_id: '',
    warehouse_id: 'Main', // Default to main
    transaction_type: 'Receiving' as TransactionType,
    quantity_changed: 0,
    notes: ''
  });

  useEffect(() => {
    if (selectedProductId) {
      setFormData(prev => ({ ...prev, product_id: selectedProductId }));
    } else {
      setFormData({
        product_id: '',
        warehouse_id: 'Main',
        transaction_type: 'Receiving',
        quantity_changed: 0,
        notes: ''
      });
    }
  }, [selectedProductId, isTransactionModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setToast(null);

    const success = await submitTransaction(formData);
    
    if (success) {
      setToast({ type: 'success', message: 'تم حفظ الحركة بنجاح.' });
      setTimeout(() => {
        setToast(null);
        closeTransactionModal();
      }, 2000);
    } else {
      setToast({ type: 'error', message: 'حدث خطأ أثناء الحفظ. تأكد من صحة البيانات.' });
    }
    
    setLoading(false);
  };

  if (!isTransactionModalOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity" 
        onClick={closeTransactionModal}
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 left-0 max-w-3xl w-full bg-[#131313]/90 backdrop-blur-[50px] shadow-2xl border-r border-white/5 z-50 transform transition-transform flex flex-col h-full" dir="rtl">
        {/* Header */}
        <div className="px-12 py-8 border-b border-white/5 flex items-center justify-between">
          <div className="flex flex-row-reverse items-center gap-6 text-right">
            <div className="text-right">
              <h2 className="text-2xl font-bold text-on-surface">حركة مخزون جديدة</h2>
              <p className="text-on-surface-variant text-sm mt-1">إضافة حركة وارد أو صادر أو تسوية</p>
            </div>
            <div className="w-14 h-14 rounded-full bg-surface-container-highest flex items-center justify-center border border-white/10">
              <span className="material-symbols-outlined text-primary text-2xl">sync_alt</span>
            </div>
          </div>
          <button 
            onClick={closeTransactionModal}
            className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center transition-colors border border-white/5"
          >
            <X className="text-on-surface-variant" size={20} />
          </button>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
          <form id="transaction-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">معرف المنتج</label>
              <input 
                type="text" 
                required
                value={formData.product_id}
                onChange={e => setFormData({...formData, product_id: e.target.value})}
                className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange inner-glow transition-all placeholder:text-on-surface-variant/30"
                placeholder="أدخل UUID للمنتج"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">معرف المستودع</label>
              <input 
                type="text" 
                required
                value={formData.warehouse_id}
                onChange={e => setFormData({...formData, warehouse_id: e.target.value})}
                className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange inner-glow transition-all placeholder:text-on-surface-variant/30"
                placeholder="مثال: Main"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">نوع الحركة</label>
              <select 
                value={formData.transaction_type}
                onChange={e => setFormData({...formData, transaction_type: e.target.value as TransactionType})}
                className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange appearance-none inner-glow transition-all cursor-pointer bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20fill=%22none%22%20viewBox=%220%200%2024%2024%20%22%20stroke=%22%23ff6b00%22><path%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%20stroke-width=%222%22%20d=%22M19%209l-7%207-7-7%22></path></svg>')] bg-[position:left_1.5rem_center] bg-no-repeat bg-[length:1.5em_1.5em]"
              >
                {transactionTypes.map(type => (
                  <option key={type.value} value={type.value} className="bg-[#1e1e1e]">{type.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">الكمية</label>
              <input 
                type="number" 
                required
                value={formData.quantity_changed}
                onChange={e => setFormData({...formData, quantity_changed: parseFloat(e.target.value) || 0})}
                className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange inner-glow transition-all placeholder:text-on-surface-variant/30"
                placeholder="0.0"
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">ملاحظات إضافية</label>
              <textarea 
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                className="w-full bg-surface-container border border-white/5 rounded-xl p-5 text-on-surface focus-orange inner-glow min-h-[120px] transition-all resize-none placeholder:text-on-surface-variant/30"
                placeholder="أدخل ملاحظات حول الحركة..."
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-12 border-t border-white/5 bg-surface-container-lowest/80 backdrop-blur-xl flex flex-row gap-4">
          <button 
            type="submit"
            form="transaction-form"
            disabled={loading}
            className="flex-[2] bg-primary-container text-on-primary-container font-display-lg text-lg py-5 rounded-full shadow-[0_12px_24px_rgba(255,107,0,0.2)] hover:shadow-[0_12px_32px_rgba(255,107,0,0.3)] hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                <span className="material-symbols-outlined font-bold">check_circle</span>
                <span>حفظ الحركة</span>
              </>
            )}
          </button>
          <button 
            type="button"
            onClick={closeTransactionModal}
            className="flex-1 py-5 rounded-full border border-white/10 font-bold text-on-surface-variant hover:bg-white/5 active:scale-[0.98] transition-all"
          >
            إلغاء الأمر
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-xl shadow-xl border animate-in slide-in-from-bottom-5 ${
          toast.type === 'success' ? 'bg-[#121212] border-green-500/30 text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'bg-[#121212] border-red-500/30 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <p className="text-sm font-bold">{toast.message}</p>
        </div>
      )}
    </>
  );
}
