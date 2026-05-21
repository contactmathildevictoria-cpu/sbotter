"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import { signUpAction } from "@/lib/auth/actions";

export function SignupForm() {
  const t = useTranslations("Auth");
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await signUpAction(formData);
      if (!result.ok) {
        setError(t("genericError"));
        toast.error(t("genericError"));
        return;
      }
      if (result.data?.needsEmailConfirmation) {
        setConfirmation(true);
      } else {
        window.location.href = "/leads";
      }
    });
  }

  if (confirmation) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm">{t("checkEmail")}</div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          disabled={isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isPending}
        />
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {t("submitSignup")}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/login" className="underline-offset-4 hover:underline">
          {t("switchToLogin")}
        </Link>
      </p>
    </form>
  );
}
