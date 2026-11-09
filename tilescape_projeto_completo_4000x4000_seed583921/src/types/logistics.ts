import { PRODUCTS } from './product.js';
import {
  canStoreProduct,
  getResidenceDefinition,
  RESIDENCES,
  type ResidenceType,
} from './residence.js';
import { getStockCapacity, type StockLevels } from './stockCapacity.js';
import { GAME_RULES } from '../generated/gameConfig.js';

export const TRANSPORT_WORK_POINTS_PER_M3 = GAME_RULES.transport.workPointsPerCubicMeter;
export const TRANSPORT_WORK_POINTS_PER_KG = GAME_RULES.transport.workPointsPerKilogram;
export const LINK_RADIUS = GAME_RULES.transport.linkRadiusTiles;

export type TransferDirection = 'in' | 'out';

export interface Transfer {
  buildingId: string;
  productId: string;
  quantity: number;
  // 'out': construção → armazém; 'in': armazém → construção.
  direction: TransferDirection;
}

export interface LogisticsLink {
  buildingId: string;
  type: ResidenceType;
  stock: number;
  toolStock?: number;
  woodStock?: number;
  ironStock?: number;
  charcoalStock?: number;
  sugarcaneStock?: number;
  inputStocks?: Readonly<Record<string, number>>;
  stockLevels?: StockLevels;
  selectedInputProductId?: string | null;
}

export function applyTransferToLinkedBuilding(
  building: LogisticsLink,
  transfer: Transfer,
): void {
  const definition = getResidenceDefinition(building.type);
  const delta = transfer.direction === 'out' ? -transfer.quantity : transfer.quantity;
  if (transfer.direction === 'out') {
    building.stock += delta;
  } else if (definition?.kind === 'shop') {
    building.stock += delta;
  } else if (
    definition?.inputCapacities?.[transfer.productId] !== undefined &&
    (!definition.selectableInputProductIds ||
      building.selectedInputProductId === transfer.productId)
  ) {
    building.inputStocks = {
      ...building.inputStocks,
      [transfer.productId]:
        (building.inputStocks?.[transfer.productId] ?? 0) + delta,
    };
  } else if (transfer.productId === 'tools') {
    building.toolStock = (building.toolStock ?? 0) + delta;
  } else if (transfer.productId === 'wood') {
    building.woodStock = (building.woodStock ?? 0) + delta;
  } else if (transfer.productId === 'iron') {
    building.ironStock = (building.ironStock ?? 0) + delta;
  } else if (transfer.productId === 'charcoal') {
    building.charcoalStock = (building.charcoalStock ?? 0) + delta;
  } else if (transfer.productId === 'sugarcane') {
    building.sugarcaneStock = (building.sugarcaneStock ?? 0) + delta;
  }
}

export type InputProduct = 'tools' | 'wood' | 'iron' | 'charcoal' | 'sugarcane';

export interface WarehouseLogistics {
  stock: Map<string, number>;
  minimumStock: Map<string, number>;
  maximumStock: Map<string, number | null>;
  capacityM3: number;
  workPoints: number;
  allowedProductIds?: readonly string[];
}

export interface WarehouseStockDelta {
  warehouseId: string;
  productId: string;
  quantity: number;
}

export function planWarehouseStockWrites(
  deltas: readonly WarehouseStockDelta[],
  existingProductsByWarehouse: ReadonlyMap<string, ReadonlySet<string>>,
): { updates: WarehouseStockDelta[]; inserts: WarehouseStockDelta[] } {
  const updates: WarehouseStockDelta[] = [];
  const inserts: WarehouseStockDelta[] = [];
  for (const delta of deltas) {
    const existingProducts = existingProductsByWarehouse.get(delta.warehouseId);
    if (!existingProducts) {
      throw new Error(`O armazém ${delta.warehouseId} não foi encontrado no inventário.`);
    }
    if (existingProducts.has(delta.productId)) {
      updates.push(delta);
    } else if (delta.quantity > 0) {
      inserts.push(delta);
    } else {
      throw new Error(
        `Não é possível retirar ${delta.productId} do armazém ${delta.warehouseId} sem uma linha de estoque existente.`,
      );
    }
  }
  return { updates, inserts };
}

export function getTransportDemand(productId: string, quantity: number): number {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (!product) return Infinity;
  return (
    quantity *
    (TRANSPORT_WORK_POINTS_PER_M3 * product.volumeM3 + TRANSPORT_WORK_POINTS_PER_KG * product.weightKg)
  );
}

export function getMaxManualTransferQuantity(input: {
  productId: string;
  sourceStock: number;
  sourceMinimumStock: number;
  destinationFreeCapacity: number;
  availableWorkPoints: number;
}): number {
  const product = PRODUCTS.find((item) => item.id === input.productId);
  if (!product || product.volumeM3 <= 0 || product.weightKg < 0) return 0;
  const unitDemand = getTransportDemand(input.productId, 1);
  return Math.max(
    0,
    Math.floor(
      Math.min(
        input.sourceStock - input.sourceMinimumStock,
        input.destinationFreeCapacity,
        input.availableWorkPoints / unitDemand,
      ) + 1e-9,
    ),
  );
}

export function parseWarehouseLink(
  value: unknown,
): { warehouseId: string | null; linked: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { warehouseId, linked } = value as Record<string, unknown>;
  if (warehouseId === null) {
    return linked === undefined || linked === false ? { warehouseId: null, linked: false } : null;
  }
  if (
    typeof warehouseId !== 'string' ||
    (linked !== undefined && typeof linked !== 'boolean')
  ) {
    return null;
  }
  return { warehouseId, linked: linked !== false };
}

export function canLinkToWarehouse(type: string): boolean {
  const kind = getResidenceDefinition(type)?.kind;
  return (
    kind === 'farm' ||
    kind === 'shop' ||
    kind === 'fishery' ||
    kind === 'resource' ||
    kind === 'workshop' ||
    kind === 'industry'
  );
}

function getActiveInputProductIds(
  definition: NonNullable<ReturnType<typeof getResidenceDefinition>>,
  selectedInputProductId?: string | null,
): string[] {
  const selectable = definition.selectableInputProductIds;
  if (selectable) {
    return selectedInputProductId && selectable.includes(selectedInputProductId)
      ? [selectedInputProductId]
      : [];
  }
  return Object.keys(definition.inputCapacities ?? {});
}

export function isWithinLinkRadius(
  building: { type: ResidenceType; x: number; y: number },
  warehouse: { type: ResidenceType; x: number; y: number },
): boolean {
  const a = RESIDENCES[building.type];
  const b = RESIDENCES[warehouse.type];
  const dx = building.x + a.width / 2 - (warehouse.x + b.width / 2);
  const dy = building.y + a.height / 2 - (warehouse.y + b.height / 2);
  return dx * dx + dy * dy <= LINK_RADIUS * LINK_RADIUS;
}

/**
 * Planeja o transporte diário de um armazém. Produtores abastecem até o estoque
 * máximo configurado e o espaço livre; as construções ligadas recebem apenas o
 * estoque acima do mínimo reservado. Cada carga consome Work Points do armazém.
 */
export type TransferBlockReason =
  | 'desired_reached'
  | 'no_space'
  | 'no_work_points'
  | 'warehouse_empty'
  | 'insufficient_stock';

export interface TransferAttempt {
  buildingId: string;
  productId: string;
  direction: TransferDirection;
  wanted: number;
  moved: number;
  // Preenchido só quando moved < wanted: o limite que impediu o restante.
  reason: TransferBlockReason | null;
}

export function planTransfers(warehouse: WarehouseLogistics, links: LogisticsLink[]): Transfer[] {
  return planTransfersDetailed(warehouse, links).transfers;
}

export function allocateProportionalStock(
  available: number,
  demands: { buildingId: string; quantity: number }[],
): Map<string, number> {
  const totalDemand = demands.reduce((total, item) => total + item.quantity, 0);
  const stockToAllocate = Math.min(Math.max(0, Math.floor(available)), totalDemand);
  if (totalDemand === 0 || stockToAllocate === 0) {
    return new Map(demands.map((item) => [item.buildingId, 0]));
  }

  const allocations = new Map<string, number>();
  const demandByBuilding = new Map(demands.map((item) => [item.buildingId, item.quantity]));
  const remainders = demands.map((item) => {
    const exactShare = (item.quantity * stockToAllocate) / totalDemand;
    const baseShare = Math.min(item.quantity, Math.floor(exactShare));
    allocations.set(item.buildingId, baseShare);
    return { buildingId: item.buildingId, remainder: exactShare - baseShare };
  });

  let remaining = stockToAllocate - [...allocations.values()].reduce((total, amount) => total + amount, 0);
  remainders.sort((a, b) => b.remainder - a.remainder || a.buildingId.localeCompare(b.buildingId));
  for (const item of remainders) {
    if (remaining === 0) break;
    const allocated = allocations.get(item.buildingId) ?? 0;
    const demand = demandByBuilding.get(item.buildingId) ?? 0;
    if (allocated >= demand) continue;
    allocations.set(item.buildingId, allocated + 1);
    remaining -= 1;
  }
  return allocations;
}

export function planTransfersDetailed(
  warehouse: WarehouseLogistics,
  links: LogisticsLink[],
): { transfers: Transfer[]; attempts: TransferAttempt[] } {
  const stock = new Map(warehouse.stock);
  let points = warehouse.workPoints;
  const transfers: Transfer[] = [];
  const attempts: TransferAttempt[] = [];
  const sorted = [...links].sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  const usedM3 = () =>
    PRODUCTS.reduce((sum, product) => sum + (stock.get(product.id) ?? 0) * product.volumeM3, 0);

  const move = (
    link: LogisticsLink,
    direction: TransferDirection,
    input?: string,
    proportionalStockLimit?: number,
  ) => {
    const definition = getResidenceDefinition(link.type);
    const product = PRODUCTS.find((item) => item.id === (input ?? definition?.stockProductId));
    if (
      !definition ||
      !product ||
      (warehouse.allowedProductIds && !warehouse.allowedProductIds.includes(product.id))
    ) return;
    const currentInputStock =
      input === 'tools'
        ? link.toolStock
        : input === 'wood'
          ? link.woodStock
          : input === 'iron'
            ? link.ironStock
            : input === 'charcoal'
              ? link.charcoalStock
              : input === 'sugarcane'
                ? link.sugarcaneStock
                : undefined;
    const current = input ? currentInputStock ?? link.inputStocks?.[input] ?? 0 : link.stock;
    const capacityKey = input === 'tools' ||
      input === 'wood' ||
      input === 'iron' ||
      input === 'charcoal' ||
      input === 'sugarcane'
      ? input
      : input
        ? `input:${input}` as const
        : 'stock';
    const capacity = getStockCapacity(definition, capacityKey, link.stockLevels);
    const inWarehouse = stock.get(product.id) ?? 0;
    const unitDemand = getTransportDemand(product.id, 1);
    const affordable = Math.floor(points / unitDemand + 1e-9);
    const wanted = direction === 'out' ? current : Math.max(0, capacity - current);
    const availableForTransfer = Math.max(
      0,
      inWarehouse - (warehouse.minimumStock.get(product.id) ?? 0),
    );
    const stockBlockReason: TransferBlockReason = inWarehouse > 0 ? 'insufficient_stock' : 'warehouse_empty';
    const limits: [number, TransferBlockReason][] =
      direction === 'out'
        ? [
            [
              Math.max(0, (warehouse.maximumStock.get(product.id) ?? Infinity) - inWarehouse),
              'desired_reached',
            ],
            [Math.max(0, Math.floor((warehouse.capacityM3 - usedM3()) / product.volumeM3 + 1e-9)), 'no_space'],
          ]
        : [[Math.min(availableForTransfer, proportionalStockLimit ?? availableForTransfer), stockBlockReason]];
    limits.push([affordable, 'no_work_points']);
    if (wanted <= 0) return;
    const [limit, limitReason] = limits.reduce((best, item) => (item[0] < best[0] ? item : best));
    const quantity = Math.min(wanted, limit);
    attempts.push({
      buildingId: link.buildingId,
      productId: product.id,
      direction,
      wanted,
      moved: quantity,
      reason: quantity < wanted ? limitReason : null,
    });
    if (quantity <= 0) return;
    points -= quantity * unitDemand;
    stock.set(product.id, inWarehouse + (direction === 'out' ? quantity : -quantity));
    transfers.push({ buildingId: link.buildingId, productId: product.id, quantity, direction });
  };

  // Produtores enviam ao armazém; depois comércios recebem a mercadoria e produtores recebem insumos.
  for (const link of sorted) {
    const kind = getResidenceDefinition(link.type)?.kind;
    if (
      kind === 'farm' ||
      kind === 'fishery' ||
      kind === 'resource' ||
      kind === 'workshop' ||
      kind === 'industry'
    ) {
      move(link, 'out');
    }
  }
  const linkedDemands = new Map<string, { buildingId: string; quantity: number }[]>();
  const addDemand = (link: LogisticsLink, productId: string, quantity: number) => {
    if (quantity <= 0) return;
    const demands = linkedDemands.get(productId) ?? [];
    demands.push({ buildingId: link.buildingId, quantity });
    linkedDemands.set(productId, demands);
  };
  for (const link of sorted) {
    const definition = getResidenceDefinition(link.type);
    if (definition?.kind === 'shop' && definition.stockProductId) {
      addDemand(
        link,
        definition.stockProductId,
        getStockCapacity(definition, 'stock', link.stockLevels) - link.stock,
      );
    }
    if (definition?.toolCapacity) {
      addDemand(link, 'tools', getStockCapacity(definition, 'tools', link.stockLevels) - (link.toolStock ?? 0));
    }
    if (definition?.woodCapacity) {
      addDemand(link, 'wood', getStockCapacity(definition, 'wood', link.stockLevels) - (link.woodStock ?? 0));
    }
    if (definition?.ironCapacity) {
      addDemand(link, 'iron', getStockCapacity(definition, 'iron', link.stockLevels) - (link.ironStock ?? 0));
    }
    if (definition?.charcoalCapacity) {
      addDemand(link, 'charcoal', getStockCapacity(definition, 'charcoal', link.stockLevels) - (link.charcoalStock ?? 0));
    }
    if (definition?.sugarcaneCapacity) {
      addDemand(
        link,
        'sugarcane',
        getStockCapacity(definition, 'sugarcane', link.stockLevels) - (link.sugarcaneStock ?? 0),
      );
    }
    if (definition) {
      for (const productId of getActiveInputProductIds(definition, link.selectedInputProductId)) {
        addDemand(
          link,
          productId,
          getStockCapacity(definition, `input:${productId}`, link.stockLevels) -
            (link.inputStocks?.[productId] ?? 0),
        );
      }
    }
  }
  const linkedAllocations = new Map<string, number>();
  for (const [productId, demands] of linkedDemands) {
    const available = Math.max(
      0,
      (stock.get(productId) ?? 0) - (warehouse.minimumStock.get(productId) ?? 0),
    );
    const keyedDemands = demands.map((item) => ({
      ...item,
      buildingId: `${item.buildingId}:${productId}`,
    }));
    const allocation = allocateProportionalStock(available, keyedDemands);
    for (const [buildingId, quantity] of allocation) linkedAllocations.set(buildingId, quantity);
  }
  for (const link of sorted) {
    const definition = getResidenceDefinition(link.type);
    const allocationFor = (productId: string | undefined) =>
      productId ? linkedAllocations.get(`${link.buildingId}:${productId}`) : undefined;
    if (definition?.kind === 'shop' && definition.stockProductId) {
      move(link, 'in', undefined, allocationFor(definition.stockProductId));
    }
    if (definition?.toolCapacity) move(link, 'in', 'tools', allocationFor('tools'));
    if (definition?.woodCapacity) move(link, 'in', 'wood', allocationFor('wood'));
    if (definition?.ironCapacity) move(link, 'in', 'iron', allocationFor('iron'));
    if (definition?.charcoalCapacity) move(link, 'in', 'charcoal', allocationFor('charcoal'));
    if (definition?.sugarcaneCapacity) {
      move(link, 'in', 'sugarcane', allocationFor('sugarcane'));
    }
    if (definition) {
      for (const productId of getActiveInputProductIds(definition, link.selectedInputProductId)) {
        move(link, 'in', productId, allocationFor(productId));
      }
    }
  }
  return { transfers, attempts };
}

export type WarehouseTradeMode = 'sell' | 'buy';

export interface TradeWarehouse {
  id: string;
  ownerId: string;
  type: ResidenceType;
  x: number;
  y: number;
  capacityM3: number;
  workPoints: number;
  stock: Map<string, number>;
  settings: Map<
    string,
    { minimumStock: number; maximumStock: number | null; price: number; mode: WarehouseTradeMode }
  >;
}

export interface WarehouseTrade {
  buyerId: string;
  sellerId: string;
  productId: string;
  quantity: number;
  // Valor unitário definido pelo vendedor.
  price: number;
}

/**
 * Compras entre armazéns de donos diferentes dentro de LINK_RADIUS. O vendedor oferece o que
 * excede seu estoque mínimo (modo venda) ao preço dele; o comprador (modo compra) quer
 * chegar ao estoque máximo, limitado pela capacidade natural quando usa MAX, e só paga se
 * o preço for menor que o seu limite. As ofertas
 * mais baratas são atendidas primeiro entre todos os fornecedores; o comprador gasta Work
 * Points de transporte e espaço livre em m³.
 */
export function planWarehouseTrades(
  warehouses: TradeWarehouse[],
  onlyBuyerId?: string,
): WarehouseTrade[] {
  const stock = new Map(warehouses.map((item) => [item.id, new Map(item.stock)]));
  const points = new Map(warehouses.map((item) => [item.id, item.workPoints]));
  const offers: { seller: TradeWarehouse; buyer: TradeWarehouse; productId: string; price: number }[] = [];

  for (const seller of warehouses) {
    for (const [productId, offer] of seller.settings) {
      if (offer.mode !== 'sell' || !canStoreProduct(seller.type, productId)) continue;
      for (const buyer of warehouses) {
        if (onlyBuyerId && buyer.id !== onlyBuyerId) continue;
        const want = buyer.settings.get(productId);
        if (
          buyer.ownerId === seller.ownerId ||
          want?.mode !== 'buy' ||
          offer.price > want.price ||
          !canStoreProduct(buyer.type, productId) ||
          !isWithinLinkRadius(buyer, seller)
        ) {
          continue;
        }
        offers.push({ seller, buyer, productId, price: offer.price });
      }
    }
  }
  offers.sort(
    (a, b) =>
      a.price - b.price ||
      a.seller.id.localeCompare(b.seller.id) ||
      a.buyer.id.localeCompare(b.buyer.id) ||
      a.productId.localeCompare(b.productId),
  );

  const trades: WarehouseTrade[] = [];
  for (const { seller, buyer, productId, price } of offers) {
    const product = PRODUCTS.find((item) => item.id === productId);
    if (!product) continue;
    const sellerStock = stock.get(seller.id)!;
    const buyerStock = stock.get(buyer.id)!;
    const surplus =
      (sellerStock.get(productId) ?? 0) - (seller.settings.get(productId)?.minimumStock ?? 0);
    const maximumStock = buyer.settings.get(productId)?.maximumStock ?? Infinity;
    const need = maximumStock - (buyerStock.get(productId) ?? 0);
    const usedM3 = PRODUCTS.reduce((sum, item) => sum + (buyerStock.get(item.id) ?? 0) * item.volumeM3, 0);
    const unitDemand = getTransportDemand(productId, 1);
    const quantity = Math.min(
      surplus,
      need,
      Math.floor((buyer.capacityM3 - usedM3) / product.volumeM3 + 1e-9),
      Math.floor((points.get(buyer.id) ?? 0) / unitDemand + 1e-9),
    );
    if (quantity <= 0) continue;
    sellerStock.set(productId, (sellerStock.get(productId) ?? 0) - quantity);
    buyerStock.set(productId, (buyerStock.get(productId) ?? 0) + quantity);
    points.set(buyer.id, (points.get(buyer.id) ?? 0) - quantity * unitDemand);
    trades.push({ buyerId: buyer.id, sellerId: seller.id, productId, quantity, price });
  }
  return trades;
}
