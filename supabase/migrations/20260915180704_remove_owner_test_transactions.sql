-- Owner-confirmed cleanup of two test/demo transactions created during QA
-- (not real customer records). Deleted by exact ID only, per the same
-- discipline used for the earlier Andy QA row.
delete from public.transactions
where id = '90f4659e-18fd-43b9-a4f9-9072663dc26a'::uuid
  and lower(customer_name) = 'earl'
  and transaction_date = date '2026-09-16'
  and total_amount = 440.00
  and payment_method = 'pay_later';

delete from public.transactions
where id = '7b354b9c-a83a-4090-bf75-fb8f6c0b8867'::uuid
  and lower(customer_name) = 'eddyy'
  and transaction_date = date '2026-09-16'
  and total_amount = 195.00
  and payment_method = 'paid';
