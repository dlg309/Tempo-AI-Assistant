import { AppError } from "./services";
import { MAX_ICS_BYTES } from "./ical";

export async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Send application/json.", 415);
  if (Number(request.headers.get("content-length")) > MAX_ICS_BYTES + 20000)
    throw new AppError("Request exceeds 1 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ICS_BYTES + 20000) {
      await reader.cancel();
      throw new AppError("Request exceeds 1 MB.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError("Invalid JSON request.");
  }
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = [
    new URL(request.url).origin,
    ...(process.env.NEXT_PUBLIC_APP_URL
      ? [new URL(process.env.NEXT_PUBLIC_APP_URL).origin]
      : []),
  ];
  if (!origin || !allowed.includes(origin))
    throw new AppError("This request came from an unrecognized origin.", 403);
}
