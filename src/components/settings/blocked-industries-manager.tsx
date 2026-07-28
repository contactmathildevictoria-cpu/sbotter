"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addBlockedIndustry,
  removeBlockedIndustry,
} from "@/lib/leads/crm-actions";
import { INDUSTRY_PRESETS } from "@/lib/leads/industries";

export type BlockedIndustry = {
  industry_code: number;
  industry_label: string;
};

export type IndustryOption = { code: number; label: string };

export function BlockedIndustriesManager({
  blocked,
  options,
}: {
  blocked: BlockedIndustry[];
  /** Industries that actually occur in the pool — far more useful than the
   *  full DB07 catalogue. */
  options: IndustryOption[];
}) {
  const t = useTranslations("Settings.industries");
  const tErrors = useTranslations("Leads.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const blockedCodes = new Set(blocked.map((b) => b.industry_code));

  function block(entries: { code: number; label: string }[]) {
    startTransition(async () => {
      for (const entry of entries) {
        const result = await addBlockedIndustry(entry);
        if (!result.ok) {
          toast.error(tErrors(result.error));
          return;
        }
      }
      router.refresh();
    });
  }

  function unblock(code: number) {
    startTransition(async () => {
      const result = await removeBlockedIndustry({ code });
      if (!result.ok) toast.error(tErrors(result.error));
      else router.refresh();
    });
  }

  const availablePresets = INDUSTRY_PRESETS.filter((preset) =>
    preset.codes.some((code) => !blockedCodes.has(code)),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={isPending}
              className="justify-between sm:w-72"
            >
              {t("search")}
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder={t("placeholder")} />
              <CommandList>
                <CommandEmpty>{t("noResults")}</CommandEmpty>
                <CommandGroup>
                  {options
                    .filter((option) => !blockedCodes.has(option.code))
                    .map((option) => (
                      <CommandItem
                        key={option.code}
                        value={`${option.label} ${option.code}`}
                        onSelect={() => {
                          setOpen(false);
                          block([{ code: option.code, label: option.label }]);
                        }}
                      >
                        {option.label}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {availablePresets.map((preset) => (
          <Button
            key={preset.id}
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              block(
                preset.codes
                  .filter((code) => !blockedCodes.has(code))
                  .map((code) => ({ code, label: preset.label })),
              )
            }
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {blocked.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {blocked.map((industry) => (
            <li
              key={industry.industry_code}
              className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-3 text-sm"
            >
              <span title={String(industry.industry_code)}>
                {industry.industry_label}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={isPending}
                aria-label={t("remove", { name: industry.industry_label })}
                onClick={() => unblock(industry.industry_code)}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
