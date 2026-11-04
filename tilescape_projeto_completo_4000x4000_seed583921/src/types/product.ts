export type ProductUnit = 'unit' | 'liter';
export type ProductCategory = 'raw_material' | 'processed';

export interface ProductDefinition {
  id: string;
  name: string;
  icon: string;
  category: ProductCategory;
  unit: ProductUnit;
  weightKg: number;
  volumeM3: number;
  shelfLifeDays: number | null;
}

const product = (
  id: string,
  name: string,
  icon: string,
  category: ProductCategory,
  unit: ProductUnit,
  weightKg: number,
  volumeM3: number,
  shelfLifeDays: number | null,
): ProductDefinition => ({
  id,
  name,
  icon: `/products/${icon}.png`,
  category,
  unit,
  weightKg,
  volumeM3,
  shelfLifeDays,
});

export const PRODUCTS: ProductDefinition[] = [
  product('rice', 'Arroz', 'arroz', 'raw_material', 'unit', 8, 0.01, 730),
  product('wheat', 'Trigo', 'trigo', 'raw_material', 'unit', 8, 0.01, 730),
  product('barley', 'Cevada', 'cevada', 'raw_material', 'unit', 6, 0.01, 730),
  product('corn', 'Milho', 'milho', 'raw_material', 'unit', 7, 0.01, 365),
  product('potato', 'Batata', 'batata', 'raw_material', 'unit', 6, 0.01, 90),
  product('olive', 'Azeitona', 'azeitona', 'raw_material', 'unit', 5, 0.01, 30),
  product('grape', 'Uva', 'uva', 'raw_material', 'unit', 6, 0.01, 14),
  product('fruit', 'Fruta', 'frutas', 'raw_material', 'unit', 5, 0.01, 14),
  product('spices', 'Especiarias', 'especiarias', 'raw_material', 'unit', 3, 0.01, 1460),
  product('red_meat', 'Carne vermelha', 'carne_vermelha', 'raw_material', 'unit', 4, 0.01, 5),
  product('milk', 'Leite', 'leite', 'raw_material', 'liter', 1, 0.001, 7),
  product('sugarcane', 'Cana', 'cana', 'raw_material', 'unit', 3, 0.01, 3),
  product('vegetables', 'Vegetais', 'vegetais', 'raw_material', 'unit', 3, 0.01, 10),
  product('tobacco_leaf', 'Fumo', 'fumo', 'raw_material', 'unit', 2, 0.01, 1460),
  product('cocoa', 'Cacau', 'cacau', 'raw_material', 'unit', 6, 0.01, 730),
  product('medicinal_herbs', 'Ervas medicinais', 'ervas_medicinais', 'raw_material', 'unit', 1, 0.01, 730),
  product('cotton', 'Algodão', 'algodao', 'raw_material', 'unit', 18, 0.1, null),
  product('wool', 'Lã', 'la', 'raw_material', 'unit', 25, 0.1, null),
  product('thread', 'Linha', 'linha', 'raw_material', 'unit', 30, 0.1, null),
  product('wood', 'Madeira', 'madeira', 'raw_material', 'unit', 50, 0.1, null),
  product('stone', 'Pedra', 'pedra', 'raw_material', 'unit', 160, 0.1, null),
  product('iron', 'Ferro', 'ferro', 'raw_material', 'unit', 350, 0.1, null),
  product('salt', 'Sal', 'sal', 'raw_material', 'unit', 12, 0.01, null),
  product('fish', 'Peixe', 'peixe', 'raw_material', 'unit', 5, 0.01, 2),
  product('sugar', 'Açúcar', 'acucar', 'processed', 'unit', 9, 0.01, 3650),
  product('bread', 'Pão', 'pao', 'processed', 'unit', 2, 0.01, 3),
  product('cheese', 'Queijo', 'queijo', 'processed', 'unit', 5, 0.01, 90),
  product('chocolate', 'Chocolate', 'chocolate', 'processed', 'unit', 5, 0.01, 180),
  product('olive_oil', 'Azeite', 'azeite', 'processed', 'liter', 9, 0.01, 730),
  product('alcohol', 'Álcool', 'alcool', 'processed', 'liter', 8, 0.01, null),
  product('tobacco', 'Tabaco', 'tabaco', 'processed', 'unit', 2, 0.01, 1825),
  product('wine', 'Vinho', 'vinho', 'processed', 'liter', 10, 0.01, 3650),
];

export function formatShelfLife(days: number | null): string {
  if (days === null) return 'Infinita';
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} ${years === 1 ? 'ano' : 'anos'}`;
  }
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}
