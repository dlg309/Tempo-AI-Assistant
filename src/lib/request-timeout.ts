// Bound Supabase/Auth HTTP calls while preserving the caller's cancellation.
export const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(10000),
    ]),
  });
