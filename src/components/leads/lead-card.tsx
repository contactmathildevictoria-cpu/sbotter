"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  ChevronDown,
  Phone,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiSourceLink } from "@/components/leads/ai-source-link";
import {
  displayHost,
  resolveCompanyContact,
  telHref,
  websiteHref,
} from "@/lib/leads/contact";
import { setLeadNote, setLeadRating } from "@/lib/leads/crm-actions";
import type { BoardLead } from "@/lib/leads/queries";
import type { LeadStatus } from "@/types/database";
import { cn } from "@/lib/utils";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "no_pickup",
  "meeting",
  "won",
  "lost",
];

const RATING_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** How long to wait after the last keystroke before persisting a note. */
const NOTE_DEBOUNCE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

export function LeadCard({
  lead,
  todayISO,
  onStatusChange,
  onDelete,
  pending,
}: {
  lead: BoardLead;
  /** Computed on the server so the "new today" badge can't hydrate wrong. */
  todayISO: string;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onDelete: (id: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("Leads.card");
  const tStatus = useTranslations("Leads.status");
  const tAi = useTranslations("Leads.ai");
  const tDelete = useTranslations("Leads.delete");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const company = lead.company;
  const contact = resolveCompanyContact(company ?? {});
  const isFreshToday = lead.list_date === todayISO;
  const industry = company?.cvr_industry_text ?? company?.industry ?? null;

  return (
    <article
      className={cn(
        "bg-card space-y-3 rounded-xl border p-4",
        lead.status === "no_pickup" && "opacity-70",
      )}
    >
      {/* --- Always visible: name, contact person, phone, rating --- */}
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="leading-tight font-medium">
            {company?.name ?? "—"}
          </h3>
          {isFreshToday ? (
            <Badge variant="secondary" className="shrink-0">
              {t("freshToday")}
            </Badge>
          ) : null}
        </div>
        {industry ? (
          <p className="text-muted-foreground truncate text-xs" title={industry}>
            {industry}
          </p>
        ) : null}
      </header>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <User className="text-muted-foreground size-3.5 shrink-0" />
          {contact.contactName ? (
            <span className="truncate">
              {contact.contactName}
              {contact.contactTitle ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {contact.contactTitle}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("noContact")}</span>
          )}
          {contact.contactSourceUrl ? (
            <AiSourceLink
              href={contact.contactSourceUrl}
              label={tAi("sourceLink")}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <Phone className="text-muted-foreground size-3.5 shrink-0" />
          {contact.phone ? (
            <a
              href={`tel:${telHref(contact.phone)}`}
              className="tabular-nums underline-offset-4 hover:underline"
            >
              {contact.phone}
            </a>
          ) : (
            <span className="text-muted-foreground">{t("noPhone")}</span>
          )}
          {/* An AI-found number is never shown bare — this links to the page
              the model read it from so the seller can check it. */}
          {contact.phoneSourceUrl ? (
            <AiSourceLink
              href={contact.phoneSourceUrl}
              label={tAi("sourceLink")}
            />
          ) : null}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-foreground font-medium tabular-nums">
            {t("ratingValue", { rating: lead.rating ?? "–" })}
          </span>
          {company ? (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="size-3 shrink-0" />
              {t("openJobs", { count: company.open_jobs_count })}
            </span>
          ) : null}
          {company?.location_city ? <span>{company.location_city}</span> : null}
          {company?.website ? (
            <a
              href={websiteHref(company.website)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
            >
              {displayHost(company.website)}
              <ArrowUpRight className="size-3 shrink-0" />
            </a>
          ) : null}
        </div>

        {lead.status === "no_pickup" && lead.follow_up_at ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CalendarClock className="size-3.5 shrink-0" />
            {t("followUpAt", { date: lead.follow_up_at })}
          </div>
        ) : null}
      </div>

      <RatingPicker leadId={lead.id} initial={lead.rating} />

      <NoteField leadId={lead.id} initial={lead.note} />

      {/* --- Status --- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {lead.status === "new" ? (
          <>
            <Button
              size="xs"
              variant="secondary"
              disabled={pending}
              onClick={() => onStatusChange(lead.id, "contacted")}
            >
              {tStatus("contacted")}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => onStatusChange(lead.id, "no_pickup")}
            >
              {tStatus("no_pickup")}
            </Button>
          </>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              className="ml-auto"
              aria-label={t("changeStatus")}
            >
              {tStatus(lead.status)}
              <ChevronDown className="size-3 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ALL_STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                disabled={status === lead.status}
                onSelect={() => onStatusChange(lead.id, status)}
              >
                {tStatus(status)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              // Deleting is permanent — the company never comes back on a
              // future daily list — so it goes through a confirmation.
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-3.5 shrink-0" />
              {tDelete("action")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tDelete("confirmTitle")}</DialogTitle>
            <DialogDescription>
              {tDelete("confirmBody", { name: company?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              {tDelete("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                onDelete(lead.id);
              }}
            >
              {tDelete("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

/**
 * Ten discrete buttons rather than a slider or a select: one click, and the
 * current value stays readable without opening anything.
 */
function RatingPicker({
  leadId,
  initial,
}: {
  leadId: string;
  initial: number | null;
}) {
  const t = useTranslations("Leads.card");
  const tErrors = useTranslations("Leads.errors");
  const [rating, setRating] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function choose(value: number) {
    // Clicking the current value clears it.
    const next = value === rating ? null : value;
    const previous = rating;
    setRating(next);
    startTransition(async () => {
      const result = await setLeadRating({ id: leadId, rating: next });
      if (!result.ok) {
        setRating(previous);
        toast.error(tErrors(result.error));
      }
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("rating")}
      className="flex flex-wrap gap-1"
    >
      {RATING_VALUES.map((value) => {
        const selected = rating !== null && value <= rating;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={String(value)}
            disabled={isPending}
            onClick={() => choose(value)}
            className={cn(
              "size-6 rounded-sm border text-[10px] tabular-nums transition-colors",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground hover:bg-muted border-input",
            )}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

function NoteField({
  leadId,
  initial,
}: {
  leadId: string;
  initial: string | null;
}) {
  const t = useTranslations("Leads.card");
  const tErrors = useTranslations("Leads.errors");
  const [note, setNote] = useState(initial ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const lastSaved = useRef(initial ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `note` so the debounced flush reads the latest value without
  // re-creating the timer on every keystroke. Written only from the change
  // handler, never during render.
  const noteRef = useRef(initial ?? "");

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = noteRef.current;
    // Skip the write when nothing changed — tabbing through a card shouldn't
    // hit the database.
    if (value === lastSaved.current) return;

    setSaveState("saving");
    void setLeadNote({ id: leadId, note: value }).then((result) => {
      if (result.ok) {
        lastSaved.current = value;
        setSaveState("saved");
      } else {
        setSaveState("error");
        toast.error(tErrors(result.error));
      }
    });
  }

  function handleChange(value: string) {
    setNote(value);
    noteRef.current = value;
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, NOTE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="space-y-1">
      <Textarea
        value={note}
        rows={2}
        maxLength={2000}
        placeholder={t("notePlaceholder")}
        aria-label={t("note")}
        className="min-h-0 resize-none text-sm"
        onChange={(e) => handleChange(e.target.value)}
        // A card that changes column unmounts, which would drop an in-flight
        // debounce — so blur always flushes.
        onBlur={flush}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            flush();
          }
        }}
      />
      {saveState !== "idle" ? (
        <p className="text-muted-foreground text-xs">
          {saveState === "saving"
            ? t("saving")
            : saveState === "saved"
              ? t("saved")
              : t("saveError")}
        </p>
      ) : null}
    </div>
  );
}
