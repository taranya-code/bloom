import { Agent } from "@mastra/core/agent";
import { chatModel } from "./provider";
import * as P from "./prompts";
import {
  setSchedule,
  updateMedication,
  getDueMedications,
  markMedicationTaken,
  addFollowup,
  listFollowups,
  markFollowupDone,
  storeDischargeContext,
  searchDischargeContext,
  runSafetyCheck,
  ingestOfflineParse,
} from "./tools";

const MODEL = chatModel;

export const parserAgent = new Agent({
  id: "parserAgent",
  name: "Parser Agent",
  description:
    "Extracts structured JSON from a discharge summary photo or text; stores chunks in Qdrant.",
  instructions: P.PARSER,
  model: MODEL,
  tools: { storeDischargeContext },
});

export const explainerAgent = new Agent({
  id: "explainerAgent",
  name: "Explainer Agent",
  description: "Explains the parsed discharge summary in the family's language, spoken-style.",
  instructions: P.EXPLAINER,
  model: MODEL,
  tools: { searchDischargeContext },
});

export const medicationAgent = new Agent({
  id: "medicationAgent",
  name: "Medication Agent",
  description: "Manages the medicine schedule: reminders data, changes, what-is-due-now.",
  instructions: P.MEDICATION,
  model: MODEL,
  tools: {
    setSchedule,
    updateMedication,
    getDueMedications,
    markMedicationTaken,
    searchDischargeContext,
  },
});

export const followupAgent = new Agent({
  id: "followupAgent",
  name: "Follow-up Agent",
  description: "Tracks review appointments and nudges before they are missed.",
  instructions: P.FOLLOWUP,
  model: MODEL,
  tools: { addFollowup, listFollowups, markFollowupDone, searchDischargeContext },
});

export const redflagAgent = new Agent({
  id: "redflagAgent",
  name: "Red-Flag Agent",
  description:
    "Answers 'is this symptom normal?' grounded strictly in the discharge note, guarded by Enkrypt.",
  instructions: P.REDFLAG,
  model: MODEL,
  tools: { searchDischargeContext, runSafetyCheck },
});

export const bloom = new Agent({
  id: "bloom",
  name: "Bloom",
  description: "Warm vernacular post-discharge companion coordinating specialist agents.",
  instructions: P.COORDINATOR,
  model: MODEL,
  agents: { parserAgent, explainerAgent, medicationAgent, followupAgent, redflagAgent },
  // NFR-7.1: offline/on-device fallback ingestion (Gemma 3n client-side parse -> server contract).
  tools: { ingestOfflineParse },
});
