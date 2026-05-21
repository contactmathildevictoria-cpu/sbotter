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
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      plan_tier: PlanTier;
    };
    CompositeTypes: Record<never, never>;
  };
};
