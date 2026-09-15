export type Check = {
  id: string;
  category:
    | "correctness"
    | "budget"
    | "performance"
    | "visual"
    | "a11y"
    | "network"
    | "data";
  status: "pass" | "fail" | "skip" | "quarantined";
  metric: number;
  unit: string;
  threshold: number;
  comparator: "lte" | "gte" | "eq";
  message: string;
  baseline?: number;
  delta?: number;
  spread?: number;
  unstable?: boolean;
};
