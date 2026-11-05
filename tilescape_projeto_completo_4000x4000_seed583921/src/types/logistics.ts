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
  return kind === 'farm' || kind === 'shop';
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

  const move = (link: LogisticsLink, direction: TransferDirection) => {
    const definition = getResidenceDefinition(link.type);
    const product = PRODUCTS.find((item) => item.name === definition?.stockProduct);
    if (!definition || !product) return;
    const inWarehouse = stock.get(product.id) ?? 0;
    const unitDemand = getTransportDemand(product.id, 1);
    const affordable = Math.floor(points / unitDemand + 1e-9);
    const possible =
      direction === 'out'
        ? Math.min(
            link.stock,
            Math.max(0, (warehouse.desired.get(product.id) ?? 0) - inWarehouse),
            Math.floor((warehouse.capacityM3 - usedM3()) / product.volumeM3 + 1e-9),
          )
        : Math.min(inWarehouse, Math.max(0, (definition.stockCapacity ?? 0) - link.stock));
    const quantity = Math.min(possible, affordable);
    if (quantity <= 0) return;
    points -= quantity * unitDemand;
    stock.set(product.id, inWarehouse + (direction === 'out' ? quantity : -quantity));
    transfers.push({ buildingId: link.buildingId, productId: product.id, quantity, direction });
  };

  for (const link of sorted) {
    if (getResidenceDefinition(link.type)?.kind === 'farm') move(link, 'out');
  }
  for (const link of sorted) {
    if (getResidenceDefinition(link.type)?.kind === 'shop') move(link, 'in');
  }
  return transfers;
}
