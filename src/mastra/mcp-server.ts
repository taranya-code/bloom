/** MCP server exposing the stateful Bloom stores as standardized tools.
 * Agents access medication + appointment state exclusively through MCP,
 * per the evaluation recommendation on tool standardization. */
import { MCPServer } from "@mastra/mcp";
import {
  setSchedule,
  updateMedication,
  getDueMedications,
  markMedicationTaken,
  addFollowup,
  listFollowups,
  markFollowupDone,
} from "./tools";

export const bloomToolsServer = new MCPServer({
  name: "bloom-tools",
  version: "1.0.0",
  description:
    "Standardized MCP access to Bloom's medication schedule and follow-up appointment stores (Firestore-backed).",
  tools: {
    setSchedule,
    updateMedication,
    getDueMedications,
    markMedicationTaken,
    addFollowup,
    listFollowups,
    markFollowupDone,
  },
});

/** Run standalone over stdio:  npx tsx src/mastra/mcp-server.ts */
if (process.argv[1]?.includes("mcp-server")) {
  bloomToolsServer.startStdio().catch((e) => {
    console.error("MCP server failed:", e);
    process.exit(1);
  });
}
