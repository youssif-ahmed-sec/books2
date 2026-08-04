import re
import sys

def refactor_file(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Imports
    imports_to_add = """import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
"""
    content = content.replace('import { fetchApi } from "@/lib/api";', 'import { fetchApi } from "@/lib/api";\n' + imports_to_add)

    # 2. Add Zod Schema
    schema = """
const unitSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "اسم الوحدة مطلوب"),
  conversionFactor: z.number().min(1),
  sku: z.string().optional(),
  isDefault: z.boolean(),
  stock: z.number().min(0),
  isBase: z.boolean(),
  retailPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "مطلوب"),
  wholesalePrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "مطلوب"),
  vipPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "مطلوب"),
});

const productSchema = z.object({
  nameAr: z.string().min(1, "اسم المنتج بالعربية مطلوب"),
  nameEn: z.string().min(1, "اسم المنتج بالإنجليزية مطلوب"),
  barcode: z.string().optional(),
  category_id: z.string().min(1, "التصنيف مطلوب"),
  supplier_id: z.string().min(1, "المورد مطلوب"),
  subCategory_id: z.string().min(1, "الفئة الفرعية مطلوبة"),
  brand_id: z.string().min(1, "العلامة التجارية مطلوبة"),
  active: z.boolean(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  costPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "سعر التكلفة مطلوب"),
  vatRate: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الضريبة مطلوبة"),
  minStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأدنى مطلوب"),
  maxStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأقصى مطلوب"),
  units: z.array(unitSchema).min(1, "يجب إضافة وحدة واحدة على الأقل"),
});

type ProductFormValues = z.infer<typeof productSchema>;
"""
    # Find export function AddProductPanel or EditProductPanel
    content = re.sub(r'(export function (Add|Edit)ProductPanel.*?{)', schema + r'\n\1', content)

    # 3. Replace useState for form with useForm
    state_replacement = """  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      nameAr: "", nameEn: "", barcode: "", category_id: "", supplier_id: "",
      subCategory_id: "", brand_id: "", active: true, description: "", imageUrl: "",
      costPrice: "0", vatRate: "0", minStockLevel: "0", maxStockLevel: "0",
      units: [{ id: "1", name: "قطعة", conversionFactor: 1, sku: "", isDefault: true, stock: 0, isBase: true, retailPrice: "0", wholesalePrice: "0", vipPrice: "0" }]
    }
  });

  const { fields: units, append: appendUnit, update: updateUnit, remove: removeUnit } = useFieldArray({
    control,
    name: "units"
  });

  // Derived state for image upload (since RHF doesn't handle drag and drop easily without setValue)
  const imageUrl = watch("imageUrl");
"""
    # Replace the old useState block
    content = re.sub(r'const \[form, setForm\] = useState\(\{.*?\}\);\s*const \[isUploadingImage, setIsUploadingImage\] = useState\(false\);\s*const \[units, setUnits\] = useState<ProductUnit\[\]>\(\[.*?\]\);', state_replacement + "\n  const [isUploadingImage, setIsUploadingImage] = useState(false);", content, flags=re.DOTALL)

    # Save for manual fixes
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)

refactor_file("src/components/AddProductPanel.tsx")
# refactor_file("src/components/EditProductPanel.tsx") # I'll do Add first to test
