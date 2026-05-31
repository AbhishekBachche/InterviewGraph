/** Parse assistant plain-text interview pack replies for structured UI. */

export type InterviewPackMeta = {
  role?: string;
  experienceLevel?: string;
  keyTechnologies?: string;
};

export type InterviewPackQuestion = {
  number: number;
  question: string;
  expectedAnswer: string;
  keyPoints: string[];
};

export type ParsedInterviewPack = {
  meta: InterviewPackMeta;
  questions: InterviewPackQuestion[];
  preamble: string;
  raw: string;
};

const META_KEYS: { key: keyof InterviewPackMeta; labels: string[] }[] = [
  { key: "role", labels: ["role", "position", "पद"] },
  { key: "experienceLevel", labels: ["experience level", "experience", "अनुभव"] },
  { key: "keyTechnologies", labels: ["key technologies", "technologies", "tech stack", "मुख्य तकनीक"] },
];

function normalizeLabel(line: string): string {
  return line
    .replace(/^[-*•]\s*/, "")
    .replace(/:\s*$/, "")
    .trim()
    .toLowerCase();
}

function parseMetaLine(line: string): Partial<InterviewPackMeta> | null {
  const m = line.match(/^([^:]+):\s*(.+)$/);
  if (!m) return null;
  const label = normalizeLabel(m[1]);
  const value = m[2].trim();
  if (!value) return null;
  for (const { key, labels } of META_KEYS) {
    if (labels.some((l) => label === l || label.startsWith(l))) {
      return { [key]: value };
    }
  }
  return null;
}

function parseQuestionBlock(block: string): InterviewPackQuestion | null {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const qMatch = lines[0].match(/^question\s*(\d+)\s*:\s*(.+)$/i);
  if (!qMatch) return null;

  const number = parseInt(qMatch[1], 10);
  let question = qMatch[2].trim();
  let expectedAnswer = "";
  const keyPoints: string[] = [];
  let section: "answer" | "points" | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const answerMatch = line.match(/^expected\s*answer\s*:\s*(.*)$/i);
    if (answerMatch) {
      section = "answer";
      expectedAnswer = answerMatch[1].trim();
      continue;
    }
    if (/^key\s*points?\s*:?\s*$/i.test(line)) {
      section = "points";
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet && section === "points") {
      keyPoints.push(bullet[1].trim());
      continue;
    }
    if (section === "answer") {
      expectedAnswer = expectedAnswer ? `${expectedAnswer} ${line}` : line;
    } else if (section === "points" && bullet) {
      keyPoints.push(bullet[1].trim());
    }
  }

  if (!question) return null;
  return { number, question, expectedAnswer, keyPoints };
}

export function parseInterviewPack(raw: string): ParsedInterviewPack | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const questionsIdx = lower.indexOf("interview questions:");
  if (questionsIdx < 0) return null;

  const headerPart = text.slice(0, questionsIdx).trim();
  const questionsPart = text.slice(questionsIdx + "interview questions:".length).trim();

  const meta: InterviewPackMeta = {};
  const headerLines = headerPart.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const preambleLines: string[] = [];

  for (const line of headerLines) {
    const partial = parseMetaLine(line);
    if (partial) {
      Object.assign(meta, partial);
    } else if (!/^interview\s*questions?\s*:?\s*$/i.test(line)) {
      preambleLines.push(line);
    }
  }

  const blocks = questionsPart.split(/(?=^question\s*\d+\s*:)/im).filter((b) => b.trim());
  const questions: InterviewPackQuestion[] = [];
  for (const block of blocks) {
    const q = parseQuestionBlock(block.trim());
    if (q) questions.push(q);
  }

  if (!questions.length && !meta.role) return null;

  return {
    meta,
    questions,
    preamble: preambleLines.join("\n"),
    raw: text,
  };
}

export function isInterviewPackReply(content: string): boolean {
  return parseInterviewPack(content) !== null;
}
