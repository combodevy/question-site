import { neon } from "@netlify/neon";

const sql = neon();

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
    const sets = await sql`
      select id, name, state, version from question_sets
      where user_id = ${userId}
      limit 1
    `;

    if (!sets.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          setId: null,
          name: null,
          state: null,
          version: 0
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const set = sets[0];
    const setId = set.id;
    const version =
      typeof set.version === "number" && Number.isFinite(set.version)
        ? set.version
        : 0;

    let baseState = set.state || null;
    if (typeof baseState === "string") {
      try {
        baseState = JSON.parse(baseState);
      } catch (e) {
        baseState = null;
      }
    }

    const rows = await sql`
      select content from questions
      where question_set_id = ${setId}
    `;

    const bank = {};

    for (const row of rows) {
      let q = row.content;
      if (typeof q === "string") {
        try {
          q = JSON.parse(q);
        } catch (e) {
          q = null;
        }
      }
      if (!q || typeof q !== "object") continue;
      const sub = q.sub || "默认科目";
      const chap = q.chap || "默认章节";
      if (!bank[sub]) bank[sub] = {};
      if (!bank[sub][chap]) bank[sub][chap] = [];
      bank[sub][chap].push(q);
    }
    const countBank = (bk) => {
      if (!bk || typeof bk !== "object") return 0;
      let total = 0;
      for (const sub in bk) {
        const chaps = bk[sub];
        if (!chaps || typeof chaps !== "object") continue;
        for (const chap in chaps) {
          const arr = chaps[chap];
          if (Array.isArray(arr)) total += arr.length;
        }
      }
      return total;
    };
    const baseBank =
      baseState && typeof baseState === "object" && baseState.bank
        ? baseState.bank
        : null;
    if (baseBank && countBank(baseBank) > countBank(bank)) {
      for (const sub in bank) delete bank[sub];
      Object.assign(bank, baseBank);
    }

    const state = {
      bank,
      bankName:
        baseState &&
        typeof baseState === "object" &&
        typeof baseState.bankName === "string"
          ? baseState.bankName
          : null,
      history:
        baseState &&
        typeof baseState === "object" &&
        Array.isArray(baseState.history)
          ? baseState.history
          : [],
      lastPracticeTime:
        baseState &&
        typeof baseState === "object" &&
        typeof baseState.lastPracticeTime === "number"
          ? baseState.lastPracticeTime
          : null,
      trash:
        baseState &&
        typeof baseState === "object" &&
        baseState.trash &&
        typeof baseState.trash === "object" &&
        !Array.isArray(baseState.trash)
          ? baseState.trash
          : {},
      hiddenMistakeIds:
        baseState &&
        typeof baseState === "object" &&
        Array.isArray(baseState.hiddenMistakeIds)
          ? baseState.hiddenMistakeIds
          : []
    };

    return new Response(
      JSON.stringify({ ok: true, setId, name: set.name, state, version }),
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
  path: "/api/load-question-set"
};
