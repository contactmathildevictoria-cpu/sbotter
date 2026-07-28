"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addExcludedCompany,
  removeExcludedCompany,
} from "@/lib/leads/crm-actions";

export type ExcludedCompany = {
  id: string;
  name: string;
  name_normalized: string;
};

export function ExcludedCompaniesManager({
  companies,
}: {
  companies: ExcludedCompany[];
}) {
  const t = useTranslations("Settings.excluded");
  const tErrors = useTranslations("Leads.errors");
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    startTransition(async () => {
      const result = await addExcludedCompany({ name: value });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removeExcludedCompany({ id });
      if (!result.ok) toast.error(tErrors(result.error));
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={name}
          placeholder={t("placeholder")}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={isPending}>
          {t("add")}
        </Button>
      </form>

      {companies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {companies.map((company) => (
            <li
              key={company.id}
              className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-3 text-sm"
            >
              <span
                // The normalized form is what the engine matches on, so show it
                // — it explains why "Arla Foods A/S" also blocks "arla-foods".
                title={t("matchHint", { slug: company.name_normalized })}
              >
                {company.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={isPending}
                aria-label={t("remove", { name: company.name })}
                onClick={() => handleRemove(company.id)}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">{t("note")}</p>
    </div>
  );
}
