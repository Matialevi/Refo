import { jsonResponse } from "../_shared/http.ts";

type MercadoPagoNotification = {
  type?: string;
  action?: string;
  data?: { id?: string | number };
};

function parseSignature(value: string): Record<string, string> {
  return Object.fromEntries(
    value.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function validWebhookSignature(
  request: Request,
  dataId: string,
  secret: string,
): Promise<boolean> {
  const signature = parseSignature(request.headers.get("x-signature") || "");
  const requestId = request.headers.get("x-request-id") || "";
  const timestamp = signature.ts || "";
  const receivedHash = signature.v1 || "";

  if (!requestId || !timestamp || !receivedHash) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calculated = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)),
  );

  return timingSafeEqual(calculated, receivedHash.toLowerCase());
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, { received: true }, 200);
  }

  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
  const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!accessToken || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Faltan secretos para procesar el webhook");
    return jsonResponse(request, { error: "Webhook no configurado." }, 503);
  }

  try {
    const notification = await request.json() as MercadoPagoNotification;
    const url = new URL(request.url);
    const dataId = String(
      url.searchParams.get("data.id") || notification.data?.id || "",
    ).trim();

    if (!dataId) {
      return jsonResponse(request, { received: true }, 200);
    }

    const signatureIsValid = await validWebhookSignature(
      request,
      dataId,
      webhookSecret,
    );

    if (!signatureIsValid) {
      console.warn("Firma de Mercado Pago inválida", { dataId });
      return jsonResponse(request, { error: "Firma inválida." }, 401);
    }

    if (notification.type !== "payment") {
      return jsonResponse(request, { received: true, ignored: true }, 200);
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error("No se pudo consultar el pago", payment);
      return jsonResponse(request, { error: "No se pudo validar el pago." }, 502);
    }

    if (payment.status !== "approved") {
      return jsonResponse(request, {
        received: true,
        processed: false,
        status: payment.status,
      }, 200);
    }

    if (payment.live_mode !== true) {
      return jsonResponse(request, {
        received: true,
        processed: false,
        sandbox: true,
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

    if (!externalReference.startsWith("reforestall:")) {
      return jsonResponse(request, { received: true, ignored: true }, 200);
    }

    if (
      !Number.isFinite(kg) || kg <= 0 || !Number.isFinite(amount) ||
      Math.abs(amount - expectedAmount) > 0.01 || !email
    ) {
      console.error("Pago aprobado con datos inconsistentes", {
        paymentId: payment.id,
        kg,
        amount,
        expectedAmount,
        emailPresent: Boolean(email),
      });
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
          p_origen: "mercado_pago",
          p_referencia_externa: String(payment.id),
          p_email: email,
          p_kg_co2: kg,
          p_importe: amount,
          p_nombre: nombre || null,
          p_cliente_id: null,
          p_moneda: payment.currency_id || "ARS",
          p_detalle: {
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
      received: true,
      processed: true,
      token_id: result.token_id,
      duplicate: result.duplicada,
    }, 200);
  } catch (error) {
    console.error("mercadopago-webhook", error);
    return jsonResponse(request, { error: "No se pudo procesar el aviso." }, 500);
  }
});
