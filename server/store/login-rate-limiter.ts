import { createHash } from "node:crypto";
import { getPool } from "./db";

const WINDOW_MINUTES = 10;
const LOCK_MINUTES = 5;

type LoginRateLimitKeys = {
  account: string;
  ip: string;
};

function hashBucket(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getLoginRateLimitKeys(ip: string, username: string): LoginRateLimitKeys {
  return {
    account: hashBucket(`account\0${username.toLowerCase()}\0${ip}`),
    ip: hashBucket(`ip\0${ip}`),
  };
}

export async function getLoginRetryAfterSeconds(keys: LoginRateLimitKeys) {
  const { rows } = await getPool().query(
    `SELECT CEIL(EXTRACT(EPOCH FROM (MAX(locked_until) - now())))::int AS retry_after
     FROM login_rate_limits
     WHERE bucket_key = ANY($1::text[])
       AND locked_until > now()`,
    [Object.values(keys)],
  );
  return Number(rows[0]?.retry_after ?? 0);
}

async function recordFailure(bucketKey: string, threshold: number) {
  await getPool().query(
    `INSERT INTO login_rate_limits (bucket_key, attempts, window_started_at, updated_at)
     VALUES ($1, 1, now(), now())
     ON CONFLICT (bucket_key) DO UPDATE SET
       attempts = CASE
         WHEN login_rate_limits.window_started_at <= now() - interval '${WINDOW_MINUTES} minutes' THEN 1
         ELSE login_rate_limits.attempts + 1
       END,
       window_started_at = CASE
         WHEN login_rate_limits.window_started_at <= now() - interval '${WINDOW_MINUTES} minutes' THEN now()
         ELSE login_rate_limits.window_started_at
       END,
       locked_until = CASE
         WHEN login_rate_limits.window_started_at <= now() - interval '${WINDOW_MINUTES} minutes' THEN NULL
         WHEN login_rate_limits.attempts + 1 >= $2 THEN now() + interval '${LOCK_MINUTES} minutes'
         ELSE login_rate_limits.locked_until
       END,
       updated_at = now()
     RETURNING bucket_key`,
    [bucketKey, threshold],
  );
}

export async function recordLoginFailure(keys: LoginRateLimitKeys) {
  await Promise.all([
    recordFailure(keys.account, 5),
    recordFailure(keys.ip, 50),
  ]);
  await getPool().query(
    `DELETE FROM login_rate_limits
     WHERE updated_at < now() - interval '1 day'`,
  );
}

export async function clearLoginAccountFailures(keys: LoginRateLimitKeys) {
  await getPool().query(
    `DELETE FROM login_rate_limits WHERE bucket_key = $1`,
    [keys.account],
  );
}
