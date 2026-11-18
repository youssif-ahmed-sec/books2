"""Arabic desktop interface for the separately packaged updater."""
import json
from pathlib import Path
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from core import AGENT_NAME, UpdateError, update


def main():
    root = tk.Tk()
    root.title("تحديث برنامج الطباعة")
    root.geometry("610x260")
    root.resizable(False, False)
    root.configure(padx=22, pady=20)
    selected = tk.StringVar()
    ttk.Label(root, text="اختر ملف برنامج الطباعة القديم على جهازك", font=("Segoe UI", 12, "bold"), anchor="e").pack(fill="x")
    ttk.Label(root, text="قبل التحديث، انتظر انتهاء كل طلبات الطباعة المرسلة.", anchor="e").pack(fill="x", pady=(8, 12))
    row = ttk.Frame(root)
    row.pack(fill="x")
    ttk.Entry(row, textvariable=selected, justify="left").pack(side="left", fill="x", expand=True)
    ttk.Button(row, text="اختيار الملف", command=lambda: selected.set(filedialog.askopenfilename(
        parent=root, title="اختر برنامج الطباعة القديم", filetypes=[("برنامج الطباعة", "*.exe")]) or selected.get())).pack(side="left", padx=(8, 0))
    status = ttk.Label(root, text="", anchor="e")
    status.pack(fill="x", pady=12)
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))

    def run():
        if not selected.get().strip():
            messagebox.showerror("تحديث برنامج الطباعة", "اختر ملف البرنامج القديم أولًا.", parent=root)
            return
        if not messagebox.askokcancel("تأكيد التحديث", "سيتم إغلاق برنامج الطباعة مؤقتًا واستبدال الملف المختار. تأكد من انتهاء الطباعة أولًا.", parent=root):
            return
        button.configure(state="disabled")
        status.configure(text="جاري التحديث والتحقق، يرجى الانتظار...")
        root.update_idletasks()
        try:
            payload = bundle / "payload" / AGENT_NAME
            expected = (bundle / "payload" / "sha256.txt").read_text(encoding="ascii").strip()
            backup = update(Path(selected.get().strip().strip('"')), payload, expected)
        except (OSError, UpdateError) as exc:
            messagebox.showerror("تعذر التحديث", str(exc), parent=root)
            status.configure(text="لم يكتمل التحديث.")
        except Exception:
            messagebox.showerror("تعذر التحديث", "حدث خطأ غير متوقع. تحقق من ملف البرنامج وحاول مرة أخرى.", parent=root)
            status.configure(text="لم يكتمل التحديث.")
        else:
            status.configure(text="تم التحديث وتشغيل برنامج الطباعة بنجاح.")
            messagebox.showinfo("تم التحديث", f"تم تحديث برنامج الطباعة وتشغيله.\n\nالنسخة الاحتياطية:\n{backup}", parent=root)
        finally:
            button.configure(state="normal")

    button = ttk.Button(root, text="تحديث البرنامج", command=run)
    button.pack(pady=4)
    root.mainloop()


if __name__ == "__main__":
    main()
