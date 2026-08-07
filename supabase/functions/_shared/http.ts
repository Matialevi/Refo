export const allowedOrigins = new Set([
  "https://matialevi.github.io",
  "https://reforestall.com.ar",
  "https://www.reforestall.com.ar",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = allowedOrigins.has(origin)
    ? origin
    : "https://matialevi.github.io";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}
