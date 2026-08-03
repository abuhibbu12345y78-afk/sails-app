import { z } from "zod";
import { provider } from "../../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../../src/infrastructure/errors";
import { DomainError } from "../../../../src/application/errors";

const returnSchema = z.object({
  saleId: z.string().uuid(),
  returnedQuantity: z.number().int().min(1).max(999),
  reason: z.string().trim().min(3).max(300),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = returnSchema.parse(await request.json());
    const result = await provider.sale.returnSale(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the return quantity and reason." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
