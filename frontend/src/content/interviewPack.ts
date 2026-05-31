/** Interview QA — page copy */

export const INTERVIEW_PACK_TITLE = "Interview QA";

export const INTERVIEW_PACK_DESCRIPTION =
  "Generate interview questions with expected answers, then export a PDF for your panel.";

export const INTERVIEW_PACK_NAV_LABEL = "Interview QA";

export const INTERVIEW_PACK_DASHBOARD_HINT = "Questions & answers from JD or role notes";

export const INTERVIEW_PACK_INTRO =
  "Optional: attach a job description on the left. Then describe the role below and click Generate Q&A.";

export const INTERVIEW_PACK_EMPTY_STEPS = [
  "Attach a JD on the left (optional)",
  "Describe the role and how many questions you need",
  "Click Generate Q&A, then Export PDF",
] as const;

/** Shown in composer when a JD is attached */
export type JdRequestTemplate = {
  id: string;
  label: string;
  message: string;
  focus?: string;
};

export const JD_REQUEST_TEMPLATES: JdRequestTemplate[] = [
  {
    id: "jd-technical-8",
    label: "8 technical questions from JD",
    message: "Using the attached job description, generate 8 technical interview questions with expected answers.",
    focus: "Prioritize mandatory skills from the JD.",
  },
  {
    id: "jd-technical-10",
    label: "10 questions from JD",
    message:
      "From the attached JD, generate 10 interview questions with expected answers.",
    focus: "Cover mandatory skills listed in the JD.",
  },
  {
    id: "jd-mixed",
    label: "Technical + behavioral",
    message:
      "Using the attached JD, generate 8 interview questions: 6 technical and 2 behavioral, with expected answers.",
    focus: "Align with the JD role and team expectations.",
  },
];
