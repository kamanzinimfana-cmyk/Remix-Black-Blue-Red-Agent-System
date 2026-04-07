import { getSmartCache, setSmartCache, shouldCache } from "./cache.ts";
import { buildProfileContext } from "./brain/profilePrompt.ts";
import { getDirectAnswer } from "./brain/answerOverrides.ts";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const BLACK_AGENT_MISTRAL_API_KEY = process.env.BLACK_AGENT_MISTRAL_API_KEY || MISTRAL_API_KEY;
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const APP_URL = process.env.APP_URL || "https://ai.studio/build";

// BLUE, RED & BLACK AGENT IDs provided by user
const BLUE_AGENT_ID = "ag_019d3f32fc3576c6a94b8b8e033c700f";
const RED_AGENT_ID = "ag_019d3f38dfd2721cb947ec4597d6eaa8";
const BLACK_AGENT_ID = "ag_019d6450099d70daa2f1461c627e4ffe";

interface Message {
  role: string;
  content: string;
}

interface CallAIParams {
  messages: Message[];
  taskType: "survey" | "navigation" | "verification";
  agentType: "blue" | "red" | "black";
  mode?: "auto" | "openrouter" | "sambanova" | "mistral";
  useCache?: boolean;
  task: string;
  image?: string;
  apiKey?: string;
  blackAgentApiKey?: string;
}

async function callMistralAgent(messages: Message[], agentType: "blue" | "red" | "black", overrideApiKey?: string) {
  const apiKey = overrideApiKey || (agentType === "black" ? BLACK_AGENT_MISTRAL_API_KEY : MISTRAL_API_KEY);

  if (!apiKey) {
    throw new Error(`${agentType === "black" ? "BLACK_AGENT_MISTRAL_API_KEY" : "MISTRAL_API_KEY"} missing`);
  }

  let agentId: string;
  let agentName: string;
  let version = 2;

  if (agentType === "blue") {
    agentId = BLUE_AGENT_ID;
    agentName = "Blue Agent";
  } else if (agentType === "red") {
    agentId = RED_AGENT_ID;
    agentName = "Red Agent";
  } else {
    agentId = BLACK_AGENT_ID;
    agentName = "Black Agent";
    version = 3; // Black agent is version 3 per user request
  }

  console.log(`🧠 Calling ${agentName} (Mistral ID: ${agentId})...`);
  const res = await fetch("https://api.mistral.ai/v1/conversations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agent_id: agentId,
      agent_version: version,
      inputs: messages
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Mistral Agent failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const output = data.choices?.[0]?.message?.content || data.response || JSON.stringify(data);

  console.log(`✅ ${agentName} success`);
  return output;
}

async function callOpenRouter(messages: Message[]) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  console.log("🧠 Trying OpenRouter Cloud...");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Title": "Blue Red Agent",
    },
    body: JSON.stringify({
      model: "nousresearch/hermes-3-llama-3.1-405b:free",
      messages
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const output = data.choices?.[0]?.message?.content;

  if (!output) {
    throw new Error("Empty OpenRouter response");
  }

  console.log("✅ OpenRouter success");
  return output;
}

async function callSambaNova(messages: Message[], taskType: string) {
  if (!SAMBANOVA_API_KEY) {
    throw new Error("SAMBANOVA_API_KEY missing");
  }

  // Use specific models requested by user
  const model = taskType === "navigation" ? "gpt-oss-120b" : "Meta-Llama-3.1-8B-Instruct";
  console.log(`🧠 Trying SambaNova Cloud (${model})...`);
  
  const res = await fetch("https://api.sambanova.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SAMBANOVA_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      top_p: 0.1
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`SambaNova failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const output = data.choices?.[0]?.message?.content;

  if (!output) {
    throw new Error("Empty SambaNova response");
  }

  console.log("✅ SambaNova success");
  return output;
}

export async function callVision(messages: Message[], image: string) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing for vision");
  }

  console.log("👁️ Calling Vision Model (OpenRouter)...");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Title": "Vision Agent",
    },
    body: JSON.stringify({
      model: "google/gemini-flash-1.5-8b", // Fast and cheap vision model
      messages: [
        ...messages.map(m => ({
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` } }
          ]
        }))
      ]
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Vision failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

export async function callAI({ messages, taskType, agentType, mode = "auto", useCache = true, task, image, apiKey, blackAgentApiKey }: CallAIParams) {
  // ✅ 1. CHECK DIRECT OVERRIDES (Demographics)
  if (taskType === "survey") {
    const direct = getDirectAnswer(task);
    if (direct) {
      console.log("⚡ Direct profile answer used:", direct);
      return direct;
    }
  }

  // ✅ 2. CHECK SMART CACHE FIRST
  if (useCache && shouldCache(taskType)) {
    const cached = await getSmartCache(messages, task);
    if (cached) {
      return cached;
    }
  }

  // ✅ 3. INJECT PROFILE CONTEXT
  const profileContext = buildProfileContext();
  const enhancedMessages = [
    { role: "system", content: profileContext },
    ...messages
  ];

  let output: string;

  if (image) {
    output = await callVision(enhancedMessages, image);
  } else if (mode === "sambanova") {
    output = await callSambaNova(enhancedMessages, taskType);
  } else if (mode === "openrouter") {
    output = await callOpenRouter(enhancedMessages);
  } else if (mode === "mistral") {
    output = await callMistralAgent(enhancedMessages, agentType, agentType === "black" ? blackAgentApiKey : apiKey);
  } else {
    // Auto / Failover mode based on Agent Type
    if (agentType === "blue") {
      // Blue Agent Chain: Mistral Blue -> Mistral Black -> OpenRouter -> SambaNova
      try {
        output = await callMistralAgent(enhancedMessages, "blue", apiKey);
      } catch (err) {
        console.log("⚠️ Blue Agent (Mistral) failed → switching to Black Agent...", err instanceof Error ? err.message : String(err));
        try {
          output = await callMistralAgent(enhancedMessages, "black", blackAgentApiKey);
        } catch (err2) {
          console.log("⚠️ Black Agent failed → switching to OpenRouter...", err2 instanceof Error ? err2.message : String(err2));
          try {
            output = await callOpenRouter(enhancedMessages);
          } catch (err3) {
            console.log("⚠️ OpenRouter failed → switching to SambaNova Cloud...", err3 instanceof Error ? err3.message : String(err3));
            output = await callSambaNova(enhancedMessages, taskType);
          }
        }
      }
    } else if (agentType === "red") {
      // Red Agent Chain: Mistral Red -> Mistral Black -> SambaNova
      try {
        output = await callMistralAgent(enhancedMessages, "red", apiKey);
      } catch (err) {
        console.log("⚠️ Red Agent (Mistral) failed → switching to Black Agent...", err instanceof Error ? err.message : String(err));
        try {
          output = await callMistralAgent(enhancedMessages, "black", blackAgentApiKey);
        } catch (err2) {
          console.log("⚠️ Black Agent failed → switching to SambaNova Cloud...", err2 instanceof Error ? err2.message : String(err2));
          output = await callSambaNova(enhancedMessages, taskType);
        }
      }
    } else {
      // Black Agent Chain: Mistral Black -> OpenRouter (Hermes 405B) -> SambaNova
      try {
        output = await callMistralAgent(enhancedMessages, "black", blackAgentApiKey);
      } catch (err) {
        console.log("⚠️ Black Agent (Mistral) failed → switching to OpenRouter...", err instanceof Error ? err.message : String(err));
        try {
          output = await callOpenRouter(enhancedMessages);
        } catch (err2) {
          console.log("⚠️ OpenRouter failed → switching to SambaNova Cloud...", err2 instanceof Error ? err2.message : String(err2));
          output = await callSambaNova(enhancedMessages, taskType);
        }
      }
    }
  }

  // ✅ 4. SAVE TO SMART CACHE
  if (useCache && shouldCache(taskType) && output) {
    await setSmartCache(messages, task, output);
  }

  return output;
}
