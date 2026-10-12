import { z } from "zod";
import { windowInput, uuid } from "./domain";
import { taskChangesInput } from "./services";
export const toolSchemas = {
  get_tasks: z
    .object({ status: z.enum(["open", "done", "archived"]).optional() })
    .strict(),
  get_schedule: windowInput,
  get_availability: windowInput,
  propose_task_changes: taskChangesInput,
  propose_schedule: windowInput,
  explain_plan: z.object({ id: uuid }).strict(),
};
export type ToolName = keyof typeof toolSchemas;
export function validateTool(name: string, args: unknown) {
  if (!Object.hasOwn(toolSchemas, name))
    throw new Error("Unsupported assistant tool");
  return toolSchemas[name as ToolName].parse(args);
}
export const descriptions: Record<ToolName, string> = {
  get_tasks:
    "Read user tasks and their IDs, remaining minutes, deadlines and versions.",
  get_schedule:
    "Read commitments and scheduled work in a bounded window (maximum 31 days).",
  get_availability:
    "Calculate free intervals inside the user availability, excluding busy commitments.",
  propose_task_changes:
    "Create a reviewable proposal to add or update tasks. Does not save the tasks until user applies it. For updates include existing id and version. Ask if effort or identity is ambiguous.",
  propose_schedule:
    "Use the deterministic engine to propose blocks in the next 31 days. For unfinished work use replan=true. Never marks tasks complete. Preserve locked commitments.",
  explain_plan:
    "Read the placement reasons, warnings and unscheduled effort for a proposal.",
};
