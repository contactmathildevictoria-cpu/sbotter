"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import { signInAction } from "@/lib/auth/actions";

export function LoginForm() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    if (next) formData.set("next", next);

    startTransition(async () => {
      const result = await signInAction(formData);
      if (result && !result.ok) {
        const message =
          result.error === "INVALID_CREDENTIALS"
            ? t("invalidCredentials")
            : t("genericError");
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
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
          autoComplete="current-password"
          required
          minLength={6}
          disabled={isPending}
        />
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {t("submitLogin")}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/signup" className="underline-offset-4 hover:underline">
          {t("switchToSignup")}
        </Link>
      </p>
    </form>
  );
}
