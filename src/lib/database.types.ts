import type {
  CalendarEvent,
  Message,
  Plan,
  Preferences,
  Proposal,
  Source,
  Task,
} from "./domain";
// Maintained boundary types; regenerate with Supabase CLI after schema changes.
type Table<R> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: [];
};
type Batch = {
  id: string;
  owner_id: string;
  proposal_id: string;
  created_ids: string[];
  before_events: CalendarEvent[];
  task_before: Task[];
  task_after: Task[];
  event_after: CalendarEvent[];
  undone: boolean;
  created_at: string;
};
type Feed = {
  owner_id: string;
  token_hash: string;
  include_commitments: boolean;
  include_focus: boolean;
  created_at: string;
};
export type Database = {
  public: {
    Tables: {
      preferences: Table<Preferences>;
      tasks: Table<Task>;
      events: Table<CalendarEvent>;
      calendar_sources: Table<Source>;
      proposals: Table<Proposal>;
      messages: Table<Message & { owner_id: string }>;
      change_batches: Table<Batch>;
      feed_tokens: Table<Feed>;
      rate_limits: Table<{
        owner_id: string;
        bucket: string;
        period: string;
        count: number;
      }>;
    };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      ensure_preferences: {
        Args: Record<never, never>;
        Returns: Preferences[];
      };
      save_preferences: {
        Args: { p: unknown; expected: number };
        Returns: Preferences[];
      };
      write_task: {
        Args: {
          p: unknown;
          record_id?: string;
          expected?: number;
          remove?: boolean;
        };
        Returns: string;
      };
      write_event: {
        Args: {
          p: unknown;
          record_id?: string;
          expected?: number;
          remove?: boolean;
        };
        Returns: string;
      };
      create_proposal: {
        Args: { p: Plan; expected: number };
        Returns: Proposal[];
      };
      apply_proposal: { Args: { proposal: string }; Returns: Batch[] };
      undo_proposal: { Args: { proposal: string }; Returns: undefined };
      reject_proposal: { Args: { proposal: string }; Returns: undefined };
      write_source: {
        Args: {
          p: unknown;
          record_id?: string;
          expected?: number;
          remove?: boolean;
        };
        Returns: string;
      };
      reconcile_source: {
        Args: {
          source: string;
          raw: string;
          entries: CalendarEvent[];
          canceled: { uid: string; recurrence_id: string | null }[];
          expected: number;
          job_owner?: string;
        };
        Returns: undefined;
      };
      claim_refresh: {
        Args: { source: string; job_owner?: string };
        Returns: Source[];
      };
      fail_refresh: {
        Args: { source: string; job_owner?: string };
        Returns: undefined;
      };
      set_feed: {
        Args: { hash?: string; commitments?: boolean; focus?: boolean };
        Returns: undefined;
      };
      append_message: {
        Args: { message_role: "user" | "assistant"; text_content: string };
        Returns: undefined;
      };
      take_rate_limit: {
        Args: { bucket_name: string; max_count: number; seconds: number };
        Returns: boolean;
      };
    };
  };
};
