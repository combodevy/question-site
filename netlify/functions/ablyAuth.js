import Ably from "ably";

const apiKey = process.env.ABLY_API_KEY || "";

export default async (request, context) => {
  let user =
    context.clientContext && context.clientContext.user
      ? context.clientContext.user
      : null;

  if (!user) {
    const authHeader =
      request.headers.get("authorization") || request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        try {
          user = JSON.parse(
            Buffer.from(token.split(".")[1], "base64").toString("utf8")
          );
        } catch (e) {}
      }
    }
  }

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing ABLY_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const clientId = user.sub || user.id || "anonymous";

  const rest = new Ably.Rest(apiKey);

  let tokenRequest;
  try {
    tokenRequest = await rest.auth.createTokenRequest({ clientId });
  } catch (e) {
    console.error("Ably tokenRequest failed", e);
    return new Response(JSON.stringify({ error: "Ably token error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify(tokenRequest), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/ably-auth"
};

