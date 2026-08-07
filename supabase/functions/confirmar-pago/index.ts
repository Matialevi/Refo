import { corsHeaders, jsonResponse } from "../_shared/http.ts";

type ConfirmRequest = {
  payment_id?: string | number;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método no permitido." }, 405);
  }

  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!accessToken || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: "Confirmación no configurada." }, 503);
  }

  try {
    const input = await request.json() as ConfirmRequest;
    const paymentId = String(input.payment_id || "").trim();

    if (!/^\d+$/.test(paymentId)) {
      return jsonResponse(request, { error: "Pago inválido." }, 400);
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      return jsonResponse(request, { error: "No pudimos consultar el pago." }, 502);
    }

    if (payment.status !== "approved") {
      return jsonResponse(request, {
        processed: false,
        status: payment.status,
      }, 200);
    }

    const externalReference = String(payment.external_reference || "");
    const kg = Number(payment.metadata?.kg_co2);
    const amount = Number(payment.transaction_amount);
    const expectedAmount = kg * 100;
    const email = String(payment.payer?.email || payment.metadata?.email || "")
      .trim()
      .toLowerCase();
    const nombre = String(
      payment.metadata?.nombre ||
        [payment.payer?.first_name, payment.payer?.last_name]
          .filter(Boolean)
          .join(" "),
    ).trim();

    if (
      !externalReference.startsWith("reforestall:") ||
      !Number.isFinite(kg) || kg <= 0 ||
      !Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.01 ||
      !email
    ) {
      return jsonResponse(request, { error: "Datos del pago inconsistentes." }, 422);
    }

    const rpcResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/procesar_transaccion_confirmada`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_origen: payment.live_mode === true
            ? "mercado_pago"
            : "mercado_pago_prueba",
          p_referencia_externa: String(payment.id),
          p_email: email,
          p_kg_co2: kg,
          p_importe: amount,
          p_nombre: nombre || null,
          p_cliente_id: null,
          p_moneda: payment.currency_id || "ARS",
          p_detalle: {
            es_prueba: payment.live_mode !== true,
            confirmado_por: "retorno_checkout",
            mercado_pago_payment_id: String(payment.id),
            mercado_pago_preference_id: payment.preference_id || null,
            external_reference: externalReference,
            payment_type_id: payment.payment_type_id || null,
            status_detail: payment.status_detail || null,
          },
          p_fecha_transaccion: payment.date_approved || payment.date_created,
        }),
      },
    );
    const result = await rpcResponse.json();

    if (!rpcResponse.ok) {
      console.error("No se pudo generar el token", result);
      return jsonResponse(request, { error: "No se pudo generar el token." }, 500);
    }

    return jsonResponse(request, {
      processed: true,
      token_id: result.token_id,
      duplicate: result.duplicada,
      sandbox: payment.live_mode !== true,
      kg,
      email,
    });
  } catch (error) {
    console.error("confirmar-pago", error);
    return jsonResponse(request, { error: "No se pudo confirmar el pago." }, 500);
  }
});
