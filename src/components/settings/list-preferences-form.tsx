"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateListPreferences } from "@/lib/leads/crm-actions";
import type { ListPreferencesValues } from "@/lib/leads/queries";

/**
 * The three values are read together by the engine, so this saves explicitly
 * rather than on blur — a half-applied combination would produce a confusing
 * list the next morning.
 */
export function ListPreferencesForm({
  initial,
}: {
  initial: ListPreferencesValues;
}) {
  const t = useTranslations("Settings.list");
  const tErrors = useTranslations("Leads.errors");
  const [values, setValues] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function update(key: keyof ListPreferencesValues, raw: string) {
    const parsed = Number.parseInt(raw, 10);
    setValues((v) => ({ ...v, [key]: Number.isNaN(parsed) ? 0 : parsed }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateListPreferences(values);
      if (result.ok) toast.success(t("saved"));
      else toast.error(tErrors(result.error));
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="dailyTarget"
        label={t("dailyTarget")}
        hint={t("dailyTargetHint")}
        value={values.dailyTarget}
        min={1}
        max={200}
        onChange={(v) => update("dailyTarget", v)}
      />
      <Field
        id="trashMax"
        label={t("trashMax")}
        hint={t("trashMaxHint")}
        value={values.trashMax}
        min={0}
        max={50}
        onChange={(v) => update("trashMax", v)}
      />
      <Field
        id="followUpDays"
        label={t("followUpDays")}
        hint={t("followUpDaysHint")}
        value={values.followUpDays}
        min={1}
        max={90}
        onChange={(v) => update("followUpDays", v)}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[1fr_6rem] sm:items-center sm:gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        className="tabular-nums"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
