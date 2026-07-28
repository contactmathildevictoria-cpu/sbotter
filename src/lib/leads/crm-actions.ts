"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";
import { slugify } from "@/lib/ingest/normalize";
import {
  addDaysISO,
  todayInCopenhagen,
  type DailyListSummary,
} from "@/lib/leads/daily-list-core";
import { generateDailyList } from "@/lib/leads/daily-list";
import type { LeadStatus } from "@/types/database";

/**
 * CRM mutations for the daily lead board.
 *
 * All of these go through the RLS-scoped server client, so a user can only
 * ever reach their own rows. Every statement also carries an explicit
 * `.eq("user_id", ...)` — belt and braces, and it turns someone else's id into
 * a clean NOT_FOUND rather than a silent no-op.
 */

const LEAD_STATUSES = [
  "new",
  "contacted",
  "no_pickup",
  "meeting",
  "won",
  "lost",
] as const satisfies readonly LeadStatus[];

// These ranges MUST mirror the CHECK constraints in
// 20260728120000_list_preferences.sql. If they drift, a friendly INVALID_INPUT
// turns into a 500 from Postgres.
const preferencesSchema = z.object({
  dailyTarget: z.number().int().min(1).max(200),
  trashMax: z.number().int().min(0).max(50),
  followUpDays: z.number().int().min(1).max(90),
});

const setStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(LEAD_STATUSES),
});

const setRatingSchema = z.object({
  id: z.uuid(),
  rating: z.number().int().min(1).max(10).nullable(),
});

const setNoteSchema = z.object({
  id: z.uuid(),
  note: z
    .string()
    .max(2000)
    .transform((s) => s.trim())
    .transform((s) => (s.length > 0 ? s : null)),
});

const addExcludedSchema = z.object({
  name: z.string().trim().min(2).max(200),
});

const idSchema = z.object({ id: z.uuid() });

const addIndustrySchema = z.object({
  code: z.number().int().min(1).max(999999),
  label: z.string().trim().min(1).max(120),
});

const industryCodeSchema = z.object({ code: z.number().int() });

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidateBoard() {
  // The bare "/leads/today" would miss "/en/leads/today" under next-intl's
  // as-needed locale prefix, hence the segment form. In practice these pages
  // are fully dynamic (the Supabase server client reads cookies), so the
  // client's router.refresh() is what actually repaints the board — this is
  // belt and braces.
  revalidatePath("/[locale]/leads/today", "page");
}

// ============================================================
// Lead mutations
// ============================================================

export async function setLeadStatus(input: {
  id: string;
  status: LeadStatus;
}): Promise<ActionResult<{ inTrash: boolean; followUpAt: string | null }>> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  const { id, status } = parsed.data;

  let inTrash = false;
  let followUpAt: string | null = null;

  if (status === "no_pickup") {
    const { data: prefs } = await supabase
      .from("list_preferences")
      .select("follow_up_days")
      .eq("user_id", user.id)
      .maybeSingle();

    // Computed here rather than as `current_date + n` in SQL: Postgres runs
    // UTC on Supabase, which would land the follow-up a day early for anything
    // done in the Danish evening.
    inTrash = true;
    followUpAt = addDaysISO(todayInCopenhagen(), prefs?.follow_up_days ?? 7);
  }

  const { data, error } = await supabase
    .from("lead_assignments")
    .update({ status, in_trash: inTrash, follow_up_at: followUpAt })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "UPDATE_FAILED" };
  if (!data) return { ok: false, error: "NOT_FOUND" };

  revalidateBoard();
  return { ok: true, data: { inTrash, followUpAt } };
}

export async function setLeadRating(input: {
  id: string;
  rating: number | null;
}): Promise<ActionResult> {
  const parsed = setRatingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  const { data, error } = await supabase
    .from("lead_assignments")
    .update({ rating: parsed.data.rating })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "UPDATE_FAILED" };
  if (!data) return { ok: false, error: "NOT_FOUND" };

  revalidateBoard();
  return { ok: true };
}

export async function setLeadNote(input: {
  id: string;
  note: string;
}): Promise<ActionResult> {
  const parsed = setNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  const { data, error } = await supabase
    .from("lead_assignments")
    .update({ note: parsed.data.note })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "UPDATE_FAILED" };
  if (!data) return { ok: false, error: "NOT_FOUND" };

  revalidateBoard();
  return { ok: true };
}

// ============================================================
// Exclusions
// ============================================================

export async function addExcludedCompany(input: {
  name: string;
}): Promise<ActionResult<{ id: string; nameNormalized: string }>> {
  const parsed = addExcludedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  // The same transform that produced companies.slug, so the engine can match
  // on equality or an "arla-" prefix.
  const nameNormalized = slugify(parsed.data.name);
  if (nameNormalized.length === 0) return { ok: false, error: "INVALID_INPUT" };

  const { data, error } = await supabase
    .from("excluded_companies")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      name_normalized: nameNormalized,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "ALREADY_EXCLUDED" };
    }
    return { ok: false, error: "INSERT_FAILED" };
  }
  if (!data) return { ok: false, error: "INSERT_FAILED" };

  revalidatePath("/[locale]/settings", "page");
  return { ok: true, data: { id: data.id, nameNormalized } };
}

export async function removeExcludedCompany(input: {
  id: string;
}): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  const { error } = await supabase
    .from("excluded_companies")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: "DELETE_FAILED" };

  revalidatePath("/[locale]/settings", "page");
  return { ok: true };
}

export async function addBlockedIndustry(input: {
  code: number;
  label: string;
}): Promise<ActionResult> {
  const parsed = addIndustrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  // upsert, so re-blocking an industry is a quiet no-op rather than an error.
  const { error } = await supabase.from("blocked_industries").upsert(
    {
      user_id: user.id,
      industry_code: parsed.data.code,
      industry_label: parsed.data.label,
    },
    { onConflict: "user_id,industry_code" },
  );

  if (error) return { ok: false, error: "INSERT_FAILED" };

  revalidatePath("/[locale]/settings", "page");
  return { ok: true };
}

export async function removeBlockedIndustry(input: {
  code: number;
}): Promise<ActionResult> {
  const parsed = industryCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  const { error } = await supabase
    .from("blocked_industries")
    .delete()
    .eq("industry_code", parsed.data.code)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: "DELETE_FAILED" };

  revalidatePath("/[locale]/settings", "page");
  return { ok: true };
}

// ============================================================
// Preferences
// ============================================================

export async function updateListPreferences(input: {
  dailyTarget: number;
  trashMax: number;
  followUpDays: number;
}): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  // upsert self-heals a user whose preferences row is missing.
  const { error } = await supabase.from("list_preferences").upsert(
    {
      user_id: user.id,
      daily_target: parsed.data.dailyTarget,
      trash_max: parsed.data.trashMax,
      follow_up_days: parsed.data.followUpDays,
    },
    { onConflict: "user_id" },
  );

  if (error) return { ok: false, error: "UPDATE_FAILED" };

  revalidatePath("/[locale]/settings", "page");
  revalidateBoard();
  return { ok: true };
}

// ============================================================
// Manual top-up
// ============================================================

/**
 * Runs the engine for the signed-in user on demand, behind the board's
 * "get more leads" button. Idempotent by construction — once the board holds
 * daily_target unworked leads the engine plans nothing — so it needs no rate
 * limit of its own.
 */
export async function refreshMyList(): Promise<
  ActionResult<DailyListSummary>
> {
  const { user } = await requireUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };

  try {
    const summary = await generateDailyList(user.id);
    revalidateBoard();
    return { ok: true, data: summary };
  } catch (err) {
    console.error("[daily-list] manual refresh failed:", err);
    return { ok: false, error: "GENERATE_FAILED" };
  }
}
