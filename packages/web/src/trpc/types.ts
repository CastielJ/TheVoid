import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@void/server";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type Task = RouterOutputs["task"]["get"];
export type Group = RouterOutputs["group"]["list"][number];
export type VoidCamera = RouterOutputs["void"]["getCamera"];
export type Tag = RouterOutputs["tag"]["list"][number];
export type EligibleMember = RouterOutputs["void"]["listEligibleMembers"][number];
