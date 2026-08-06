import { DomainError } from "./errors.ts";
import type {
  DeleteProductResult,
  ProductManagementItem,
  ProductManagementRepository,
  UpsertProductInput,
} from "./repositories.ts";

const MAX_MONEY_PAISE = 999_999_900;

export function validateProductInput(input: UpsertProductInput): void {
  const name = input.name.trim();
  if (!name || name.length > 80) {
    throw new DomainError("Product name is required and must be at most 80 characters.", 400);
  }
  if (!Number.isInteger(input.sellingPricePaise) || input.sellingPricePaise < 1 || input.sellingPricePaise > MAX_MONEY_PAISE) {
    throw new DomainError("Selling price must be a whole amount in paise greater than zero, up to 99,99,999.", 400);
  }
  if (!Number.isInteger(input.normalCommissionPaise) || input.normalCommissionPaise < 0 || input.normalCommissionPaise > input.sellingPricePaise) {
    throw new DomainError("Normal commission must be a whole amount in paise not exceeding the selling price.", 400);
  }
  if (input.offerEnabled) {
    if (!Number.isInteger(input.fullCommissionPaise) || input.fullCommissionPaise === null || input.fullCommissionPaise < 1 || input.fullCommissionPaise > MAX_MONEY_PAISE) {
      throw new DomainError("Offer amount must be a whole amount in paise greater than zero when the offer is enabled.", 400);
    }
    if (!Number.isInteger(input.rewardThreshold) || input.rewardThreshold === null || input.rewardThreshold < 1 || input.rewardThreshold > 999) {
      throw new DomainError("Offer limit must be a whole number between 1 and 999 when the offer is enabled.", 400);
    }
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) {
    throw new DomainError("Display order must be a whole number between 0 and 9999.", 400);
  }
}

export interface ProductManagementUseCases {
  listProducts(): Promise<ProductManagementItem[]>;
  upsertProduct(input: UpsertProductInput): Promise<ProductManagementItem>;
  deleteProduct(productId: string, reason?: string): Promise<DeleteProductResult>;
}

export function createProductManagementUseCases(
  repository: ProductManagementRepository
): ProductManagementUseCases {
  return {
    async listProducts() {
      return repository.listProducts();
    },
    async upsertProduct(input) {
      validateProductInput(input);
      return repository.upsertProduct({
        ...input,
        name: input.name.trim(),
        fullCommissionPaise: input.offerEnabled ? input.fullCommissionPaise : null,
        rewardThreshold: input.offerEnabled ? input.rewardThreshold : null,
      });
    },
    async deleteProduct(productId, reason) {
      const result = await repository.deleteProduct(productId, reason);
      if (!result.deleted && result.blocked) {
        const u = result.usage;
        const parts: string[] = [];
        if (u.sales > 0) parts.push(`${u.sales} sale record(s)`);
        if (u.stockItems > 0) parts.push(`${u.stockItems} stock record(s)`);
        if (u.progress > 0) parts.push(`${u.progress} commission progress record(s)`);
        if (u.rewards > 0) parts.push(`${u.rewards} offer record(s)`);
        if (u.closures > 0) parts.push(`${u.closures} day closure(s)`);
        if (u.auditLogs > 0) parts.push(`${u.auditLogs} audit record(s)`);
        const detail = parts.length > 0 ? parts.join(", ") : "unknown dependencies";
        throw new DomainError(`Product is in use and cannot be deleted (${detail}).`, 409);
      }
      return result;
    },
  };
}
