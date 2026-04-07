import { USER_PROFILE } from "./userProfile.ts";
import { enhanceSurveyPrompt } from "./surveyEngine.ts";
import { processScreenshot } from "./visionProcessor.ts";

import { callAI } from "./failover.ts";

function detectTaskType(task: string): "survey" | "navigation" {
  const lower = task.toLowerCase();
  if (lower.includes("survey") || lower.includes("question") || lower.includes("form")) {
    return "survey";
  }
  return "navigation";
}

// 🧠 MODEL SWITCH (HYBRID MODE) - Now handled by failover.ts
export function selectModel(task: string) {
  return detectTaskType(task) === "survey" ? "mistral:instruct" : "llama3.2";
}

// 🔴 RED AGENT (ACTIONS/SURVEY)
export async function runRedAgent(task: string, dom: string, imageBase64?: string, mode: "auto" | "openrouter" | "sambanova" | "mistral" = "auto", useCache: boolean = true, plan?: string[], apiKey?: string, blackAgentApiKey?: string) {
  const trimmedDOM = dom.substring(0, 2000); // Token trimming for speed
  
  if (trimmedDOM.length < 50 && !imageBase64) {
    return { useVision: true };
  }

  const taskType = detectTaskType(task);
  
  let visionContext = "";
  if (imageBase64) {
    const buffer = Buffer.from(imageBase64.split(",")[1] || imageBase64, 'base64');
    const processedVision = await processScreenshot(buffer);
    visionContext = `\nVISION_DATA:${processedVision}\nUse this to detect buttons not visible in DOM, identify sliders, stars, grids, and understand layout like a human. If DOM fails, rely on vision.`;
  }

  let systemPrompt = `You are the primary execution agent (RED AGENT) responsible for completing web-based tasks.

User Profile: ${JSON.stringify(USER_PROFILE)}

Behavior:
- Act step-by-step
- Use structured actions only
- Be fast and efficient
- Do not over-explain
- Observe → decide → act

Rules:
- Always return JSON actions
- Never return plain text
- Prefer stable selectors (text, labels, inputs)
- Retry once if an action fails
- If still failing, return { "error": "FAILED_STEP" }

Survey Handling:
- Answer all required questions
- Never leave required fields empty
- Use consistent profile-based responses
- Avoid extreme or unrealistic answers
- Prefer moderate answers (not extremes unless needed)

Goal:
Complete the task accurately and efficiently using the best available actions.

Available Actions:
- click(target): buttons, options
- type(target, text): input fields
- select(target, value): dropdowns
- scroll(direction): reveal hidden content

Targeting priority:
1. Exact text match
2. Button/label text
3. Input name/placeholder
4. Role-based elements
5. Fallback: broader selector

Response Format (CRITICAL):
{
  "actions": [
    { "type": "click", "target": "button:has-text('Start')" },
    { "type": "type", "target": "input[name='email']", "text": "test@example.com" }
  ]
}
`;
  
  if (plan && plan.length > 0) {
    systemPrompt += `\n\nFollow this plan exactly:
${JSON.stringify(plan)}`;
  } else if (taskType === "survey") {
    systemPrompt += `\n\nSURVEY MODE ACTIVE:
${enhanceSurveyPrompt(trimmedDOM)}`;
  } else {
    systemPrompt += `\n\nTask: ${task}\nDOM: ${trimmedDOM}`;
  }

  systemPrompt += visionContext;

  const output = await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task }
    ],
    taskType,
    agentType: "red",
    mode,
    useCache,
    task,
    apiKey,
    blackAgentApiKey
  });

  try {
    return JSON.parse(output);
  } catch {
    return { useVision: true, raw: output };
  }
}

// 👁️ VISION AGENT (FALLBACK)
export async function runVisionAgent(task: string, imageBase64: string, mode: "auto" | "openrouter" | "sambanova" | "mistral" = "auto", apiKey?: string, blackAgentApiKey?: string) {
  console.log("👁️ Vision Agent processing task:", task);
  
  const systemPrompt = `
You are a planning agent with vision capabilities.

You can see a screenshot of the page.

Your job:
- Identify UI elements visually
- Understand layout (buttons, inputs, surveys)
- Plan steps based on what is visible

If selectors fail:
- Analyze the screenshot
- Identify the correct clickable element visually
- Return coordinates (x, y)
- Prefer visible labels like "Next", "Submit", "Yes"

Return JSON actions:
{
  "actions": [
    { "type": "click", "x": number, "y": number }
  ]
}
`;

  const output = await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task }
    ],
    taskType: "navigation",
    agentType: "black", // Use Black Agent's failover for vision
    mode,
    useCache: false,
    task,
    image: imageBase64,
    apiKey,
    blackAgentApiKey
  });

  try {
    return JSON.parse(output);
  } catch {
    return { actions: [{ type: "click", text: "Next" }], raw: output };
  }
}

// 🔵 BLUE AGENT (PLANNING)
export async function runBlueAgent(task: string, dom: string, imageBase64?: string, mode: "auto" | "openrouter" | "sambanova" | "mistral" = "auto", useCache: boolean = true, apiKey?: string, blackAgentApiKey?: string) {
  const trimmedDOM = dom.substring(0, 2000);
  const taskType = detectTaskType(task);

  let visionContext = "";
  if (imageBase64) {
    const buffer = Buffer.from(imageBase64.split(",")[1] || imageBase64, 'base64');
    const processedVision = await processScreenshot(buffer);
    visionContext = `\nVISION_DATA:${processedVision}\nYou can see a screenshot of the page. Identify UI elements visually and understand layout (buttons, inputs, surveys). Plan steps based on what is visible.`;
  }

  const systemPrompt = `
You are the reasoning and planning agent (BLUE AGENT) with vision capabilities.

Your role is to analyze tasks and generate clear step-by-step plans for execution.

Rules:
- Do not execute actions
- Do not return raw instructions
- Always return a structured plan in JSON format
- Be precise and logical
- Consider tricky UI (hidden buttons, sliders, grids)

Behavior:
- Break tasks into steps
- Identify potential issues
- Ensure clarity for execution agents
- Avoid ambiguity

Survey Handling:
- Identify question types (Multiple choice, Grid/matrix, Slider, Star rating)
- Plan how each should be answered
- Ensure all required fields are completed

User Profile for context:
${JSON.stringify(USER_PROFILE)}

Goal:
Produce a clear, efficient execution plan that can be followed without errors.

Return JSON:
{
  "plan": [
    "Step 1...",
    "Step 2..."
  ]
}

DOM:
${trimmedDOM}
${visionContext}
Task:
${task}
`;

  const output = await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task }
    ],
    taskType,
    agentType: "blue",
    mode,
    useCache,
    task,
    image: imageBase64,
    apiKey,
    blackAgentApiKey
  });

  try {
    return JSON.parse(output);
  } catch {
    return { plan: [], raw: output };
  }
}

// ⚫ BLACK AGENT (VERIFICATION/COMPLEX REASONING)
export async function runBlackAgent(task: string, dom: string, mode: "auto" | "openrouter" | "sambanova" | "mistral" = "auto", useCache: boolean = true, apiKey?: string, blackAgentApiKey?: string) {
  const trimmedDOM = dom.substring(0, 2000);
  
  const systemPrompt = `
You are a verification AI (BLACK AGENT).
Your goal is to verify if the previous action was successful or if the current state matches the user's intent.

Return JSON:
{
  "verified": true,
  "confidence": 0.9,
  "issue": null
}

DOM:
${trimmedDOM}
Task:
${task}
`;

  const output = await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task }
    ],
    taskType: "verification",
    agentType: "black",
    mode,
    useCache,
    task,
    apiKey,
    blackAgentApiKey
  });

  try {
    return JSON.parse(output);
  } catch {
    return { verified: true, raw: output };
  }
}

// 🔍 VALIDATION AGENT (BLUE CHECKS RED)
export async function validateExecution(task: string, plan: string[], result: any, mode: "auto" | "openrouter" | "sambanova" | "mistral" = "auto", apiKey?: string, blackAgentApiKey?: string) {
  const systemPrompt = `
You are a validation agent (BLUE AGENT).

Check if the execution result matches the plan and the user's task.

Return JSON:
{ "valid": true, "reason": "..." }
`;

  const userPrompt = `
TASK:
${task}

PLAN:
${JSON.stringify(plan)}

RESULT:
${JSON.stringify(result)}
`;

  const output = await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    taskType: "verification",
    agentType: "blue",
    mode,
    useCache: false,
    task,
    apiKey,
    blackAgentApiKey
  });

  try {
    return JSON.parse(output);
  } catch {
    return { valid: true, reason: "Fallback validation" };
  }
}
