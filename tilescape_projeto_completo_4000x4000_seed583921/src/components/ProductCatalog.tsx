import { useMemo, useState } from 'react';
import { PRODUCTS, formatShelfLife } from '../types/product';

interface ProductCatalogProps {
  onClose: () => void;
}

const categoryLabels = {
  raw_material: 'Matéria-prima',
  processed: 'Processado',
};

export default function ProductCatalog({ onClose }: ProductCatalogProps) {
  const [search, setSearch] = useState('');
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return query
      ? PRODUCTS.filter((product) => product.name.toLocaleLowerCase('pt-BR').includes(query))
      : PRODUCTS;
  }, [search]);

  return (
    <section className="product-catalog" aria-label="Catálogo de produtos">
      <div className="product-catalog-heading">
        <div>
          <h2>Produtos do reino</h2>
          <p>Unidade, peso, espaço ocupado e validade padrão</p>
        </div>
        <button type="button" aria-label="Fechar catálogo de produtos" onClick={onClose}>
          ×
        </button>
      </div>
      <label className="product-catalog-search">
        <span>Buscar produto</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ex.: trigo, leite, madeira"
        />
      </label>
      <div className="product-catalog-grid">
        {filteredProducts.map((product) => (
          <article className="product-card" key={product.id}>
            <img src={product.icon} alt="" loading="lazy" />
            <div className="product-card-content">
              <div className="product-card-title">
                <h3>{product.name}</h3>
                <span>{categoryLabels[product.category]}</span>
              </div>
              <p>Por {product.unit === 'liter' ? 'litro' : 'unidade'}</p>
              <dl>
                <div><dt>Peso</dt><dd>{product.weightKg} kg</dd></div>
                <div><dt>Volume</dt><dd>{product.volumeM3} m³</dd></div>
                <div><dt>Validade</dt><dd>{formatShelfLife(product.shelfLifeDays)}</dd></div>
              </dl>
            </div>
          </article>
        ))}
        {filteredProducts.length === 0 && (
          <p className="product-catalog-empty">Nenhum produto encontrado.</p>
        )}
      </div>
      <p className="product-catalog-note">
        A validade é o padrão do produto. Estoques e deterioração ainda não estão habilitados.
      </p>
    </section>
  );
}
