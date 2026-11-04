import {
  Factory,
  Hammer,
  House,
  Landmark,
  PackageOpen,
  Trash2,
  Wheat,
} from 'lucide-react';

export type ConstructionCategory =
  | 'artesanais'
  | 'fazendas'
  | 'residencias'
  | 'industrias'
  | 'prefeitura';

interface ConstructionBarProps {
  activeCategory: ConstructionCategory | null;
  demolitionMode: boolean;
  productCatalogOpen: boolean;
  isMaster: boolean;
  onSelect: (category: ConstructionCategory) => void;
  onToggleProductCatalog: () => void;
  onToggleDemolition: () => void;
}

const categories = [
  { id: 'artesanais', label: 'Construções Artesanais', Icon: Hammer },
  { id: 'fazendas', label: 'Fazendas', Icon: Wheat },
  { id: 'residencias', label: 'Residências', Icon: House },
  { id: 'industrias', label: 'Indústrias', Icon: Factory },
  { id: 'prefeitura', label: 'Prefeitura', Icon: Landmark, masterOnly: true },
] as const;

export default function ConstructionBar({
  activeCategory,
  demolitionMode,
  productCatalogOpen,
  isMaster,
  onSelect,
  onToggleProductCatalog,
  onToggleDemolition,
}: ConstructionBarProps) {
  return (
    <nav className="construction-bar" aria-label="Categorias de construções">
      {categories
        .filter((category) => !('masterOnly' in category) || isMaster)
        .map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`construction-tab${activeCategory === id ? ' active' : ''}`}
            type="button"
            aria-label={label}
            aria-pressed={activeCategory === id}
            onClick={() => onSelect(id)}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      <button
        className={`construction-tab${productCatalogOpen ? ' active' : ''}`}
        type="button"
        aria-label="Catálogo de produtos"
        aria-pressed={productCatalogOpen}
        onClick={onToggleProductCatalog}
      >
        <PackageOpen size={20} strokeWidth={1.8} />
        <span>Produtos</span>
      </button>
      <button
        className={`construction-tab demolition-tab${demolitionMode ? ' active' : ''}`}
        type="button"
        aria-label="Demolir construções"
        aria-pressed={demolitionMode}
        onClick={onToggleDemolition}
      >
        <Trash2 size={20} strokeWidth={1.8} />
        <span>Demolir</span>
      </button>
    </nav>
  );
}
