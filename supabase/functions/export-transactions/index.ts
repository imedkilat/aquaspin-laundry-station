import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const n8nWebhookUrl = Deno.env.get("N8N_EXPORT_WEBHOOK_URL");
    const n8nExportToken = Deno.env.get("N8N_EXPORT_TOKEN");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase server configuration is incomplete." }, 500);
    }

    if (!n8nWebhookUrl || !n8nExportToken) {
      return json({ error: "n8n export automation is not configured yet." }, 503);
    }

    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "owner") {
      return json({ error: "Only an owner can export transactions." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = String(body.date_from ?? "").trim();
    const dateTo = String(body.date_to ?? "").trim();
    const paymentMethod = String(body.payment_method ?? "all").trim();
    const search = String(body.search ?? "").trim().toLowerCase();

    let query = admin
      .from("transactions")
      .select(
        "transaction_no, transaction_code, transaction_date, customer_name, phone_number, kg, no_of_loads, base_amount, add_ons, add_on_items, total_amount, cash_amount, gcash_amount, gcash_reference, payment_method, pickup_date, notes, created_at, services(code,label)",
      )
      .order("created_at", { ascending: true })
      .limit(5000);

    if (dateFrom) query = query.gte("transaction_date", dateFrom);
    if (dateTo) query = query.lte("transaction_date", dateTo);
    if (["paid", "gcash", "pay_later"].includes(paymentMethod)) {
      query = query.eq("payment_method", paymentMethod);
    }

    const { data, error } = await query;
    if (error) {
      return json({ error: error.message }, 500);
    }

    const filtered = (data ?? []).filter((row) =>
      !search || String(row.customer_name ?? "").toLowerCase().includes(search)
    );

    const exportName = `aquaspin-transactions-${dateFrom || "start"}-to-${dateTo || "today"}`;

    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aquaspin-export-token": n8nExportToken,
      },
      body: JSON.stringify({
        export_name: exportName,
        filters: {
          date_from: dateFrom || null,
          date_to: dateTo || null,
          payment_method: paymentMethod,
          customer_search: search || null,
        },
        transactions: filtered,
      }),
    });

    const responseText = await n8nResponse.text();
    if (!n8nResponse.ok) {
      return json(
        { error: `n8n export failed (${n8nResponse.status}): ${responseText.slice(0, 300)}` },
        502,
      );
    }

    let n8nData: Record<string, unknown> = {};
    try {
      n8nData = JSON.parse(responseText);
    } catch {
      return json({ error: "n8n returned an invalid export response." }, 502);
    }

    if (typeof n8nData.csv !== "string") {
      return json({ error: "n8n response did not include CSV content." }, 502);
    }

    return json({
      filename: typeof n8nData.filename === "string" ? n8nData.filename : `${exportName}.csv`,
      csv: n8nData.csv,
      row_count: filtered.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
