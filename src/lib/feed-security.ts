import https from "node:https";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { MAX_ICS_BYTES } from "./ical";
import { createHash, randomBytes } from "node:crypto";

export function isPublicAddress(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function validateFeedUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    url.href.length > 2048
  )
    throw new Error(
      "Use an HTTPS calendar URL without credentials, fragments, or a custom port.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    /\.(localhost|local|internal|home|lan)$/.test(host) ||
    (!host.includes(".") && !host.includes(":")) ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  )
    throw new Error("Calendar feeds must use a public Internet address.");
  return url;
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function generateFeedToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

// Resolve once, reject every private answer, and pin the connection to the
// validated address. Each redirect repeats validation and pinned resolution.
export async function fetchFeed(input: string): Promise<string> {
  const deadline = Date.now() + 12000;
  let url = validateFeedUrl(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const answers = ipaddr.isValid(host)
      ? [
          {
            address: host,
            family: ipaddr.parse(host).kind() === "ipv6" ? 6 : 4,
          },
        ]
      : await Promise.race([
          lookup(host, { all: true, verbatim: true }),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Feed DNS lookup timed out.")),
              Math.max(1, deadline - Date.now()),
            );
            timer.unref();
          }),
        ]);
    if (!answers.length || answers.some((a) => !isPublicAddress(a.address)))
      throw new Error(
        "Feed destination resolves to a private or reserved network.",
      );
    if (Date.now() >= deadline) throw new Error("Feed retrieval timed out.");
    const pinned = answers[0];
    const result = await new Promise<{ redirect?: string; body?: string }>(
      (resolve, reject) => {
        const pinnedLookup = ((
          _hostname: string,
          options: { all?: boolean },
          callback: (...args: unknown[]) => void,
        ) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        }) as LookupFunction;
        const req = https.request(
          url,
          {
            method: "GET",
            lookup: pinnedLookup,
            headers: {
              Accept: "text/calendar",
              "User-Agent": "Tempo-Calendar/1.0",
            },
            agent: false,
          },
          (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
              const location = res.headers.location;
              res.destroy();
              if (!location)
                reject(new Error("Feed redirect has no destination."));
              else resolve({ redirect: location });
              return;
            }
            if (res.statusCode !== 200) {
              res.destroy();
              reject(
                new Error(
                  "Feed did not return a successful calendar response.",
                ),
              );
              return;
            }
            if (
              res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity"
            ) {
              res.destroy();
              reject(
                new Error(
                  "Compressed feeds are unsupported; use an uncompressed calendar URL.",
                ),
              );
              return;
            }
            if (Number(res.headers["content-length"]) > MAX_ICS_BYTES) {
              res.destroy();
              reject(new Error("Feed exceeds 1 MB."));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_ICS_BYTES) {
                req.destroy(new Error("Feed exceeds 1 MB."));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () =>
              resolve({ body: Buffer.concat(chunks).toString("utf8") }),
            );
            res.on("error", reject);
          },
        );
        const timeout = setTimeout(
          () => req.destroy(new Error("Feed retrieval timed out.")),
          Math.max(1, deadline - Date.now()),
        );
        req.on("close", () => clearTimeout(timeout));
        req.on("error", reject);
        req.end();
      },
    );
    if (result.body !== undefined) return result.body;
    if (redirects === 3) throw new Error("Too many calendar feed redirects.");
    url = validateFeedUrl(new URL(result.redirect!, url).href);
  }
  throw new Error("Feed retrieval failed.");
}
