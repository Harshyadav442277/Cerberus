import { createJudgeReadinessHandler } from "@/lib/judge-readiness-route";

export const dynamic = "force-dynamic";
export const GET = createJudgeReadinessHandler();
