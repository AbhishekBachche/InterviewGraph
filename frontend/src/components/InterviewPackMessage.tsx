import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { parseInterviewPack } from "../lib/interviewPack";
import { Button } from "./ui";

type InterviewPackMessageProps = {
  content: string;
  variant?: "inline" | "document";
};

export function InterviewPackMessage({ content, variant = "document" }: InterviewPackMessageProps) {
  const pack = parseInterviewPack(content);
  if (!pack) {
    return (
      <div className={variant === "document" ? "he-pack-fallback" : "chat-text"}>{content}</div>
    );
  }

  const { meta, questions, preamble } = pack;
  const hasMeta = Boolean(meta.role || meta.experienceLevel || meta.keyTechnologies);

  return (
    <InterviewPackDocument
      preamble={preamble}
      meta={meta}
      hasMeta={hasMeta}
      questions={questions}
      fallback={content}
      variant={variant}
    />
  );
}

type PackQuestion = {
  number: number;
  question: string;
  expectedAnswer: string;
  keyPoints: string[];
};

type DocumentProps = {
  preamble: string;
  meta: { role?: string; experienceLevel?: string; keyTechnologies?: string };
  hasMeta: boolean;
  questions: PackQuestion[];
  fallback: string;
  variant: "inline" | "document";
};

function InterviewPackDocument({ preamble, meta, hasMeta, questions, fallback, variant }: DocumentProps) {
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const defaultOpen = useMemo(() => new Set([1, 2]), []);

  if (!questions.length && !hasMeta) {
    return <div className="he-pack-fallback">{fallback}</div>;
  }

  const allOpen = expandAll === true;
  const allClosed = expandAll === false;

  return (
    <article className={`he-pack-doc ${variant === "document" ? "he-pack-doc--full" : ""}`}>
      <header className="he-pack-doc__header">
        <div>
          <h4 className="he-pack-doc__title">Interview Q&A</h4>
          <p className="he-pack-doc__subtitle">
            {questions.length} question{questions.length === 1 ? "" : "s"} with expected answers
          </p>
        </div>
        {questions.length > 0 ? (
          <div className="he-pack-doc__header-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpandAll(true)}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpandAll(false)}
            >
              Collapse all
            </Button>
          </div>
        ) : null}
      </header>

      {preamble ? <p className="he-pack-doc__preamble">{preamble}</p> : null}

      {hasMeta ? (
        <div className="he-pack-meta-grid" role="region" aria-label="Role summary">
          {meta.role ? (
            <div className="he-pack-meta-card">
              <span className="he-pack-meta-card__label">Role</span>
              <span className="he-pack-meta-card__value">{meta.role}</span>
            </div>
          ) : null}
          {meta.experienceLevel ? (
            <div className="he-pack-meta-card">
              <span className="he-pack-meta-card__label">Experience</span>
              <span className="he-pack-meta-card__value">{meta.experienceLevel}</span>
            </div>
          ) : null}
          {meta.keyTechnologies ? (
            <div className="he-pack-meta-card he-pack-meta-card--wide">
              <span className="he-pack-meta-card__label">Technologies</span>
              <span className="he-pack-meta-card__value">{meta.keyTechnologies}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {questions.length > 0 ? (
        <ol className="he-pack-q-list" aria-label="Interview questions">
          {questions.map((q) => (
            <PackQuestionCard
              key={q.number}
              question={q}
              forceOpen={allOpen ? true : allClosed ? false : undefined}
              defaultOpen={defaultOpen.has(q.number)}
            />
          ))}
        </ol>
      ) : (
        <div className="he-pack-fallback">{fallback}</div>
      )}
    </article>
  );
}

function PackQuestionCard({
  question: q,
  forceOpen,
  defaultOpen = false,
}: {
  question: PackQuestion;
  forceOpen?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen ?? open;

  return (
    <li className="he-pack-q">
      <button
        type="button"
        className="he-pack-q__trigger"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        <span className="he-pack-q__num" aria-hidden>
          {q.number}
        </span>
        <span className="he-pack-q__text">{q.question}</span>
        <span className="he-pack-q__chevron" aria-hidden>
          {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {isOpen ? (
        <div className="he-pack-q__body">
          {q.expectedAnswer ? (
            <section className="he-pack-q__section">
              <h5 className="he-pack-q__section-title">Expected answer</h5>
              <p className="he-pack-q__answer">{q.expectedAnswer}</p>
            </section>
          ) : null}
          {q.keyPoints.length > 0 ? (
            <section className="he-pack-q__section">
              <h5 className="he-pack-q__section-title">Key points</h5>
              <ul className="he-pack-q__points">
                {q.keyPoints.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
