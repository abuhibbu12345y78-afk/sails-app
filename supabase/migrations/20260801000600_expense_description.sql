-- Add description column for Other Expense labels
ALTER TABLE public.day_expenses ADD COLUMN description text;

-- Add RLS UPDATE policy (missing - needed for editing expenses)
CREATE POLICY "Users can update their company's day expenses" ON public.day_expenses
  FOR UPDATE TO authenticated USING (company_id IN (
    SELECT company_id FROM public.salesmen WHERE user_id = auth.uid() AND active = true
  ));
