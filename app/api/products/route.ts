import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";
import { createProductManagementUseCases } from "../../../src/application/product-management";

const MAX_MONEY_PAISE = 999_999_900;

const productSchema = z.object({
  productId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(80),
  sellingPricePaise: z.number().int().min(1).max(MAX_MONEY_PAISE),
  normalCommissionPaise: z.number().int().min(0).max(MAX_MONEY_PAISE),
  offerEnabled: z.boolean(),
  fullCommissionPaise: z.number().int().min(1).max(MAX_MONEY_PAISE).nullable().optional(),
  rewardThreshold: z.number().int().min(1).max(999).nullable().optional(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  reason: z.string().trim().max(200).nullish(),
}).superRefine((input, ctx) => {
  if (input.offerEnabled && (input.fullCommissionPaise == null || input.rewardThreshold == null)) {
    ctx.addIssue({
      code: "custom",
      path: ["offerEnabled"],
      message: "Offer amount and offer limit are required when the offer is enabled.",
    });
  }
});

const deleteSchema = z.object({
  reason: z.string().trim().max(200).nullish(),
});

const useCases = createProductManagementUseCases(provider.productManagement);

export async function GET() {
  try {
    const items = await useCases.listProducts();
    return Response.json({ products: items });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = productSchema.parse(await request.json());
    const item = await useCases.upsertProduct({
      ...input,
      productId: input.productId ?? null,
      fullCommissionPaise: input.fullCommissionPaise ?? null,
      rewardThreshold: input.rewardThreshold ?? null,
      reason: input.reason ?? undefined,
    });
    return Response.json({ product: item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the product details and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const input = productSchema.parse(await request.json());
    if (!input.productId) {
      return Response.json({ error: "Product id is required to update a product." }, { status: 400 });
    }
    const item = await useCases.upsertProduct({
      ...input,
      productId: input.productId,
      fullCommissionPaise: input.fullCommissionPaise ?? null,
      rewardThreshold: input.rewardThreshold ?? null,
      reason: input.reason ?? undefined,
    });
    return Response.json({ product: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the product details and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("id");
    if (!productId) {
      return Response.json({ error: "Product id is required." }, { status: 400 });
    }
    const parsed = deleteSchema.parse(await request.json().catch(() => ({})));
    const result = await useCases.deleteProduct(productId, parsed.reason ?? undefined);
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the delete request and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
