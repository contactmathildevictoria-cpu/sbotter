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
            // Per-field fallback cascade: CVR is preferred, then Krak (CVR
            // columns are never overwritten, so a fallback only shows when the
            // CVR field is empty). A website_* stage (PR #6, not on this branch)
            // would slot in between CVR and Krak once those columns exist.
            const phone = row.phone ?? row.krak_phone;
            const email = row.email; // only CVR carries an email on this branch
            const contactName =
              row.contact_person_name ?? row.krak_contact_person;
            // CVR has no title column; Krak does. Only show the Krak title when
            // the name itself came from Krak (i.e. CVR had no contact person).
            const contactTitle = row.contact_person_name
              ? null
              : row.krak_contact_title;
            const phoneFromKrak = !row.phone && Boolean(row.krak_phone);
            const nameFromKrak =
              !row.contact_person_name && Boolean(row.krak_contact_person);
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
                      {phoneFromKrak ? (
                        <span
                          title={tKrak("sourceKrak")}
                          className="text-muted-foreground text-[10px] uppercase"
                        >
                          {tKrak("source")}
                        </span>
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
                      {nameFromKrak ? (
                        <span
                          title={tKrak("sourceKrak")}
                          className="text-muted-foreground text-[10px] uppercase"
                        >
                          {tKrak("source")}
                        </span>
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
