import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const addExpenseSchema = z.object({
  sessionId: z.string().min(1),
  category: z.enum(["Petrol", "Food", "Other"]),
  amountPaise: z.number().int().min(1).max(10_000_000),
  description: z.string().max(200).optional(),
});

const deleteExpenseSchema = z.object({
  expenseId: z.string().min(1),
});

const updateExpenseSchema = z.object({
  expenseId: z.string().min(1),
  amountPaise: z.number().int().min(1).max(10_000_000).optional(),
  description: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "delete") {
      const input = deleteExpenseSchema.parse(body);
      await provider.expense.deleteExpense(input.expenseId);
      return Response.json({ success: true });
    }

    if (body.action === "update") {
      const input = updateExpenseSchema.parse(body);
      const result = await provider.expense.updateExpense(input.expenseId, {
        amountPaise: input.amountPaise,
        description: input.description,
      });
      return Response.json(result);
    }

    const input = addExpenseSchema.parse(body);
    const result = await provider.expense.addExpense(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the expense details and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("EXPENSE_OPERATION_FAILED", error);
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
