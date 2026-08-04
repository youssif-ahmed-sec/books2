import re

filename = "src/components/AddProductPanel.tsx"
with open(filename, 'r', encoding='utf-8') as f:
    content = f.read()

# Restore original imports
content = re.sub(r'import \{ useForm, useFieldArray, Controller \} from "react-hook-form";\nimport \{ zodResolver \} from "@hookform/resolvers/zod";\nimport \{ z \} from "zod";\n', '', content)
content = re.sub(r'const unitSchema = z\.object\(\{.*?\n\nconst productSchema = z\.object\(\{.*?\ntype ProductFormValues = z\.infer<typeof productSchema>;\n', '', content, flags=re.DOTALL)

state_orig = """  const [form, setForm] = useState({
    nameAr: "",
    nameEn: "",
    barcode: "",
    category_id: "",
    supplier_id: "",
    subCategory_id: "",
    brand_id: "",
    active: true,
    description: "",
    imageUrl: "",
    costPrice: "0",
    vatRate: "0",
    minStockLevel: "0",
    maxStockLevel: "0",
  });
  
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [units, setUnits] = useState<ProductUnit[]>([
    { id: "1", name: "قطعة", conversionFactor: 1, sku: "", isDefault: true, stock: 0, isBase: true, retailPrice: "0", wholesalePrice: "0", vipPrice: "0" },
  ]);"""

content = re.sub(r'const \{ register, control.*?const imageUrl = watch\("imageUrl"\);\n  const \[isUploadingImage, setIsUploadingImage\] = useState\(false\);', state_orig, content, flags=re.DOTALL)

with open(filename, 'w', encoding='utf-8') as f:
    f.write(content)
