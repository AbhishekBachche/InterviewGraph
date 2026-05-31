"""Application file roots under GDP_Agent_output/."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class AppWorkspace:
    root: Path

    @classmethod
    def default(cls) -> AppWorkspace:
        root = _ROOT / "GDP_Agent_output"
        return cls(root=root)

    def ensure_directories(self) -> None:
        for d in (
            self.html_dir,
            self.pdf_dir,
            self.comparisons_dir,
            self.jd_qa_dir,
            self.jd_store_dir,
            self.jd_mcq_tests_dir,
            self.jd_mcq_results_dir,
            self.interview_output_dir,
            self.interview_transcripts_dir,
            self.interview_recordings_dir,
            self.interview_reports_dir,
            self.interview_raw_dir,
            self.logs_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def html_dir(self) -> Path:
        return self.root / "html"

    @property
    def pdf_dir(self) -> Path:
        return self.root / "pdf"

    @property
    def comparisons_dir(self) -> Path:
        return self.root / "comparisons"

    @property
    def jd_qa_dir(self) -> Path:
        return self.root / "jd_qa"

    @property
    def jd_store_dir(self) -> Path:
        return self.root / "jd_store"

    @property
    def jd_mcq_tests_dir(self) -> Path:
        return self.root / "jd_mcq_tests"

    @property
    def jd_mcq_results_dir(self) -> Path:
        return self.root / "jd_mcq_results"

    @property
    def interview_output_dir(self) -> Path:
        return self.root / "interview_analysis"

    @property
    def interview_transcripts_dir(self) -> Path:
        return self.interview_output_dir / "transcripts"

    @property
    def interview_reports_dir(self) -> Path:
        return self.interview_output_dir / "reports"

    @property
    def interview_recordings_dir(self) -> Path:
        return self.interview_output_dir / "recordings"

    @property
    def interview_raw_dir(self) -> Path:
        return self.interview_output_dir / "raw_data"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"
