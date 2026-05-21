export type PlanTier = "free" | "pro" | "enterprise";

export type PlanLimits = {
  leadViewsPerMonth: number | "unlimited";
  savedFilters: number | "unlimited";
  alerts: boolean;
  apiAccess: boolean;
};

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    leadViewsPerMonth: 25,
    savedFilters: 1,
    alerts: false,
    apiAccess: false,
  },
  pro: {
    leadViewsPerMonth: "unlimited",
    savedFilters: "unlimited",
    alerts: true,
    apiAccess: false,
  },
  enterprise: {
    leadViewsPerMonth: "unlimited",
    savedFilters: "unlimited",
    alerts: true,
    apiAccess: true,
  },
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};
