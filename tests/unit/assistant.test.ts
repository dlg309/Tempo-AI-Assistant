import { describe, it, expect, vi } from "vitest";
import { runToolLoop, askAssistant } from "../../src/lib/assistant";
import { validateTool } from "../../src/lib/ai-tools";
import type { Content, GenerateContentResponse } from "@google/genai";
import type { DbClient } from "../../src/lib/supabase";
describe("bounded Gemini tools", () => {
  it("rejects unsupported operations, injected owners and malformed windows", () => {
    expect(() => validateTool("execute_sql", { sql: "select 1" })).toThrow();
    expect(() => validateTool("get_tasks", { owner_id: "other" })).toThrow();
    expect(() =>
      validateTool("propose_schedule", { start: "bad", end: "bad" }),
    ).toThrow();
    expect(() =>
      validateTool("propose_schedule", {
        start: "2026-10-12T00:00:00Z",
        end: "2027-10-12T00:00:00Z",
      }),
    ).toThrow();
  });
  it("preserves model tool parts and returns the real service outcome", async () => {
    const part = {
      functionCall: { id: "tool1", name: "get_tasks", args: {} },
      thoughtSignature: "signature",
    };
    const contents: Content[] = [
      { role: "user", parts: [{ text: "Plan my work" }] },
    ];
    const mock = vi
      .fn()
      .mockResolvedValueOnce({
        functionCalls: [part.functionCall],
        candidates: [{ content: { role: "model", parts: [part] } }],
      })
      .mockResolvedValueOnce({ text: "A proposal is ready to review." });
    const execute = vi.fn().mockResolvedValue({ tasks: [] });
    expect(await runToolLoop(mock, contents, [], "", execute)).toContain(
      "review",
    );
    expect(contents[1].parts?.[0]).toEqual(part);
    expect(contents[2].parts?.[0].functionResponse?.response).toEqual({
      result: { tasks: [] },
    });
  });
  it("keeps unknown tool names out of services", async () => {
    const execute = vi.fn();
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        functionCalls: [{ name: "run_code", args: {} }],
        candidates: [{ content: { role: "model", parts: [] } }],
      })
      .mockResolvedValueOnce({ text: "Please clarify." });
    const contents: Content[] = [];
    await runToolLoop(call, contents, [], "", execute);
    expect(execute).not.toHaveBeenCalled();
    expect(
      contents[1].parts?.[0].functionResponse?.response?.result,
    ).toHaveProperty("error");
  });
  it("limits repeated calls instead of looping indefinitely", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({
        functionCalls: [{ name: "get_tasks", args: {} }],
        candidates: [{ content: { role: "model", parts: [] } }],
      });
    await expect(runToolLoop(call, [], [], "", async () => [])).rejects.toThrow(
      "limit",
    );
    expect(call).toHaveBeenCalledTimes(5);
  });
  it("propagates provider failures and rejects empty responses", async () => {
    await expect(
      runToolLoop(
        async () => {
          throw new Error("quota");
        },
        [],
        [],
        "",
        async () => [],
      ),
    ).rejects.toThrow("quota");
    await expect(
      runToolLoop(
        async () => ({ text: "" }) as GenerateContentResponse,
        [],
        [],
        "",
        async () => [],
      ),
    ).rejects.toThrow("empty");
  });
  it("shows configuration failure rather than fabricating a response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(
      askAssistant({} as DbClient, "user@example.com", "Plan my week"),
    ).rejects.toThrow("not configured");
    vi.unstubAllEnvs();
  });
});
