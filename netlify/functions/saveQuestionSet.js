import { neon } from "@netlify/neon";
import Ably from "ably";

const sql = neon();

const ablyApiKey = process.env.ABLY_API_KEY || "";
const ablyClient = ablyApiKey ? new Ably.Rest(ablyApiKey) : null;

async function ensureTables() {
  await sql`
    create table if not exists question_sets (
      id serial primary key,
      user_id text not null,
      name text not null,
      created_at timestamptz default now(),
      version integer not null default 0
    )
  `;
  await sql`
    create table if not exists questions (
      id serial primary key,
      question_set_id integer not null references question_sets(id) on delete cascade,
      content jsonb not null
    )
  `;
  await sql`
    alter table question_sets
    add column if not exists state jsonb
  `;
  await sql`
    alter table question_sets
    add column if not exists version integer not null default 0
  `;
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
  const debug = [];

  let user =
    context.clientContext && context.clientContext.user
      ? context.clientContext.user
      : null;
  if (user) {
    debug.push("from_clientContext_user");
  }

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
          if (user) {
            debug.push("from_custom_netlify");
          } else {
            debug.push("custom_netlify_no_user");
          }
        } else {
          debug.push("custom_netlify_decode_failed");
        }
      } else {
        debug.push("no_custom_netlify");
      }
    } catch (e) {
      console.error(e);
      debug.push("custom_netlify_exception");
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
        debug.push("from_jwt_header");
      } else {
        debug.push("jwt_decode_failed");
      }
    } else {
      debug.push("no_authorization_header");
    }
  }

  if (!user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", debug }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  await ensureTables();

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const userId = user.sub || user.id;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const name = body.name;
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const state =
    body.state && typeof body.state === "object" ? body.state : null;
  const delta =
    body.delta && typeof body.delta === "object" ? body.delta : null;
  const clientVersion =
    typeof body.version === "number" && Number.isFinite(body.version)
      ? body.version
      : 0;

  if (!name || questions.length === 0) {
    return new Response(
      JSON.stringify({ error: "name 或 questions 不能为空" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  try {
    const existing = await sql`
      select id, version from question_sets
      where user_id = ${userId}
      limit 1
    `;

    let setId;
    let currentVersion = 0;
    let nextVersion = 1;

    if (existing.length > 0) {
      setId = existing[0].id;
      currentVersion =
        typeof existing[0].version === "number" ? existing[0].version : 0;
      if (clientVersion !== currentVersion) {
        try {
          await sql`
            insert into sync_logs (user_id, delta, status, error)
            values (${userId}, ${delta}, ${"error"}, ${"version_conflict"})
          `;
        } catch (e) {
          console.error(e);
        }
        return new Response(
          JSON.stringify({
            error: "Version conflict",
            currentVersion
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      nextVersion = currentVersion + 1;
      await sql`
        update question_sets
        set name = ${name}, state = ${state}, version = ${nextVersion}
        where id = ${setId}
      `;
      await sql`
        delete from questions
        where question_set_id = ${setId}
      `;
    } else {
      nextVersion = 1;
      const inserted = await sql`
        insert into question_sets (user_id, name, state, version)
        values (${userId}, ${name}, ${state}, ${nextVersion})
        returning id
      `;
      setId = inserted[0].id;
    }

    for (const q of questions) {
      await sql`
        insert into questions (question_set_id, content)
        values (${setId}, ${JSON.stringify(q)}::jsonb)
      `;
    }

    try {
      await sql`
        insert into sync_logs (user_id, delta, status, error)
        values (${userId}, ${delta}, ${"success"}, ${null})
      `;
    } catch (e) {
      console.error(e);
    }

    if (ablyClient) {
      try {
        const channel = ablyClient.channels.get(`user:${userId}`);
        await channel.publish("question-set-updated", {
          setId,
          at: new Date().toISOString(),
          version: nextVersion
        });
      } catch (e) {
        console.error("Ably publish failed", e);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, setId, version: nextVersion }),
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
    try {
      await sql`
        insert into sync_logs (user_id, delta, status, error)
        values (${userId}, ${delta}, ${"error"}, ${detail})
      `;
    } catch (e2) {
      console.error(e2);
    }
    return new Response(
      JSON.stringify({ error: "数据库错误", detail }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};

// 把这个函数映射到 /api/save-question-set 路径
export const config = {
  path: "/api/save-question-set"
};
