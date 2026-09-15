import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://aquaspin-laundry-station.vercel.app",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://aquaspin-laundry-station.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization." }, 401, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const n8nWebhookUrl = Deno.env.get("N8N_EXPORT_WEBHOOK_URL");
    const n8nExportToken = Deno.env.get("N8N_EXPORT_TOKEN");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase server configuration is incomplete." }, 500, corsHeaders);
    }

    if (!n8nWebhookUrl || !n8nExportToken) {
      return json({ error: "n8n export automation is not configured yet." }, 503, corsHeaders);
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
      return json({ error: "Invalid session." }, 401, corsHeaders);
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
      return json({ error: "Only an owner can export transactions." }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = String(body.date_from ?? "").trim();
    const dateTo = String(body.date_to ?? "").trim();
    const paymentMethod = String(body.payment_method ?? "all").trim();
    const search = String(body.search ?? "").trim().toLowerCase();
    const outputFormat = body.output_format === "google_sheets" ? "google_sheets" : "csv";

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
      return json({ error: error.message }, 500, corsHeaders);
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
        output_format: outputFormat,
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
        corsHeaders,
      );
    }

    let n8nData: Record<string, unknown> = {};
    try {
      n8nData = JSON.parse(responseText);
    } catch {
      return json({ error: "n8n returned an invalid export response." }, 502, corsHeaders);
    }

    if (outputFormat === "google_sheets") {
      if (typeof n8nData.sheet_url !== "string") {
        return json({ error: "n8n response did not include a Google Sheet link." }, 502, corsHeaders);
      }
      return json({
        filename: typeof n8nData.filename === "string" ? n8nData.filename : `${exportName}-sheet`,
        sheet_url: n8nData.sheet_url,
        spreadsheet_id: n8nData.spreadsheet_id,
        row_count: filtered.length,
      }, 200, corsHeaders);
    }

    if (typeof n8nData.csv !== "string") {
      return json({ error: "n8n response did not include CSV content." }, 502, corsHeaders);
    }

    return json({
      filename: typeof n8nData.filename === "string" ? n8nData.filename : `${exportName}.csv`,
      csv: n8nData.csv,
      row_count: filtered.length,
    }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return json({ error: message }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
