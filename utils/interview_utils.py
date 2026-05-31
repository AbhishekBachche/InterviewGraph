# ==================== utils/interview_utils.py (PRODUCTION VERSION) ====================
import html as html_module
import pandas as pd
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, HRFlowable,
    Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import LongTable


class InterviewUtils:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self.setup_custom_styles()

    # =========================================================================
    # STYLES SETUP
    # =========================================================================
    def setup_custom_styles(self):
        """Business-standard PDF palette (memos / evaluation reports)."""
        self.primary_color = colors.HexColor("#0f172a")       # slate-900
        self.accent_color = colors.HexColor("#1d4ed8")      # blue-700 (brand accent)
        self.secondary_color = colors.HexColor("#1e3a5f")   # table headers / rules
        self.border_color = colors.HexColor("#cbd5e1")      # slate-300
        self.muted_text = colors.HexColor("#475569")        # slate-600
        self.success_color = colors.HexColor("#15803d")
        self.warning_color = colors.HexColor("#c2410c")
        self.danger_color = colors.HexColor("#b91c1c")

        self.title_style = ParagraphStyle(
            "ReportTitle",
            parent=self.styles["Title"],
            fontSize=22,
            alignment=TA_CENTER,
            textColor=self.primary_color,
            spaceAfter=6,
            fontName="Helvetica-Bold",
            leading=28,
        )

        self.subtitle_style = ParagraphStyle(
            "ReportSubtitle",
            fontSize=10.5,
            alignment=TA_CENTER,
            textColor=self.muted_text,
            spaceAfter=8,
            leading=14,
            fontName="Helvetica",
        )

        self.cover_meta_style = ParagraphStyle(
            "CoverMeta",
            fontSize=9,
            alignment=TA_CENTER,
            textColor=self.muted_text,
            spaceBefore=4,
            spaceAfter=4,
            leading=12,
            fontName="Helvetica",
        )

        self.brand_style = ParagraphStyle(
            "BrandTitle",
            fontSize=13,
            alignment=TA_CENTER,
            spaceAfter=8,
            textColor=self.primary_color,
            fontName="Helvetica-Bold",
            leading=16,
        )

        self.cover_brand_primary = ParagraphStyle(
            "CoverBrandPrimary",
            fontSize=28,
            alignment=TA_CENTER,
            textColor=self.primary_color,
            spaceAfter=4,
            fontName="Helvetica-Bold",
            leading=34,
            tracking=0.2,
        )

        self.cover_brand_tagline = ParagraphStyle(
            "CoverBrandTagline",
            fontSize=10.5,
            alignment=TA_CENTER,
            textColor=self.muted_text,
            spaceAfter=10,
            leading=14,
            fontName="Helvetica",
        )

        self.section_title_style = ParagraphStyle(
            "SectionTitle",
            parent=self.styles["Heading1"],
            fontSize=12,
            textColor=self.primary_color,
            spaceBefore=14,
            spaceAfter=6,
            leftIndent=0,
            fontName="Helvetica-Bold",
            leading=15,
        )

        self.subsection_style = ParagraphStyle(
            'SubsectionTitle',
            fontSize=12,
            textColor=self.secondary_color,
            spaceBefore=10,
            spaceAfter=6,
            fontName='Helvetica-Bold',
            leading=16
        )

        self.normal = ParagraphStyle(
            'CustomNormal',
            parent=self.styles['Normal'],
            fontSize=10,
            leading=15,
            spaceAfter=6,
            alignment=TA_JUSTIFY
        )

        self.body_bold = ParagraphStyle(
            'BodyBold',
            parent=self.normal,
            fontName='Helvetica-Bold'
        )

        self.body_italic = ParagraphStyle(
            'BodyItalic',
            parent=self.normal,
            fontName='Helvetica-Oblique'
        )

        self.highlight_box = ParagraphStyle(
            'HighlightBox',
            parent=self.normal,
            backColor=colors.HexColor("#f5f5f5"),
            borderColor=colors.HexColor("#cccccc"),
            borderWidth=1,
            borderPadding=8,
            spaceBefore=8,
            spaceAfter=8
        )

        self.executive_summary_style = ParagraphStyle(
            "ExecutiveSummary",
            parent=self.normal,
            fontSize=10.5,
            leading=16,
            backColor=colors.HexColor("#f8fafc"),
            borderColor=self.border_color,
            borderWidth=0.75,
            borderPadding=10,
            spaceBefore=8,
            spaceAfter=12,
        )

    # =========================================================================
    # HELPERS
    # =========================================================================
    def safe_text(self, text):
        """Safe text escaping for PDF with enhanced handling"""
        if text is None:
            return ""
        text = str(text)
        text = text.replace("&", "&amp;")
        text = text.replace("<", "&lt;")
        text = text.replace(">", "&gt;")
        text = text.replace('"', "&quot;")
        text = text.replace("'", "&apos;")
        text = text.replace("\r", " ")
        text = text.replace("\t", "    ")
        return text

    def split_into_safe_chunks(self, text: str, max_chars: int = 1400):
        if not text:
            return ["N/A"]
        t = str(text).strip()
        if len(t) <= max_chars:
            return [t]
        chunks, start, n = [], 0, len(t)
        while start < n:
            end = min(start + max_chars, n)
            if end < n:
                space = t.rfind(" ", start, end)
                if space > start + 200:
                    end = space
            chunks.append(t[start:end].strip())
            start = end
        return chunks

    def normalize_qa_item(self, qa):
        """Normalize Q/A pairs from dicts or stringified dicts."""
        q_text = "N/A"
        a_text = "N/A"
        if isinstance(qa, dict):
            q_text = qa.get("question", "N/A")
            a_text = qa.get("answer", "N/A")
        elif isinstance(qa, str):
            import ast, re
            match = re.search(r"\{.*\}", qa, flags=re.S)
            if match:
                try:
                    parsed = ast.literal_eval(match.group(0))
                    if isinstance(parsed, dict):
                        q_text = parsed.get("question", "N/A")
                        a_text = parsed.get("answer", "N/A")
                    else:
                        q_text = qa
                        a_text = ""
                except Exception:
                    q_text = qa
                    a_text = ""
            else:
                q_text = qa
                a_text = ""
        else:
            q_text = getattr(qa, "question", str(qa))
            a_text = getattr(qa, "answer", "N/A")
        return self.safe_text(q_text), self.safe_text(a_text)

    def horizontal_rule(self, thickness=0.6, color=None, space_before=8, space_after=8):
        if color is None:
            color = colors.HexColor("#cccccc")
        return HRFlowable(
            width="100%",
            thickness=thickness,
            color=color,
            spaceBefore=space_before,
            spaceAfter=space_after
        )

    def create_rating_bar(self, rating, max_rating=5):
        try:
            rating = float(rating)
            filled = "█" * int(rating)
            empty  = "░" * (max_rating - int(rating))
            return f"{filled}{empty} {rating}/{max_rating}"
        except:
            return f"N/A/{max_rating}"

    def add_page_chrome(self, canvas: Canvas, doc):
        """Minimal footer: page number and brand."""
        canvas.saveState()
        page_w, _ = A4
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(self.muted_text)
        canvas.drawString(48, 28, "InterviewGraph — Confidential")
        canvas.drawRightString(page_w - 48, 28, f"Page {doc.page}")
        canvas.restoreState()

    def _simple_table_style(self):
        """Minimal table styling for readable reports."""
        return TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("TEXTCOLOR", (0, 0), (-1, 0), self.primary_color),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9.5),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.35, self.border_color),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ])

    def _append_simple_section(self, content, number: int, title: str):
        content.append(Spacer(1, 10))
        content.append(Paragraph(
            f"{number}. {self.safe_text(title)}",
            self.section_title_style,
        ))
        content.append(HRFlowable(width="100%", thickness=0.6, color=self.border_color, spaceBefore=0, spaceAfter=8))

    def _append_label_value(self, content, label: str, value: str):
        content.append(Paragraph(
            f"<b>{self.safe_text(label)}:</b> {self.safe_text(value)}",
            self.normal,
        ))

    def _append_feedback_sections(self, content, feedback_text: str):
        if not feedback_text:
            return
        try:
            if not isinstance(feedback_text, str):
                feedback_text = str(feedback_text)
            excluded = {
                "gaps & next-round suggestions", "second-round interview questions",
                "next round question suggestions", "next round questions",
                "follow-up questions", "recommended questions",
            }
            lines = feedback_text.strip().split("\n")
            current, buffer, sections, order = None, [], {}, []
            for line in lines:
                if not isinstance(line, str):
                    continue
                line = line.strip()
                if not line or line == "---":
                    continue
                is_header = (len(line) < 80 and line.isupper()) or (
                    len(line) < 60 and line.endswith(":") and line.count(":") == 1
                )
                if is_header:
                    if current and current.lower() not in excluded:
                        sections[current] = list(buffer)
                        if current not in order:
                            order.append(current)
                    current, buffer = line.rstrip(":"), []
                else:
                    buffer.append(line)
            if current and current.lower() not in excluded:
                sections[current] = list(buffer)
                if current not in order:
                    order.append(current)
            suit = "Suitability for Next Round"
            ordered = [s for s in order if s != suit]
            if suit in sections:
                ordered.append(suit)
            for name in ordered:
                content.append(Paragraph(f"<b>{self.safe_text(name)}</b>", self.subsection_style))
                for item in sections.get(name, []):
                    cleaned = self.safe_text(str(item)).lstrip()
                    for sym in ("•", "→", "-"):
                        if cleaned.startswith(sym):
                            cleaned = cleaned[len(sym):].lstrip()
                            break
                    if cleaned:
                        content.append(Paragraph(cleaned, self.normal, bulletText="•"))
                content.append(Spacer(1, 6))
        except Exception:
            content.append(Paragraph(self.safe_text(str(feedback_text)), self.normal))

    # =========================================================================
    # MAIN PDF BUILDER — simple layout, full evaluation details
    # Sections:
    #   1. Report header & executive summary
    #   2. Candidate profile
    #   3. Round-1 scores & recommendation
    #   4. JD skill evaluation
    #   5. Technical maturity summary
    #   6. Projects & authenticity
    #   7. Technical Q&A (full detail)
    #   8. Gaps & follow-up questions
    #   9. Final feedback narrative
    #  10. Multi-JD evaluation (when present)
    # =========================================================================
    def build_full_structured_pdf_business(
        self,
        data,
        feedback_text="",
        title="Interview Evaluation Report",
    ):
        """Build a clean, simple PDF with all evaluation details included."""
        buffer = io.BytesIO()
        doc = BaseDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=48,
            leftMargin=48,
            topMargin=48,
            bottomMargin=52,
            title=title,
            author="InterviewGraph",
        )
        frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
        doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=self.add_page_chrome)])

        if not isinstance(data, dict):
            data = {}

        content = []
        pw = doc.width
        gen_stamp = datetime.now().strftime("%B %d, %Y")
        summary = data.get("summary", {}) or {}
        next_round = summary.get("next_round_decision", {}) or {}

        # ── Report header (no full-page cover) ──────────────────────────
        content.append(Paragraph("<b>InterviewGraph</b>", self.brand_style))
        content.append(Paragraph(self.safe_text(title), self.title_style))
        content.append(Paragraph(f"Generated: {gen_stamp}", self.subtitle_style))
        content.append(Spacer(1, 12))

        # ── 1. Executive summary ────────────────────────────────────────
        self._append_simple_section(content, 1, "Executive Summary")
        rec = self.safe_text(summary.get("recommendation", "N/A"))
        suitable = self.safe_text(str(next_round.get("suitable", "N/A")).upper())
        content.append(Paragraph(f"<b>Recommendation:</b> {rec}", self.body_bold))
        content.append(Paragraph(f"<b>Next round:</b> {suitable}", self.normal))
        reason = self.safe_text(next_round.get("reason", ""))
        if reason:
            content.append(Paragraph(reason, self.normal))
        content.append(Spacer(1, 8))

        score_rows = [["Dimension", "Score"]]
        score_fields = [
            ("Overall rating", "overall_rating"),
            ("Scenario / case Q&A", "scenario_qa_rating"),
            ("Reasoning", "reasoning_rating"),
            ("Problem solving", "problem_solving_rating"),
            ("Communication", "communication_rating"),
            ("Technical Q&A", "technical_qa_rating"),
            ("Explanation", "explanation_rating"),
            ("Project explanation", "project_explanation_rating"),
            ("Work explanation", "work_explanation_rating"),
            ("Answer integrity", "answer_integrity_rating"),
            ("GenAI exposure", "genai_exposure_rating"),
            ("Confidence", "confidence_rating"),
            ("JD coverage level", "jd_coverage_level"),
            ("JD skill average", "jd_skill_coverage_average"),
            ("Q&A coverage", "qa_coverage_level"),
        ]
        for label, key in score_fields:
            val = summary.get(key)
            if val is not None and str(val).strip() != "":
                if key.endswith("_rating"):
                    display = f"{val}/5"
                else:
                    display = str(val)
                score_rows.append([label, display])
        if len(score_rows) > 1:
            t = Table(score_rows, colWidths=[pw * 0.55, pw * 0.45])
            t.setStyle(self._simple_table_style())
            content.append(t)

        expertise = summary.get("expertise_topics") or data.get("standardized_expertise") or []
        if expertise:
            content.append(Spacer(1, 6))
            content.append(Paragraph(
                f"<b>Key expertise:</b> {self.safe_text(', '.join(str(x) for x in expertise))}",
                self.normal,
            ))

        # ── 2. Candidate profile ────────────────────────────────────────
        profile = data.get("candidate_profile", {}) or {}
        candidate = data.get("candidate", {}) or {}
        if profile or candidate:
            self._append_simple_section(content, 2, "Candidate Profile")
            src = candidate if candidate else profile
            rows = [["Field", "Details"]]
            field_map = [
                ("Name", src.get("name", "N/A")),
                ("Location", src.get("location", "N/A")),
                ("Education", src.get("education", "N/A")),
                ("Experience (years)", src.get("experience_years", "N/A")),
            ]
            if candidate:
                field_map.extend([
                    ("Previous roles", ", ".join(candidate.get("previous_designations", [])) or "N/A"),
                    ("Technologies", ", ".join(candidate.get("technologies_worked_on", [])) or "N/A"),
                ])
            else:
                field_map.extend([
                    ("Past companies", ", ".join(profile.get("past_companies", [])) or "N/A"),
                    ("Domains", ", ".join(profile.get("expertise_domains", [])) or "N/A"),
                    ("Tools & technologies", ", ".join(profile.get("tools_and_technologies", [])) or "N/A"),
                ])
            for label, val in field_map:
                rows.append([label, Paragraph(self.safe_text(str(val)), self.normal)])
            t = Table(rows, colWidths=[pw * 0.30, pw * 0.70])
            t.setStyle(self._simple_table_style())
            content.append(t)

        # ── 3. JD skill evaluation ──────────────────────────────────────
        jd_skills = list(data.get("jd_skill_analysis", []) or [])
        if jd_skills:
            self._append_simple_section(content, 3, "JD Skill Evaluation")
            rows = [["Skill", "Type", "Discussed", "Rating", "Summary"]]
            for it in jd_skills:
                discussed = str(it.get("discussed", "no")).lower() == "yes"
                rating = f"{it.get('rating', 'N/A')}/5" if discussed else "Not evaluated"
                rows.append([
                    Paragraph(self.safe_text(it.get("skill", "N/A")), self.normal),
                    Paragraph(self.safe_text(it.get("requirement_type", "N/A")), self.normal),
                    "Yes" if discussed else "No",
                    rating,
                    Paragraph(self.safe_text(it.get("summary", "") or "—"), self.normal),
                ])
            t = Table(rows, colWidths=[pw * 0.22, pw * 0.12, pw * 0.10, pw * 0.12, pw * 0.44])
            t.setStyle(self._simple_table_style())
            content.append(t)

        # ── 4. Technical maturity ───────────────────────────────────────
        tech_summary = data.get("candidate_technical_summary", {}) or {}
        if tech_summary:
            self._append_simple_section(content, 4, "Technical Maturity")
            rows = [["Aspect", "Rating", "Assessment"]]
            for key, label in (("discussion_maturity", "Discussion maturity"), ("explanation_maturity", "Explanation maturity")):
                block = tech_summary.get(key, {}) or {}
                rows.append([
                    label,
                    f"{block.get('rating', 'N/A')}/5",
                    Paragraph(self.safe_text(block.get("reason", "N/A")), self.normal),
                ])
            t = Table(rows, colWidths=[pw * 0.22, pw * 0.10, pw * 0.68])
            t.setStyle(self._simple_table_style())
            content.append(t)

        # ── 5. Projects & authenticity ──────────────────────────────────
        projects = data.get("projects", []) or []
        if projects:
            self._append_simple_section(content, 5, "Projects & Authenticity")
            for i, proj in enumerate(projects, 1):
                content.append(Paragraph(f"<b>Project {i}</b>", self.subsection_style))
                self._append_label_value(content, "Business problem", proj.get("business_problem", "N/A"))
                self._append_label_value(content, "Approach", proj.get("approach", "N/A"))
                tech = proj.get("technologies_used", []) or []
                self._append_label_value(content, "Technologies", ", ".join(tech) if tech else "N/A")
                suff = proj.get("explanation_sufficiency", {}) or {}
                if suff:
                    self._append_label_value(content, "Explanation status", suff.get("status", "N/A"))
                    missing = suff.get("missing_details", []) or []
                    if missing:
                        self._append_label_value(
                            content, "Missing details",
                            ", ".join(str(m).replace("_", " ") for m in missing),
                        )
                    if suff.get("note"):
                        self._append_label_value(content, "Note", suff.get("note"))
                auth = proj.get("authenticity_assessment", {}) or {}
                if auth:
                    self._append_label_value(content, "Authenticity", auth.get("rating", "N/A"))
                    if auth.get("reason"):
                        self._append_label_value(content, "Authenticity reason", auth.get("reason"))
                mat = proj.get("maturity", {}) or {}
                if mat:
                    line = str(mat.get("rating", "N/A"))
                    if mat.get("reason"):
                        line += f" — {mat.get('reason')}"
                    self._append_label_value(content, "Maturity", line)
                cl = proj.get("project_clarity", {}) or {}
                if cl:
                    self._append_label_value(content, "Clarity rating", f"{cl.get('rating', 'N/A')}/5")
                    if cl.get("reason"):
                        self._append_label_value(content, "Clarity reason", cl.get("reason"))
                    if cl.get("example"):
                        self._append_label_value(content, "Evidence quote", f"\"{cl.get('example')}\"")
                content.append(Spacer(1, 8))

        # ── 6. Technical Q&A (full detail) ────────────────────────────────
        tech_qa = list(data.get("technical_qa", []) or [])
        seen_q = {self.safe_text(qa.get("question", "")).strip() for qa in tech_qa}
        for item in data.get("tech_questions_table", []) or []:
            q = self.safe_text(item.get("question", "")).strip()
            if q and q not in seen_q:
                seen_q.add(q)
                tech_qa.append({
                    "question": item.get("question", "N/A"),
                    "answer": item.get("answer_summary", "N/A"),
                    "question_type": "technical",
                    "rating": item.get("rating", "N/A"),
                    "correct": "N/A",
                    "explanation": item.get("rating_reason", ""),
                    "conceptual_score": "N/A",
                    "recommendation": "N/A",
                })
        if tech_qa:
            self._append_simple_section(content, 6, f"Technical Q&A ({len(tech_qa)} questions)")
            for idx, qa in enumerate(tech_qa, 1):
                qtype = qa.get("question_type", "unknown")
                content.append(Paragraph(f"<b>Q{idx}</b> [{str(qtype).upper()}]", self.subsection_style))
                content.append(Paragraph(f"<b>Question:</b> {self.safe_text(qa.get('question', 'N/A'))}", self.normal))
                answer = self.safe_text(qa.get("answer", "N/A")).replace("\n", "<br/>")
                for i, ch in enumerate(self.split_into_safe_chunks(answer.replace("<br/>", "\n"), 1200)):
                    prefix = "<b>Answer:</b> " if i == 0 else ""
                    content.append(Paragraph(f"{prefix}{ch.replace(chr(10), '<br/>')}", self.normal))
                metrics = [
                    ("Rating", f"{qa.get('rating', 'N/A')}/5"),
                    ("Correctness", str(qa.get("correct", "N/A")).upper()),
                    ("Conceptual score", f"{qa.get('conceptual_score', 'N/A')}/5"),
                    ("Assessment", str(qa.get("recommendation", "N/A"))),
                ]
                for extra_key, extra_label in (
                    ("question_subtype", "Subtype"),
                    ("reasoning_score", "Reasoning"),
                    ("problem_solving_score", "Problem solving"),
                    ("communication_clarity_score", "Communication clarity"),
                    ("weak_or_vague_signal", "Weak/vague signal"),
                    ("answer_depth", "Answer depth"),
                    ("is_incomplete_answer", "Incomplete"),
                ):
                    if qa.get(extra_key) is not None:
                        metrics.append((extra_label, str(qa.get(extra_key))))
                mrows = [[m[0], m[1]] for m in metrics]
                mt = Table(mrows, colWidths=[pw * 0.28, pw * 0.72])
                mt.setStyle(self._simple_table_style())
                content.append(Spacer(1, 4))
                content.append(mt)
                kws = qa.get("keywords", []) or []
                if kws:
                    content.append(Paragraph(f"<b>Keywords:</b> {', '.join(str(k) for k in kws)}", self.normal))
                expl = qa.get("explanation", "")
                if expl:
                    content.append(Paragraph(f"<b>Evaluator notes:</b> {self.safe_text(expl)}", self.normal))
                content.append(Spacer(1, 6))

        # ── 7. Concept questions table ──────────────────────────────────
        concept_rows = data.get("tech_questions_table", []) or []
        if concept_rows:
            self._append_simple_section(content, 7, "Concept Questions Summary")
            rows = [["Concept", "Question", "Answer summary", "Rating", "Reason"]]
            for item in concept_rows:
                rows.append([
                    Paragraph(self.safe_text(item.get("tech_concept", "N/A")), self.normal),
                    Paragraph(self.safe_text(item.get("question", "N/A")), self.normal),
                    Paragraph(self.safe_text(item.get("answer_summary", "N/A")), self.normal),
                    str(item.get("rating", "N/A")),
                    Paragraph(self.safe_text(item.get("rating_reason", "N/A")), self.normal),
                ])
            t = Table(rows, colWidths=[pw * 0.14, pw * 0.22, pw * 0.28, pw * 0.08, pw * 0.28])
            t.setStyle(self._simple_table_style())
            content.append(t)

        # ── 8. Gaps & follow-up ─────────────────────────────────────────
        gaps = data.get("gaps_and_followups") if isinstance(data, dict) else None
        if isinstance(gaps, dict) and gaps:
            has = gaps.get("missing_topics") or gaps.get("shallow_topics") or gaps.get("recommended_followup_questions")
            if has:
                self._append_simple_section(content, 8, "Gaps & Follow-up Questions")
                for label, key in (("Missing topics", "missing_topics"), ("Shallow topics", "shallow_topics")):
                    items = gaps.get(key) or []
                    if items:
                        content.append(Paragraph(f"<b>{label}</b>", self.subsection_style))
                        for t_item in items:
                            content.append(Paragraph(self.safe_text(str(t_item)), self.normal, bulletText="•"))
                fq = gaps.get("recommended_followup_questions") or []
                if fq:
                    content.append(Paragraph("<b>Recommended follow-up questions</b>", self.subsection_style))
                    for n, q in enumerate(fq, 1):
                        content.append(Paragraph(self.safe_text(str(q)), self.normal, bulletText=f"{n}."))

        # ── 9. Final feedback ───────────────────────────────────────────
        if feedback_text:
            self._append_simple_section(content, 9, "Final Feedback")
            self._append_feedback_sections(content, feedback_text)

        # ── 10. Multi-JD evaluation ─────────────────────────────────────
        multi_jd = data.get("multi_jd_evaluation", []) if isinstance(data, dict) else []
        if isinstance(multi_jd, list) and multi_jd:
            self._append_simple_section(content, 10, "Multi-JD Evaluation")
            rows = [["Job description", "Suitable?", "Details"]]
            for row in multi_jd:
                if not isinstance(row, dict):
                    continue
                reasons = row.get("reasons", []) or []
                gap_list = row.get("gaps", []) or []
                decision = self.safe_text(row.get("decision_reason", ""))
                details = []
                details.extend(f"• {self.safe_text(r)}" for r in reasons)
                details.extend(f"• {self.safe_text(g)}" for g in gap_list)
                if decision:
                    details.append(f"• {decision}")
                rows.append([
                    Paragraph(self.safe_text(row.get("jd_name", "JD")), self.normal),
                    Paragraph(self.safe_text(row.get("suitable", "N/A")), self.normal),
                    Paragraph("<br/>".join(details) if details else "N/A", self.normal),
                ])
            if len(rows) > 1:
                t = Table(rows, colWidths=[pw * 0.25, pw * 0.12, pw * 0.63])
                t.setStyle(self._simple_table_style())
                content.append(t)

        doc.build(content)
        buffer.seek(0)
        return buffer.getvalue()


    # =========================================================================
    # HTML report (for React / API)
    # =========================================================================
    def render_advanced_evaluation_html(self, data) -> str:
        """Build sanitized HTML for the advanced evaluation (no Streamlit)."""
        if not data:
            return "<p>No analysis data available.</p>"

        def esc(x) -> str:
            return html_module.escape(str(x) if x is not None else "")

        parts: list[str] = [
            "<style>",
            ".he-report-title{text-align:center;font-size:1.8rem;font-weight:800;color:#1e2a38;",
            "border-bottom:2px solid #ccc;padding-bottom:.5rem;margin:1rem 0 1.5rem;}",
            ".he-section{font-size:1.1rem;font-weight:bold;color:#fff;background:#234e70;",
            "padding:.5rem 1rem;border-radius:6px;display:inline-block;margin-top:1.2rem;margin-bottom:.75rem;}",
            ".he-card{background:#fff;padding:1rem 1.25rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);",
            "margin-bottom:1rem;border:1px solid #e6e6e6;}",
            ".he-metric{display:inline-block;background:#f9fbfc;padding:.6rem 1rem;margin:.25rem;",
            "border-radius:8px;border:1px solid #d1d9e0;text-align:center;min-width:120px;}",
            "</style>",
            "<div class='he-report-title'>AI-Generated Interview Evaluation</div>",
        ]

        expertise = data.get("standardized_expertise")
        if not expertise:
            profile = data.get("candidate_profile") or {}
            expertise = profile.get("tools_and_technologies", [])
        parts.append("<div class='he-section'>Standardized Expertise</div><div class='he-card'>")
        if expertise:
            parts.append("<p><strong>Tools &amp; technologies</strong></p><p>" + esc(", ".join(expertise)) + "</p>")
        else:
            parts.append("<p>No tools or technologies identified.</p>")
        parts.append("</div>")

        parts.append("<div class='he-section'>Project Evaluation</div>")
        projects = data.get("projects", [])
        if not projects:
            parts.append("<p><em>No projects were discussed.</em></p>")
        else:
            for proj in projects:
                parts.append("<div class='he-card'>")
                parts.append(f"<p><strong>Business problem:</strong> {esc(proj.get('business_problem'))}</p>")
                parts.append(f"<p><strong>Approach:</strong> {esc(proj.get('approach'))}</p>")
                tech_used = proj.get("technologies_used", []) or []
                parts.append(
                    "<p><strong>Technologies:</strong> "
                    + esc(", ".join(tech_used) if tech_used else "N/A")
                    + "</p>"
                )
                suff = proj.get("explanation_sufficiency", {}) or {}
                parts.append(f"<p><strong>Explanation sufficiency:</strong> {esc(suff.get('status'))}</p>")
                md = suff.get("missing_details") or []
                if md:
                    parts.append(
                        "<p><strong>Missing details:</strong> "
                        + esc(", ".join(str(d).replace("_", " ").title() for d in md))
                        + "</p>"
                )
                if suff.get("note"):
                    parts.append(f"<p><strong>Evaluator note:</strong> {esc(suff.get('note'))}</p>")
                auth = proj.get("authenticity_assessment", {}) or {}
                parts.append(f"<p><strong>Authenticity:</strong> {esc(auth.get('rating'))}</p>")
                if auth.get("reason"):
                    parts.append(f"<p>{esc(auth.get('reason'))}</p>")
                mat = proj.get("maturity", {}) or {}
                parts.append(f"<p><strong>Maturity:</strong> {esc(mat.get('rating'))}</p>")
                if mat.get("reason"):
                    parts.append(f"<p>{esc(mat.get('reason'))}</p>")
                cl = proj.get("project_clarity", {}) or {}
                parts.append(f"<p><strong>Project clarity:</strong> {esc(cl.get('rating'))}</p>")
                if cl.get("reason"):
                    parts.append(f"<p>{esc(cl.get('reason'))}</p>")
                if cl.get("example"):
                    parts.append(f"<p><strong>Evidence:</strong> {esc(cl.get('example'))}</p>")
                parts.append("</div>")

        parts.append("<div class='he-section'>Technical Q&amp;A</div>")
        tech_qa = data.get("technical_qa", [])
        if not tech_qa:
            parts.append("<p><em>No technical Q&amp;A block found.</em></p>")
        else:
            for idx, qa in enumerate(tech_qa, 1):
                if not isinstance(qa, dict):
                    continue
                parts.append("<div class='he-card'>")
                parts.append(f"<p><strong>Q{idx}:</strong> {esc(qa.get('question'))}</p>")
                parts.append(f"<p><strong>A:</strong> {esc(qa.get('answer'))}</p>")
                parts.append(f"<p><strong>Explanation:</strong> {esc(qa.get('explanation'))}</p>")
                if qa.get("keywords"):
                    parts.append(
                        "<p><strong>Keywords:</strong> " + esc(", ".join(qa["keywords"])) + "</p>"
                    )
                parts.append("</div>")

        gaps = data.get("gaps_and_followups")
        if gaps:
            parts.append("<div class='he-section'>Gaps &amp; next round</div><div class='he-card'>")
            for label, key in (
                ("Missing topics", "missing_topics"),
                ("Shallow topics", "shallow_topics"),
            ):
                items = gaps.get(key) or []
                if items:
                    parts.append(f"<p><strong>{label}</strong></p><ul>")
                    for t in items:
                        parts.append(f"<li>{esc(t)}</li>")
                    parts.append("</ul>")
            fq = gaps.get("recommended_followup_questions") or []
            if fq:
                parts.append("<p><strong>Recommended follow-ups</strong></p><ol>")
                for q in fq:
                    parts.append(f"<li>{esc(q)}</li>")
                parts.append("</ol>")
            parts.append("</div>")

        parts.append("<div class='he-section'>Final summary</div>")
        summary = data.get("summary", {})
        if summary:
            parts.append("<div class='he-card'>")
            try:
                overall = float(summary.get("overall_rating") or 0)
            except (TypeError, ValueError):
                overall = 0.0
            parts.append(f"<p><strong>Overall rating:</strong> {overall:.1f} / 5.0</p>")
            for label, key in (
                ("Scenario / case", "scenario_qa_rating"),
                ("Reasoning", "reasoning_rating"),
                ("Problem-solving", "problem_solving_rating"),
                ("Answer integrity", "answer_integrity_rating"),
                ("GenAI exposure (context)", "genai_exposure_rating"),
                ("Explanation", "explanation_rating"),
                ("JD coverage", "jd_skill_coverage_average"),
                ("Technical QA", "technical_qa_rating"),
                ("Project clarity", "project_explanation_rating"),
            ):
                v = summary.get(key)
                if v is not None and str(v).strip() != "":
                    parts.append(
                        f"<span class='he-metric'><strong>{esc(label)}</strong><br/>{esc(v)}</span>"
                    )
            parts.append(f"<p><strong>Recommendation:</strong> {esc(summary.get('recommendation'))}</p>")
            dec = summary.get("next_round_decision", {}) or {}
            parts.append(
                "<p><strong>Decision:</strong> "
                + esc(str(dec.get("suitable", "N/A")).upper())
                + " — "
                + esc(dec.get("reason", ""))
                + "</p></div>"
            )
        else:
            parts.append("<p>No summary available.</p>")

        return "\n".join(parts)

    def show_advanced_evaluation(self, data):
        """Deprecated: use render_advanced_evaluation_html for non-Streamlit UIs."""
        raise RuntimeError("show_advanced_evaluation removed; use render_advanced_evaluation_html().")