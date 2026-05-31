export type AgentStep = {
  id: string;
  label: string;
  description: string;
};

export type AgentStatus = "pending" | "running" | "complete" | "error";

export const AGENTS_FULL: AgentStep[] = [
  { id: "ingest", label: "Ingest Agent", description: "Preparing audio source" },
  { id: "transcription", label: "Transcription Agent", description: "AssemblyAI speaker diarization" },
  { id: "jd", label: "JD Intelligence Agent", description: "Loading skill rubric" },
  { id: "hygiene", label: "Transcript Hygiene Agent", description: "Cleaning ASR output" },
  { id: "qa", label: "Q&A Extraction Agent", description: "Mapping evidence" },
  { id: "technical", label: "Technical Depth Agent", description: "Evaluating against JD" },
  { id: "policy", label: "Scoring Policy Engine", description: "Round-1 recommendation" },
  { id: "synthesis", label: "Report Synthesis Agent", description: "Feedback + PDF" },
];

export const AGENTS_SUMMARY: AgentStep[] = [
  { id: "ingest", label: "Ingest Agent", description: "Preparing audio source" },
  { id: "transcription", label: "Transcription Agent", description: "AssemblyAI transcription" },
  { id: "jd", label: "JD Intelligence Agent", description: "Aligning with JD" },
  { id: "summary", label: "Summary Agent", description: "Recruiter summary" },
];
