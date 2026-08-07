import { corsHeaders, jsonResponse } from "../_shared/http.ts";

const PRICE_PER_KG = 100;
const MAX_KG_PER_PAYMENT = 100_000;

type PaymentRequest = {
  email?: string;
  nombre?: string;
  kg?: number;
};

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método no permitido." }, 405);
  }

  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const siteUrl = Deno.env.get("REFORESTALL_SITE_URL") ||
    "https://matialevi.github.io/Refo";

  if (!accessToken) {
    return jsonResponse(
      request,
      { error: "Mercado Pago todavía no está configurado." },
      503,
    );
  }

  try {
    const input = await request.json() as PaymentRequest;
    const email = String(input.email || "").trim().toLowerCase();
    const nombre = String(input.nombre || "").trim();
    const kg = Math.round(Number(input.kg));

    if (!validEmail(email)) {
      return jsonResponse(request, { error: "Ingresá un correo válido." }, 400);
    }

    if (!Number.isFinite(kg) || kg < 1 || kg > MAX_KG_PER_PAYMENT) {
      return jsonResponse(
        request,
        { error: "La cantidad de kg no es válida." },
        400,
      );
    }

    const amount = kg * PRICE_PER_KG;
    const externalReference = `reforestall:${crypto.randomUUID()}`;
    const notificationUrl =
      `${supabaseUrl}/functions/v1/mercadopago-webhook`;
    const returnBase = `${siteUrl.replace(/\/$/, "")}/compensar.html`;

    const preferenceResponse = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          items: [
            {
              id: `reforestall-${kg}-kg`,
              title: `Compensación Reforestall — ${kg} kg de CO₂`,
              description: "Participación ambiental trazable en Reforestall",
              quantity: 1,
              currency_id: "ARS",
              unit_price: amount,
            },
          ],
          payer: {
            email,
            ...(nombre ? { name: nombre } : {}),
          },
          metadata: {
            kg_co2: kg,
            email,
            nombre,
          },
          external_reference: externalReference,
          notification_url: notificationUrl,
          back_urls: {
            success: `${returnBase}?pago=aprobado`,
            pending: `${returnBase}?pago=pendiente`,
            failure: `${returnBase}?pago=fallido`,
          },
          auto_return: "approved",
        }),
      },
    );

    const preference = await preferenceResponse.json();

    if (!preferenceResponse.ok) {
      console.error("Mercado Pago preference error", preference);
      return jsonResponse(
        request,
        { error: "No pudimos iniciar el pago. Intentá nuevamente." },
        502,
      );
    }

    const checkoutUrl = preference.init_point;

    if (!checkoutUrl) {
      return jsonResponse(
        request,
        { error: "Mercado Pago no devolvió el enlace de pago." },
        502,
      );
    }

    return jsonResponse(request, {
      checkout_url: checkoutUrl,
      preference_id: preference.id,
      external_reference: externalReference,
      kg,
      importe: amount,
      moneda: "ARS",
    });
  } catch (error) {
    console.error("crear-pago", error);
    return jsonResponse(
      request,
      { error: "No pudimos preparar el pago." },
      500,
    );
  }
});
