import { runBlueAgent, runRedAgent, runVisionAgent, validateExecution } from "./agents.ts";

export interface OrchestratorContext {
  dom: string;
  imageBase64?: string;
  aiMode: "auto" | "openrouter" | "sambanova" | "mistral";
  useCache: boolean;
  apiKey?: string;
  blackAgentApiKey?: string;
}

export async function runOrchestratedTask(task: string, context: OrchestratorContext) {
  try {
    console.log("🧠 [ORCHESTRATOR] STEP 1: BLUE creates plan...");
    const blueResponse = await runBlueAgent(
      task, 
      context.dom, 
      context.imageBase64, 
      context.aiMode, 
      context.useCache,
      context.apiKey,
      context.blackAgentApiKey
    );

    const plan = blueResponse.plan || [];
    console.log("🧠 [ORCHESTRATOR] Plan generated:", plan);

    if (plan.length === 0) {
      console.log("⚠️ [ORCHESTRATOR] No plan generated, falling back to direct execution...");
      return await runRedAgent(task, context.dom, context.imageBase64, context.aiMode, context.useCache, undefined, context.apiKey, context.blackAgentApiKey);
    }

    // 🔴 STEP 2: RED executes plan
    console.log("🔴 [ORCHESTRATOR] STEP 2: RED executes plan...");
    const redResult = await runRedAgent(
      task, 
      context.dom, 
      context.imageBase64, 
      context.aiMode, 
      context.useCache, 
      plan,
      context.apiKey,
      context.blackAgentApiKey
    );

    console.log("🔴 [ORCHESTRATOR] Execution result:", redResult);

    // 🧠 STEP 3: VALIDATION
    console.log("🧠 [ORCHESTRATOR] STEP 3: BLUE validates execution...");
    const validation = await validateExecution(task, plan, redResult, context.aiMode, context.apiKey, context.blackAgentApiKey);

    if (validation.valid) {
      console.log("✅ [ORCHESTRATOR] Validation passed!");
      return redResult;
    }

    console.log("⚠️ [ORCHESTRATOR] Validation failed:", validation.reason);
    console.log("👁️ [ORCHESTRATOR] STEP 4: FALLBACK to Vision...");

    // 🔥 STEP 4: FALLBACK
    if (context.imageBase64) {
      return await runVisionAgent(task, context.imageBase64, context.aiMode, context.apiKey, context.blackAgentApiKey);
    } else {
      return redResult; // Return original result if no image for fallback
    }

  } catch (err) {
    console.error("🔥 [ORCHESTRATOR] System error:", err);
    if (context.imageBase64) {
      return await runVisionAgent(task, context.imageBase64, context.aiMode, context.apiKey, context.blackAgentApiKey);
    }
    throw err;
  }
}
