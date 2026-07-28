/**
 * Curated CVR (DB07) industry groups worth blocking in one click.
 *
 * blocked_industries stores one row per code, so a preset expands into several
 * rows sharing a label. That's why the table is keyed on the code and not the
 * label — "staffing agencies" is three distinct codes.
 */
export type IndustryPreset = {
  id: string;
  /** Label stored on every row the preset creates. */
  label: string;
  codes: number[];
};

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: "staffing",
    label: "Vikarbureauer og personaleformidling",
    codes: [
      781000, // Arbejdsformidlingskontorer
      782000, // Vikarbureauer
      783000, // Anden personaleformidling
    ],
  },
];
