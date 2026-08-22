import { createResetJudgeRunsHandler } from "@/lib/judge-runner-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const POST = createResetJudgeRunsHandler();
