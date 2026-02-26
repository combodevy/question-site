import { neon } from "@netlify/neon";

const sql = neon();

async function ensureTables() {
  await sql`
    create table if not exists sync_logs (
      id serial primary key,
      user_id text not null,
      delta jsonb,
      status text not null,
      error text,
      created_at timestamptz default now()
    )
  `;
}

function base64Decode(str) {
  if (!str) return null;
  try {
    if (typeof atob === "function") {
      return atob(str);
    }
  } catch (e) {}
  try {
    return Buffer.from(str, "base64").toString("utf8");
  } catch (e) {
    return null;
  }
}

function decodeJwt(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  try {
    const json = base64Decode(padded);
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export default async (request, context) => {
  let user =
    context.clientContext && context.clientContext.user
      ? context.clientContext.user
      : null;

  if (!user) {
    try {
      const raw =
        context.clientContext &&
        context.clientContext.custom &&
        context.clientContext.custom.netlify;
      if (raw) {
        const decoded = base64Decode(raw);
        if (decoded) {
          const parsed = JSON.parse(decoded);
          user = parsed && parsed.user;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!user) {
    const authHeader =
      request.headers.get("authorization") || request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const decoded = decodeJwt(token);
      if (decoded) {
        user = decoded;
      }
    }
  }

  if (!user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  await ensureTables();

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const userId = user.sub || user.id;

  try {
    const rows = await sql`
      select id, delta, status, error, created_at
      from sync_logs
      where user_id = ${userId}
      order by created_at desc
      limit 50
    `;

    return new Response(
      JSON.stringify({ ok: true, logs: rows }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    console.error(err);
    const detail =
      (err && err.message) ||
      (typeof err === "string" ? err : JSON.stringify(err));
    return new Response(
      JSON.stringify({ error: "数据库错误", detail }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};

export const config = {
  path: "/api/sync-logs"
};

