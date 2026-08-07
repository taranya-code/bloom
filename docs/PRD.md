# Product Requirements Document (PRD): Bloom Post-Treatment Care Companion

**Version:** 1.0  
**Status:** Production-Ready / IEEE 830 Compliant  
**Role:** Senior Solutions Architect & Requirements Engineer

---

## 1. Executive Summary

Bloom is a multi-agent, post-treatment care companion designed to support family caregivers. It simplifies hospital discharge summaries, manages medication schedules, tracks follow-up appointments, and provides symptom triage. The system's core mandate is **clinical safety through deterministic grounding**: every answer must be derived strictly from the patient’s specific discharge note with verifiable citations, eliminating general medical hallucinations.

---

## 2. Problem Statement

Family caregivers often struggle to interpret complex hospital discharge papers, leading to medication errors, missed follow-up appointments, and delayed recognition of "red-flag" symptoms. Existing AI solutions often hallucinate medical advice, posing a significant patient safety risk. Bloom solves this by providing a zero-trust, grounded, and human-verified care path.

---

## 3. Goals & Objectives

- **Zero Hallucination:** 100% of clinical advice must be grounded in the provided discharge summary.
- **Safety First:** Deterministic triage with a hardened human-in-the-loop (HITL) safety net.
- **Reliability:** Seamless offline-to-online synchronization for caregivers in low-connectivity environments.
- **Traceability:** Full audit trail from requirement to code, and from AI response to source text.

---

## 4. Target Users / Stakeholders

- **Family Caregivers:** Primary users managing patient care.
- **Discharged Patients:** Beneficiaries of accurate care guidance.
- **Clinical On-Call Staff:** Professionals providing the HITL safety net for high-risk triage.
- **Technical Administrators:** PMs and Architects ensuring system integrity and compliance.

---

## 5. Functional Requirements (FR)

| ID         | Requirement Description                                                                   | Acceptance Criteria                                                                                          |
| :--------- | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **FR-1.1** | **Multimodal Ingestion:** Support photo (JPEG/PNG), PDF, and text paste.                  | Gemini 2.5 Flash extracts 100% of medication names/dosages from a standard test set without client-side OCR. |
| **FR-2.1** | **Multilingual Support:** Interaction in English, Kannada, Tamil, and Hindi.              | 95% accuracy in intent recognition across all four languages in localized test suites.                       |
| **FR-3.1** | **Grounded Reasoning:** All clinical answers must use Qdrant-retrieved context.           | System rejects queries not answerable by the discharge note with a "Not in source" message.                  |
| **FR-3.2** | **Clinical Citations:** Every Explainer/Red-Flag reply must return specific source lines. | 0% fabricated citations; every citation must map to a verbatim line in the original discharge text.          |
| **FR-4.1** | **Medication Management:** Track dose-taken status and schedules via MCP tools.           | 100% success rate in `mark_medication_taken` tool calls reflected in Firestore state.                        |
| **FR-5.1** | **Deterministic Triage:** Three branches: RF-1 (Escalate), RF-2 (Reassure), RF-3 (Refer). | Zero false negatives on RF-1 (Escalate) triggers in the safety test battery.                                 |
| **FR-5.5** | **HITL Escalation:** Parallel webhook trigger for RF-1/RF-3 verdicts.                     | Webhook POST contains `session_id` and `triage_rule_id` within 500ms of AI response.                         |
| **FR-7.3** | **Offline Fallback:** Gemma 3n on-device inference for basic triage when offline.         | Local queue persists up to 5 attempts with exponential backoff (1s to 60s cap).                              |
| **FR-7.4** | **Conflict Resolution:** Multi-device sync via "freshest capture wins" logic.             | If Device A (T1) and Device B (T2 > T1) sync, T2's data is kept; T1 is logged as a conflict.                 |
| **FR-8.1** | **AI Disclosure:** Mandatory disclosure before clinical content.                          | Disclosure appears once per session; user must acknowledge before chat proceeds.                             |

---

## 6. Non-Functional Requirements (NFR)

| ID          | Category           | Requirement Description                        | Acceptance Criteria                                                                        |
| :---------- | :----------------- | :--------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **NFR-3.2** | **Resilience**     | Multi-region Firestore and Qdrant replication. | Qdrant replication factor >1; Firestore configured for multi-region (e.g., `nam5`).        |
| **NFR-6.1** | **Audit**          | Log triage justifications and conflict events. | BigQuery contains structured logs for every triage event including `device_id`.            |
| **NFR-6.2** | **HITL SLA**       | Human acknowledgment target for escalations.   | 15-minute human-acknowledgment target tracked in BigQuery audit logs.                      |
| **NFR-6.3** | **HITL DLQ**       | Dead-Letter Queue for failed escalations.      | Any 5s timeout or non-2xx webhook response triggers a Cloud Monitoring alert.              |
| **NFR-6.4** | **Citation Audit** | Log structured citation records to BigQuery.   | 100% of clinical replies log source-line references (non-PII) to BigQuery.                 |
| **NFR-9.1** | **Secrets**        | Zero-trust secret management.                  | 0 secrets in source; Secret Manager used as a pure injector via Cloud Run `--set-secrets`. |
| **NFR-9.2** | **Privacy**        | Enkrypt Guardrails deployment.                 | Enkrypt is self-hosted in-VPC; no data leaves the GCP boundary for safety gating.          |
| **NFR-9.3** | **Encryption**     | Customer-Managed Encryption Keys (CMEK).       | Firestore and Qdrant encrypted via Cloud KMS; verified via GCP Resource Manager.           |

---

## 7. System Architecture Overview

The system follows a 7-layer architecture deployed on **Google Cloud Platform (GCP)**:

1.  **User Layer:** Caregiver Web Client (Node.js/Cloud Run) and Gemma 3n (WebNN/ONNX) for offline fallback.
2.  **Edge & Security:** GCP API Gateway (OpenAPI 2.0) for JWT validation and rate limiting.
3.  **Orchestration:** Bloom Core (Mastra/Node.js) coordinating specialist agents.
4.  **Data Layer:** Firestore (State), Qdrant (Vector Grounding), and BigQuery (Audit).
5.  **AI & Safety:** Vertex AI (Gemini), Enkrypt Guardrails (In-VPC), and Clinical On-Call Queue (HITL).
6.  **External:** WhatsApp Delivery (Roadmap).
7.  **Developer Tooling:** Build-time only (AI Studio, Antigravity).

---

## 8. Tech Stack (Mandatory Coverage)

| Technology           | Role                                                                           | Scope              |
| :------------------- | :----------------------------------------------------------------------------- | :----------------- |
| **Google AI Studio** | Dev-time environment for prototyping/testing CRISPE-structured prompts.        | Build-Time         |
| **Gemini**           | Gemini 2.5 Flash for multimodal parsing and agent reasoning.                   | Runtime (AI Infra) |
| **Gemma**            | Gemma 3n for client-side, on-device fallback parsing and triage.               | User/Client Layer  |
| **Antigravity**      | Agentic dev environment for scaffolding, CI/CD review, and traceability.       | Build-Time         |
| **ADK**              | Agent Development Kit (Python/FastAPI) for Bloom Reminders runtime.            | Orchestration      |
| **A2A**              | Asynchronous service-to-service protocol for schedule sync (Core → Reminders). | Orchestration      |
| **Vertex AI**        | Production-grade model serving path for Gemini and Embeddings.                 | AI Infra           |
| **Cloud Run**        | Serverless hosting for all microservices (Core, Reminders, Web Client).        | Infrastructure     |
| **BigQuery**         | Anonymized analytics warehouse for clinical audit and conflict logging.        | Data Layer         |

### 8.1 MCP Tool Server

The **MCP Tool Server** is a distinct, standalone component implementing the **Model Context Protocol**. It standardizes how the Coordinator and specialist agents access medication and follow-up tools.

- **Tools Provided:** `set_schedule`, `update_medication`, `get_due_medications`, `mark_medication_taken`, `add_followup`, `list_followups`, `mark_followup_done`.
- **Execution:** Runnable over `stdio` for external MCP-compatible clients and internal agent invocations.

---

## 9. Prompt Engineering (CRISPE Framework)

All agents utilize the CRISPE framework to ensure deterministic behavior:

1.  **Parser Agent:** Multimodal extraction specialist. Strict JSON output. No field invention.
2.  **Explainer Agent:** Plain-language translator. Mandatory Qdrant retrieval. Every reply includes a citation (FR-3.2).
3.  **Medication Agent:** Schedule manager. Tool-mediated via MCP. Confirms tool effects in single sentences.
4.  **Follow-up Agent:** Appointment tracker. Computes overdue status against `current_date`.
5.  **Red-Flag Agent:** Safety specialist. Three rules (RF-1, RF-2, RF-3). Passes `triage_rule_id` to safety tools. Includes four few-shot examples.

---

## 10. Security & Data Privacy

- **Zero-Trust Ingress:** API Gateway is the sole entry point.
- **Isolation:** Database-per-service (Bloom Core owns Firestore; Reminders has zero DB access).
- **Data Minimization:** BigQuery stores pseudonymized fields only. Raw discharge text is deleted after 30 days.
- **Safety Gating:** Every Red-Flag output must pass through **Enkrypt Guardrails** (In-VPC) before reaching the user. No bypass edges allowed.

---

## 11. Traceability Matrix

| Req ID      | Owning Component        | Verification Method                        |
| :---------- | :---------------------- | :----------------------------------------- |
| **FR-3.2**  | Bloom Core / Qdrant     | Labeled test set (0% fabrication audit)    |
| **FR-5.5**  | Bloom Core / HITL Queue | DLQ delivery test (5s timeout trigger)     |
| **FR-7.4**  | Gemma 3n / Bloom Core   | Two-device conflict simulation test        |
| **NFR-6.2** | Clinical On-Call Queue  | Audit log inspection (SLA tracking)        |
| **NFR-6.3** | Clinical On-Call Queue  | Cloud Monitoring alert policy verification |
| **NFR-6.4** | BigQuery                | Log/Audit inspection for citation rows     |
| **NFR-9.1** | Secret Manager          | CI/CD secret-scan & Static topology audit  |
| **NFR-9.2** | Enkrypt Guardrails      | VPC-egress log audit (confirming In-VPC)   |
| **NFR-9.3** | Cloud KMS               | GCP Resource Manager CMEK verification     |
| **NFR-3.2** | Firestore / Qdrant      | Restart test & Multi-region config audit   |

---

## 12. Timeline & Milestones

1.  **Phase 1 (Prototyping):** Prompt engineering in **Google AI Studio**; MCP tool definition.
2.  **Phase 2 (Core Dev):** System scaffolding via **Antigravity**; Mastra orchestration setup.
3.  **Phase 3 (Safety):** Enkrypt integration; HITL webhook and DLQ implementation.
4.  **Phase 4 (Resilience):** Gemma 3n offline sync and CMEK hardening.

---

## 13. Open Questions & Risks

- **WhatsApp Integration:** Currently roadmap; requires Meta Cloud API BAA verification.
- **Human Safety Net:** Scaling the clinical on-call queue for high-volume production.
- **Gemma 3n Performance:** On-device inference speed varies by caregiver hardware.
