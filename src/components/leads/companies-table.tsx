import { getTranslations } from "next-intl/server";
import { ArrowUpRight, Mail, Phone, ShieldCheck, User } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EnrichStatus } from "@/components/leads/enrich-status";
import { AiSourceLink } from "@/components/leads/ai-source-link";
import type { CompaniesPage } from "@/lib/leads/queries";
import {
  displayHost,
  resolveCompanyContact,
  telHref,
  websiteHref,
} from "@/lib/leads/contact";
import { formatRelativeDate } from "@/lib/format";

// Colored dot per enrichment status, for the debug Status column.
function statusDotClass(status: string): string {
  switch (status) {
    case "enriched":
    case "scraped":
      return "bg-green-500";
    case "failed":
      return "bg-red-500";
    case "no_match":
      return "bg-amber-500";
    case "queued":
      return "bg-blue-500";
    default: // pending, skipped
      return "bg-muted-foreground/50";
  }
}

// One pipeline status row (e.g. "CVR  enriched") with a status-colored dot.
function StatusLine({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block size-1.5 shrink-0 rounded-full ${statusDotClass(status)}`}
      />
      <span className="text-muted-foreground w-8 shrink-0">{label}</span>
      <span>{status}</span>
    </div>
  );
}

// Tiny "where did this value come from" tag, shown next to a fallback value.
function SourceTag({ label, title }: { label: string; title: string }) {
  return (
    <span title={title} className="text-muted-foreground text-[10px] uppercase">
      {label}
    </span>
  );
}

export async function CompaniesTable({ page }: { page: CompaniesPage }) {
  const t = await getTranslations("Leads.columns");
  const tEnrich = await getTranslations("Leads.enrich");
  const tKrak = await getTranslations("Leads.krak");
  const tAi = await getTranslations("Leads.ai");

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("phone")}</TableHead>
            <TableHead>{t("email")}</TableHead>
            <TableHead>{t("contactPerson")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead className="text-right">{t("openJobs")}</TableHead>
            <TableHead>{t("lastSeen")}</TableHead>
            <TableHead>{t("website")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((row) => {
            // Per-field cascade: CVR → website (scraper) → Krak. A small tag
            // marks which fallback a value came from; CVR-sourced values get
            // no tag, since that's the canonical source.
            const {
              phone,
              phoneSource,
              email,
              emailSource,
              contactName,
              contactTitle,
              contactSource,
              contactSourceUrl,
              phoneSourceUrl,
              hasAny: hasAnyContact,
            } = resolveCompanyContact(row);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium">
                    {row.name}
                    {row.is_ad_protected ? (
                      <span
                        title={tEnrich("adProtected")}
                        className="inline-flex"
                      >
                        <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
                      </span>
                    ) : null}
                    {row.is_bankrupt ? (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                        {tEnrich("bankrupt")}
                      </Badge>
                    ) : null}
                  </div>
                  {row.cvr_industry_text || row.industry ? (
                    <div className="text-muted-foreground text-xs">
                      {row.cvr_industry_text ?? row.industry}
                    </div>
                  ) : null}
                </TableCell>

                {/* Telefon. The AI marker is a sibling of the tel: link, not a
                    child — nested anchors are invalid HTML. */}
                <TableCell className="text-sm">
                  {phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <a
                        href={`tel:${telHref(phone)}`}
                        className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <Phone className="text-muted-foreground size-3.5 shrink-0" />
                        {phone}
                        {phoneSource === "website" ? (
                          <SourceTag label="Web" title={tEnrich("fromWebsite")} />
                        ) : phoneSource === "krak" ? (
                          <SourceTag
                            label={tKrak("source")}
                            title={tKrak("sourceKrak")}
                          />
                        ) : phoneSource === "ai" ? (
                          <SourceTag label="AI" title={tAi("foundByAi")} />
                        ) : null}
                      </a>
                      {phoneSourceUrl ? (
                        <AiSourceLink href={phoneSourceUrl} label={tAi("sourceLink")} />
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Email */}
                <TableCell className="text-sm">
                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                    >
                      <Mail className="text-muted-foreground size-3.5 shrink-0" />
                      {email}
                      {emailSource === "website" ? (
                        <SourceTag label="Web" title={tEnrich("fromWebsite")} />
                      ) : null}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Kontaktperson — name + title, or the enrichment affordance
                    when the company has no contact data at all. */}
                <TableCell className="text-sm">
                  {contactName ? (
                    <div className="flex items-center gap-1.5">
                      <User className="text-muted-foreground size-3.5 shrink-0" />
                      <span>{contactName}</span>
                      {contactTitle ? (
                        <span className="text-muted-foreground">
                          · {contactTitle}
                        </span>
                      ) : null}
                      {contactSource === "website" ? (
                        <SourceTag label="Web" title={tEnrich("fromWebsite")} />
                      ) : contactSource === "krak" ? (
                        <SourceTag
                          label={tKrak("source")}
                          title={tKrak("sourceKrak")}
                        />
                      ) : contactSource === "ai" ? (
                        <SourceTag label="AI" title={tAi("foundByAi")} />
                      ) : null}
                      {contactSourceUrl ? (
                        <AiSourceLink href={contactSourceUrl} label={tAi("sourceLink")} />
                      ) : null}
                    </div>
                  ) : !hasAnyContact ? (
                    <EnrichStatus
                      companyId={row.id}
                      status={row.cvr_enrichment_status}
                      krakStatus={row.krak_enrichment_status}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="text-xs">
                  <div className="space-y-0.5">
                    <StatusLine label="CVR" status={row.cvr_enrichment_status} />
                    <StatusLine
                      label="Web"
                      status={row.website_scrape_status}
                    />
                    <StatusLine
                      label="Krak"
                      status={row.krak_enrichment_status}
                    />
                  </div>
                </TableCell>

                <TableCell className="text-muted-foreground text-sm">
                  {[row.location_city, row.country].filter(Boolean).join(", ") ||
                    "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary" className="tabular-nums">
                    {row.open_jobs_count}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatRelativeDate(row.last_seen_at)}
                </TableCell>
                <TableCell className="text-sm">
                  {row.website ? (
                    <a
                      href={websiteHref(row.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      {displayHost(row.website)}
                      <ArrowUpRight className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
