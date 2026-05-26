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
import type { CompaniesPage } from "@/lib/leads/queries";
import { formatRelativeDate } from "@/lib/format";

// Danish numbers come from CVR without a country code; prefix +45 for tel: links.
function telHref(phone: string): string {
  const trimmed = phone.replace(/\s+/g, "");
  return trimmed.startsWith("+") ? trimmed : `+45${trimmed}`;
}

// `website` may be stored as a bare domain; ensure links have a scheme.
function websiteHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Bare hostname for a compact, readable website link.
function displayHost(url: string): string {
  try {
    return new URL(websiteHref(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
            // Per-field cascade: CVR → website (scraper) → Krak. CVR columns are
            // never overwritten, so a fallback only surfaces when the CVR field
            // is empty. A small tag marks which fallback a value came from.
            const phone = row.phone ?? row.website_phone ?? row.krak_phone;
            const email = row.email ?? row.website_email;
            const contactName =
              row.contact_person_name ??
              row.website_contact_person ??
              row.krak_contact_person;
            // CVR has no title; website + Krak do — use the title from whichever
            // source the name came from.
            const contactTitle = row.contact_person_name
              ? null
              : row.website_contact_person
                ? row.website_contact_title
                : row.krak_contact_person
                  ? row.krak_contact_title
                  : null;
            const phoneSource: "web" | "krak" | null = row.phone
              ? null
              : row.website_phone
                ? "web"
                : row.krak_phone
                  ? "krak"
                  : null;
            const emailFromWeb = !row.email && Boolean(row.website_email);
            const nameSource: "web" | "krak" | null = row.contact_person_name
              ? null
              : row.website_contact_person
                ? "web"
                : row.krak_contact_person
                  ? "krak"
                  : null;
            const hasAnyContact = Boolean(contactName || phone || email);
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

                {/* Telefon */}
                <TableCell className="text-sm">
                  {phone ? (
                    <a
                      href={`tel:${telHref(phone)}`}
                      className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                    >
                      <Phone className="text-muted-foreground size-3.5 shrink-0" />
                      {phone}
                      {phoneSource === "web" ? (
                        <SourceTag label="Web" title={tEnrich("fromWebsite")} />
                      ) : phoneSource === "krak" ? (
                        <SourceTag
                          label={tKrak("source")}
                          title={tKrak("sourceKrak")}
                        />
                      ) : null}
                    </a>
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
                      {emailFromWeb ? (
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
                      {nameSource === "web" ? (
                        <SourceTag label="Web" title={tEnrich("fromWebsite")} />
                      ) : nameSource === "krak" ? (
                        <SourceTag
                          label={tKrak("source")}
                          title={tKrak("sourceKrak")}
                        />
                      ) : null}
                    </div>
                  ) : !hasAnyContact ? (
                    <EnrichStatus
                      companyId={row.id}
                      status={row.cvr_enrichment_status}
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
