import { PRODUCTS } from './product.js';
import {
  getResidenceDefinition,
  RESIDENCES,
  WORKER_SEARCH_RADIUS,
  type ResidenceType,
} from './residence.js';

// Demanda de Work Points do armazém: 100 por m³ e 0,125 por kg transportados.
export const TRANSPORT_WORK_POINTS_PER_M3 = 100;
export const TRANSPORT_WORK_POINTS_PER_KG = 0.125;
export const LINK_RADIUS = WORKER_SEARCH_RADIUS;

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
}

export interface WarehouseLogistics {
  stock: Map<string, number>;
  desired: Map<string, number>;
  capacityM3: number;
  workPoints: number;
}

export function getTransportDemand(productId: string, quantity: number): number {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (!product) return Infinity;
  return (
    quantity *
    (TRANSPORT_WORK_POINTS_PER_M3 * product.volumeM3 + TRANSPORT_WORK_POINTS_PER_KG * product.weightKg)
  );
}

export function parseWarehouseLink(value: unknown): { warehouseId: string | null } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { warehouseId } = value as Record<string, unknown>;
  if (warehouseId === null) return { warehouseId: null };
  return typeof warehouseId === 'string' ? { warehouseId } : null;
}

export function canLinkToWarehouse(type: string): boolean {
  const kind = getResidenceDefinition(type)?.kind;
  return kind === 'farm' || kind === 'shop' || kind === 'fishery';
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
 * Planeja o transporte diário de um armazém. Fazendas enviam sua produção até o
 * estoque desejável e o espaço livre; comércios recebem até encher o estoque
 * máximo. Cada carga consome Work Points do armazém; o que não couber não é
 * transportado. A produção para o armazém tem prioridade sobre o abastecimento.
 */
export function planTransfers(warehouse: WarehouseLogistics, links: LogisticsLink[]): Transfer[] {
  const stock = new Map(warehouse.stock);
  let points = warehouse.workPoints;
  const transfers: Transfer[] = [];
  const sorted = [...links].sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  const usedM3 = () =>
    PRODUCTS.reduce((sum, product) => sum + (stock.get(product.id) ?? 0) * product.volumeM3, 0);

  const move = (link: LogisticsLink, direction: TransferDirection, productId?: string) => {
    const definition = getResidenceDefinition(link.type);
    const product = PRODUCTS.find((item) => item.id === (productId ?? definition?.stockProductId));
    if (!definition || !product) return;
    const isTool = product.id === 'tools';
    const current = isTool ? (link.toolStock ?? 0) : link.stock;
    const capacity = isTool ? (definition.toolCapacity ?? 0) : (definition.stockCapacity ?? 0);
    const inWarehouse = stock.get(product.id) ?? 0;
    const unitDemand = getTransportDemand(product.id, 1);
    const affordable = Math.floor(points / unitDemand + 1e-9);
    const possible =
      direction === 'out'
        ? Math.min(
            current,
            Math.max(0, (warehouse.desired.get(product.id) ?? 0) - inWarehouse),
            Math.floor((warehouse.capacityM3 - usedM3()) / product.volumeM3 + 1e-9),
          )
        : Math.min(inWarehouse, Math.max(0, capacity - current));
    const quantity = Math.min(possible, affordable);
    if (quantity <= 0) return;
    points -= quantity * unitDemand;
    stock.set(product.id, inWarehouse + (direction === 'out' ? quantity : -quantity));
    transfers.push({ buildingId: link.buildingId, productId: product.id, quantity, direction });
  };

  for (const link of sorted) {
    const kind = getResidenceDefinition(link.type)?.kind;
    if (kind === 'farm' || kind === 'fishery') move(link, 'out');
  }
  for (const link of sorted) {
    const kind = getResidenceDefinition(link.type)?.kind;
    if (kind === 'shop') move(link, 'in');
    if (kind === 'fishery') move(link, 'in', 'tools');
  }
  return transfers;
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
  settings: Map<string, { desired: number; price: number; mode: WarehouseTradeMode }>;
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
 * Compras entre armazéns de donos diferentes em até 60 tiles. O vendedor oferece o que
 * excede seu estoque desejável (modo venda) ao preço dele; o comprador (modo compra) quer
 * chegar ao estoque desejável e só paga se o preço for menor que o seu limite. As ofertas
 * mais baratas são atendidas primeiro entre todos os fornecedores; o comprador gasta Work
 * Points de transporte e espaço livre em m³.
 */
export function planWarehouseTrades(warehouses: TradeWarehouse[]): WarehouseTrade[] {
  const stock = new Map(warehouses.map((item) => [item.id, new Map(item.stock)]));
  const points = new Map(warehouses.map((item) => [item.id, item.workPoints]));
  const offers: { seller: TradeWarehouse; buyer: TradeWarehouse; productId: string; price: number }[] = [];

  for (const seller of warehouses) {
    for (const [productId, offer] of seller.settings) {
      if (offer.mode !== 'sell') continue;
      for (const buyer of warehouses) {
        const want = buyer.settings.get(productId);
        if (
          buyer.ownerId === seller.ownerId ||
          want?.mode !== 'buy' ||
          offer.price >= want.price ||
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
    const surplus = (sellerStock.get(productId) ?? 0) - (seller.settings.get(productId)?.desired ?? 0);
    const need = (buyer.settings.get(productId)?.desired ?? 0) - (buyerStock.get(productId) ?? 0);
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

