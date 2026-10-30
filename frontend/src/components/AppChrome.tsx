"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { cachedCurrentUser, getCurrentUser } from "@/lib/currentUser";
import { adminRoles, inventoryRoles, salesRoles } from "@/lib/routeRoles";
import { warehouseOnlyMode } from "@/lib/warehouseMode";
import type { UserRole } from "@/utils/auth";

const pages: Record<string, { title: string; roles: readonly UserRole[] }> = {
  "/audit": { title: "سجل التدقيق", roles: adminRoles },
  "/cash-register": { title: "الصندوق النقدي", roles: salesRoles },
  "/categories": { title: "التصنيفات والعلامات التجارية", roles: inventoryRoles },
  "/count-approvals": { title: "موافقات الجرد", roles: adminRoles },
  "/customers": { title: "العملاء", roles: salesRoles },
  "/dashboard": { title: "لوحة الإدارة", roles: adminRoles },
  "/financials": { title: "المالية", roles: adminRoles },
  "/inventory": { title: "إدارة المخزون", roles: inventoryRoles },
  "/inventory/product": { title: "تفاصيل المنتج", roles: inventoryRoles },
  "/offers": { title: "العروض", roles: inventoryRoles },
  "/orders": { title: "الفواتير", roles: salesRoles },
  "/pos": { title: "نقطة البيع", roles: salesRoles },
  "/product-approvals": { title: "طلبات المنتجات", roles: inventoryRoles },
  "/purchases": { title: "المشتريات", roles: inventoryRoles },
  "/purchases/legacy": { title: "أوامر الشراء القديمة", roles: inventoryRoles },
  "/reports": { title: "التقارير", roles: adminRoles },
  "/reports/product-activity": { title: "حركة الأصناف", roles: adminRoles },
  "/returns": { title: "الاسترجاع والاستبدال", roles: salesRoles },
  "/settings": { title: "الإعدادات", roles: adminRoles },
  "/stock-operations": { title: warehouseOnlyMode ? "الجرد" : "النقل والجرد", roles: inventoryRoles },
  "/suppliers": { title: "إدارة الموردين", roles: adminRoles },
};

export default function AppChrome() {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<UserRole | null>(() => cachedCurrentUser()?.role || null);
  const page = pages[pathname];

  useEffect(() => {
    if (!page) return;
    let active = true;
    getCurrentUser().then(user => {
      if (active) setUserRole(user.role);
    }).catch(() => {
      if (active) setUserRole(null);
    });
    return () => { active = false; };
  }, [page]);

  if (!page || !userRole || !page.roles.includes(userRole)) return null;
  return <><SideNav /><TopNav title={page.title} /></>;
}
