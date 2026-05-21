"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
});

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(120),
});

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }

  redirect(parsed.data.next || "/leads");
}

export async function signUpAction(
  formData: FormData,
): Promise<ActionResult<{ needsEmailConfirmation: boolean }>> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });

  if (!parsed.success) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${env.appUrl}/api/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // If email confirmation is enabled, session will be null; user must confirm via email.
  const needsEmailConfirmation = !data.session;
  return { ok: true, data: { needsEmailConfirmation } };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
