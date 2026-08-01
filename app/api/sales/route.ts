import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const saleSchema = z.object({
  productId: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(999),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = saleSchema.parse(await request.json());
    const result = await provider.sale.createSale(input);
    if (result.duplicate) {
      return Response.json({ saleId: result.saleId, duplicate: true });
    }
    return Response.json({ saleId: result.saleId, calculation: result.calculation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose a valid product and quantity." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
