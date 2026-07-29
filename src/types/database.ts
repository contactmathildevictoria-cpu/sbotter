// Hand-written until the project is linked to a live Supabase project, at which
// point we replace this with the output of:
//   supabase gen types typescript --linked > src/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PlanTier = "free" | "pro" | "enterprise";

export type CvrEnrichmentStatus =
  | "pending"
  | "enriched"
  | "failed"
  | "no_match"
  | "skipped";

export type KrakEnrichmentStatus =
  | "pending"
  | "queued"
  | "enriched"
  | "failed"
  | "no_match"
  | "skipped";

export type AiEnrichmentStatus =
  | "pending"
  | "enriched"
  | "no_match"
  | "failed"
  | "skipped";

export type LeadStatus =
  | "new"
  | "contacted"
  | "no_pickup"
  | "meeting"
  | "won"
  | "lost";

/** Which tier of the daily-list engine put a lead on the board. */
export type LeadOrigin = "fresh" | "recycled" | "fill";

export type WebsiteScrapeStatus =
  | "pending"
  | "scraped"
  | "failed"
  | "no_website"
  | "skipped";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          plan: PlanTier;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          plan?: PlanTier;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          plan?: PlanTier;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      data_sources: {
        Row: {
          id: string;
          name: string;
          base_url: string;
          country: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          base_url: string;
          country: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          base_url?: string;
          country?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          name: string;
          slug: string;
          website: string | null;
          domain: string | null;
          cvr: string | null;
          location_city: string | null;
          location_region: string | null;
          country: string | null;
          industry: string | null;
          size_bucket: string | null;
          description: string | null;
          first_seen_at: string;
          last_seen_at: string;
          open_jobs_count: number;
          enrichment: Json | null;
          phone: string | null;
          email: string | null;
          contact_person_name: string | null;
          cvr_industry_code: number | null;
          cvr_industry_text: string | null;
          cvr_company_type: string | null;
          is_ad_protected: boolean;
          is_bankrupt: boolean;
          cvr_enriched_at: string | null;
          cvr_enrichment_status: CvrEnrichmentStatus;
          krak_phone: string | null;
          krak_contact_person: string | null;
          krak_contact_title: string | null;
          krak_url: string | null;
          krak_enriched_at: string | null;
          krak_enrichment_status: KrakEnrichmentStatus;
          website_phone: string | null;
          website_email: string | null;
          website_contact_person: string | null;
          website_contact_title: string | null;
          website_scraped_at: string | null;
          website_scrape_status: WebsiteScrapeStatus;
          ai_phone: string | null;
          ai_contact_person: string | null;
          ai_source_url: string | null;
          ai_enriched_at: string | null;
          ai_enrichment_status: AiEnrichmentStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          website?: string | null;
          domain?: string | null;
          cvr?: string | null;
          location_city?: string | null;
          location_region?: string | null;
          country?: string | null;
          industry?: string | null;
          size_bucket?: string | null;
          description?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
          open_jobs_count?: number;
          enrichment?: Json | null;
          phone?: string | null;
          email?: string | null;
          contact_person_name?: string | null;
          cvr_industry_code?: number | null;
          cvr_industry_text?: string | null;
          cvr_company_type?: string | null;
          is_ad_protected?: boolean;
          is_bankrupt?: boolean;
          cvr_enriched_at?: string | null;
          cvr_enrichment_status?: CvrEnrichmentStatus;
          krak_phone?: string | null;
          krak_contact_person?: string | null;
          krak_contact_title?: string | null;
          krak_url?: string | null;
          krak_enriched_at?: string | null;
          krak_enrichment_status?: KrakEnrichmentStatus;
          website_phone?: string | null;
          website_email?: string | null;
          website_contact_person?: string | null;
          website_contact_title?: string | null;
          website_scraped_at?: string | null;
          website_scrape_status?: WebsiteScrapeStatus;
          ai_phone?: string | null;
          ai_contact_person?: string | null;
          ai_source_url?: string | null;
          ai_enriched_at?: string | null;
          ai_enrichment_status?: AiEnrichmentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          website?: string | null;
          domain?: string | null;
          cvr?: string | null;
          location_city?: string | null;
          location_region?: string | null;
          country?: string | null;
          industry?: string | null;
          size_bucket?: string | null;
          description?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
          open_jobs_count?: number;
          enrichment?: Json | null;
          phone?: string | null;
          email?: string | null;
          contact_person_name?: string | null;
          cvr_industry_code?: number | null;
          cvr_industry_text?: string | null;
          cvr_company_type?: string | null;
          is_ad_protected?: boolean;
          is_bankrupt?: boolean;
          cvr_enriched_at?: string | null;
          cvr_enrichment_status?: CvrEnrichmentStatus;
          krak_phone?: string | null;
          krak_contact_person?: string | null;
          krak_contact_title?: string | null;
          krak_url?: string | null;
          krak_enriched_at?: string | null;
          krak_enrichment_status?: KrakEnrichmentStatus;
          website_phone?: string | null;
          website_email?: string | null;
          website_contact_person?: string | null;
          website_contact_title?: string | null;
          website_scraped_at?: string | null;
          website_scrape_status?: WebsiteScrapeStatus;
          ai_phone?: string | null;
          ai_contact_person?: string | null;
          ai_source_url?: string | null;
          ai_enriched_at?: string | null;
          ai_enrichment_status?: AiEnrichmentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      job_postings: {
        Row: {
          id: string;
          company_id: string;
          source_id: string;
          external_id: string;
          title: string;
          description: string | null;
          category: string | null;
          location_city: string | null;
          location_region: string | null;
          country: string | null;
          url: string;
          posted_at: string | null;
          expires_at: string | null;
          is_active: boolean;
          raw: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          source_id: string;
          external_id: string;
          title: string;
          description?: string | null;
          category?: string | null;
          location_city?: string | null;
          location_region?: string | null;
          country?: string | null;
          url: string;
          posted_at?: string | null;
          expires_at?: string | null;
          is_active?: boolean;
          raw?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          source_id?: string;
          external_id?: string;
          title?: string;
          description?: string | null;
          category?: string | null;
          location_city?: string | null;
          location_region?: string | null;
          country?: string | null;
          url?: string;
          posted_at?: string | null;
          expires_at?: string | null;
          is_active?: boolean;
          raw?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_postings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_postings_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "data_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      scrape_runs: {
        Row: {
          id: string;
          source_id: string;
          apify_run_id: string | null;
          apify_actor_id: string | null;
          status: string;
          items_received: number;
          companies_upserted: number;
          jobs_upserted: number;
          started_at: string;
          finished_at: string | null;
          error: Json | null;
        };
        Insert: {
          id?: string;
          source_id: string;
          apify_run_id?: string | null;
          apify_actor_id?: string | null;
          status: string;
          items_received?: number;
          companies_upserted?: number;
          jobs_upserted?: number;
          started_at?: string;
          finished_at?: string | null;
          error?: Json | null;
        };
        Update: {
          id?: string;
          source_id?: string;
          apify_run_id?: string | null;
          apify_actor_id?: string | null;
          status?: string;
          items_received?: number;
          companies_upserted?: number;
          jobs_upserted?: number;
          started_at?: string;
          finished_at?: string | null;
          error?: Json | null;
        };
        Relationships: [];
      };
      saved_filters: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          view: "companies" | "jobs";
          filters: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          view: "companies" | "jobs";
          filters: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          view?: "companies" | "jobs";
          filters?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      list_preferences: {
        Row: {
          user_id: string;
          daily_target: number;
          trash_max: number;
          follow_up_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          daily_target?: number;
          trash_max?: number;
          follow_up_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          daily_target?: number;
          trash_max?: number;
          follow_up_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lead_assignments: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          job_posting_id: string | null;
          list_date: string;
          origin: LeadOrigin;
          status: LeadStatus;
          rating: number | null;
          note: string | null;
          follow_up_at: string | null;
          in_trash: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          company_id: string;
          job_posting_id?: string | null;
          list_date?: string;
          origin?: LeadOrigin;
          status?: LeadStatus;
          rating?: number | null;
          note?: string | null;
          follow_up_at?: string | null;
          in_trash?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          company_id?: string;
          job_posting_id?: string | null;
          list_date?: string;
          origin?: LeadOrigin;
          status?: LeadStatus;
          rating?: number | null;
          note?: string | null;
          follow_up_at?: string | null;
          in_trash?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_assignments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_assignments_job_posting_id_fkey";
            columns: ["job_posting_id"];
            isOneToOne: false;
            referencedRelation: "job_postings";
            referencedColumns: ["id"];
          },
        ];
      };
      excluded_companies: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          name_normalized: string;
          cvr: string | null;
          domain: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          name_normalized: string;
          cvr?: string | null;
          domain?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          name_normalized?: string;
          cvr?: string | null;
          domain?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      blocked_industries: {
        Row: {
          user_id: string;
          industry_code: number;
          industry_label: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          industry_code: number;
          industry_label: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          industry_code?: number;
          industry_label?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      plan_tier: PlanTier;
      lead_status: LeadStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
