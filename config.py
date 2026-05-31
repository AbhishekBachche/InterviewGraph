import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables for --jd extraction-- and qa for jd  
load_dotenv()


DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "hireeaze",
    "user": "dataeaze",
    "password": "12345"
}


DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "hireeaze")
DB_USER = os.getenv("DB_USER", "dataeaze")
DB_PASSWORD = os.getenv("DB_PASSWORD", "12345")

# Prefer DATABASE_URL from .env when present so all modules share one DB target.
_env_database_url = (os.getenv("DATABASE_URL") or "").strip()
if _env_database_url:
    # psycopg2 expects postgresql:// not postgresql+psycopg2://
    DATABASE_URL = _env_database_url.replace("postgresql+psycopg2://", "postgresql://")
else:
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


# --------- Base Directories ---------
OUTPUT_BASE_DIR = Path("HireEaze_output")  # ✅ Replace this with your desired path

HTML_PARSED_DIR = OUTPUT_BASE_DIR / "html"
PDF_OUTPUT_DIR = OUTPUT_BASE_DIR / "pdf"
COMPARE_DATA_DIR = OUTPUT_BASE_DIR / "comparisons"
QA_OUTPUT_DIR = OUTPUT_BASE_DIR / "jd_qa"

# Create directories
for path in [
    HTML_PARSED_DIR,
    PDF_OUTPUT_DIR,
    COMPARE_DATA_DIR,
    QA_OUTPUT_DIR,
]:
    path.mkdir(parents=True, exist_ok=True)

# --------- HTML Resume Files ---------
HTML_PARSED_LATEST_FILENAME_PATH = HTML_PARSED_DIR / "latest_resume_filename.txt"
HTML_PARSED_JSON_PATH = HTML_PARSED_DIR / "working_parsed_candidates.json"
def get_html_output_excel_path(filename: str) -> Path:
    return HTML_PARSED_DIR / f"{filename.strip()}.xlsx"

# --------- Gemini PDF/DOCX Resume Files ---------
PDF_PARSED_LATEST_FILENAME_PATH = PDF_OUTPUT_DIR / "latest_resume_filename.txt"
def get_pdf_output_excel_path(filename: str = "pdf_resumes") -> Path:
    return PDF_OUTPUT_DIR / f"{filename.strip()}.xlsx"

# --------- JD Comparison Output ---------
def get_comparison_result_path(filename: str) -> Path:
    return COMPARE_DATA_DIR / f"{filename.strip().replace(' ', '_')}.xlsx"

# --------- JD Q&A PDF ---------
def get_qa_output_pdf_path(filename: str) -> Path:
    return QA_OUTPUT_DIR / f"{filename.strip()}.pdf"



















import os
import google.generativeai as genai

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")  # Add to your .env
genai.configure(api_key=GOOGLE_API_KEY)

# Gemini 1.5 Flash model ID
MODEL_NAME = "models/gemini-1.5-flash"

# Create model instance
client = genai.GenerativeModel(model_name=MODEL_NAME)



























# Base directories
BASE_DIR = Path(__file__).parent
OUTPUT_BASE_DIR = BASE_DIR / "HireEaze_output"

# Existing directories
HTML_PARSED_DIR = OUTPUT_BASE_DIR / "html"
PDF_OUTPUT_DIR = OUTPUT_BASE_DIR / "pdf"
COMPARE_DATA_DIR = OUTPUT_BASE_DIR / "comparisons"
JD_QA_DIR = OUTPUT_BASE_DIR / "jd_qa"
JD_MCQ_TESTS_DIR = OUTPUT_BASE_DIR / "jd_mcq_tests"
JD_MCQ_RESULTS_DIR = OUTPUT_BASE_DIR / "jd_mcq_results"

# NEW: Interview analysis directories
INTERVIEW_OUTPUT_DIR = OUTPUT_BASE_DIR / "interview_analysis"
INTERVIEW_TRANSCRIPTS_DIR = INTERVIEW_OUTPUT_DIR / "transcripts"
INTERVIEW_REPORTS_DIR = INTERVIEW_OUTPUT_DIR / "reports"
INTERVIEW_RAW_DATA_DIR = INTERVIEW_OUTPUT_DIR / "raw_data"

# Create all directories if they don't exist
for directory in [
    OUTPUT_BASE_DIR, HTML_PARSED_DIR, PDF_OUTPUT_DIR, COMPARE_DATA_DIR,
    JD_QA_DIR, JD_MCQ_TESTS_DIR, JD_MCQ_RESULTS_DIR, INTERVIEW_OUTPUT_DIR,
    INTERVIEW_TRANSCRIPTS_DIR, INTERVIEW_REPORTS_DIR, INTERVIEW_RAW_DATA_DIR
]:
    directory.mkdir(parents=True, exist_ok=True)

# Existing file paths
HTML_PARSED_JSON_PATH = HTML_PARSED_DIR / "working_parsed_candidates.json"
PDF_PARSED_LATEST_FILENAME_PATH = PDF_OUTPUT_DIR / "latest_resume_filename.txt"
HTML_PARSED_LATEST_FILENAME_PATH = HTML_PARSED_DIR / "latest_resume_filename.txt"

# NEW: Interview analysis file paths
INTERVIEW_LATEST_SESSION_PATH = INTERVIEW_OUTPUT_DIR / "latest_session.txt"

# Existing functions
def get_html_output_excel_path(custom_name="html_candidates"):
    return HTML_PARSED_DIR / f"{custom_name}.xlsx"

def get_pdf_output_excel_path(custom_name="parsed_resumes"):
    return PDF_OUTPUT_DIR / f"{custom_name}.xlsx"

# --------- JD Comparison Output ---------
def get_comparison_result_path(filename: str) -> Path:
    """
    Get path for comparison result file with automatic directory creation.
    Sanitizes filename and ensures parent directories exist.
    """
    # Sanitize filename: remove spaces, slashes, and trailing spaces
    sanitized = (filename.strip()
                 .replace(' ', '_')
                 .replace('/', '_')
                 .replace('\\', '_')
                 .replace(':', '_')  # Remove colons (problematic in filenames)
                 .replace('*', '_')  # Remove asterisks
                 .replace('?', '_')  # Remove question marks
                 .replace('"', '_')  # Remove quotes
                 .replace('<', '_')  # Remove less than
                 .replace('>', '_')  # Remove greater than
                 .replace('|', '_')) # Remove pipe
    
    # Ensure it ends with .xlsx
    if not sanitized.lower().endswith('.xlsx'):
        sanitized = f"{sanitized}.xlsx"
    
    # Create full path
    full_path = COMPARE_DATA_DIR / sanitized
    
    # CRITICAL: Create parent directory if it doesn't exist
    full_path.parent.mkdir(parents=True, exist_ok=True)
    
    return full_path


    
def get_qa_output_pdf_path(custom_name="jd_qa_output"):
    return JD_QA_DIR / f"{custom_name}.pdf"

# NEW: Interview analysis functions
def get_interview_transcript_path(session_id=""):
    """Get path for interview transcript"""
    if not session_id:
        from datetime import datetime
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    return INTERVIEW_TRANSCRIPTS_DIR / f"transcript_{session_id}.txt"

def get_interview_report_path(session_id="", format="pdf"):
    """Get path for interview analysis report"""
    if not session_id:
        from datetime import datetime
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    return INTERVIEW_REPORTS_DIR / f"interview_report_{session_id}.{format}"

def get_interview_raw_data_path(session_id=""):
    """Get path for raw interview analysis data (JSON)"""
    if not session_id:
        from datetime import datetime
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    return INTERVIEW_RAW_DATA_DIR / f"analysis_data_{session_id}.json"

def save_latest_interview_session(session_id):
    """Save the latest interview session ID"""
    with open(INTERVIEW_LATEST_SESSION_PATH, "w") as f:
        f.write(session_id)

def get_latest_interview_session():
    """Get the latest interview session ID"""
    if INTERVIEW_LATEST_SESSION_PATH.exists():
        return INTERVIEW_LATEST_SESSION_PATH.read_text().strip()
    return None

# Environment variables validation
def validate_interview_env():
    """Validate environment variables for interview analysis"""
    required_vars = [
        "ASSEMBLYAI_API_KEY",
        "AZURE_FOUNDRY_ENDPOINT", 
        "AZURE_FOUNDRY_KEY",
        "AZURE_DEPLOYMENT_NAME"
    ]
    
    missing_vars = []
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        return False, missing_vars
    return True, []

# File type validation
SUPPORTED_AUDIO_FORMATS = [".mp3", ".wav", ".m4a", ".mp4", ".aac", ".flac", ".ogg"]
SUPPORTED_DOCUMENT_FORMATS = [".pdf", ".docx", ".txt"]

def is_supported_audio_file(filename):
    """Check if file is a supported audio format"""
    return Path(filename).suffix.lower() in SUPPORTED_AUDIO_FORMATS

def is_supported_document_file(filename):
    """Check if file is a supported document format"""
    return Path(filename).suffix.lower() in SUPPORTED_DOCUMENT_FORMATS

# NEW: Interview analysis settings
INTERVIEW_ANALYSIS_SETTINGS = {
    "max_file_size_mb": 500,  # Maximum audio file size in MB
    "transcription_timeout": 300,  # Timeout for transcription in seconds
    "analysis_timeout": 180,  # Timeout for analysis in seconds
    "supported_languages": ["en", "en-US", "en-GB"],  # Supported languages
    "speaker_detection": True,  # Enable speaker detection
    "format_text": True,  # Enable text formatting
}

# Database settings (if using database for interview data)
DATABASE_SETTINGS = {
    "interview_table": "interview_sessions",
    "candidates_table": "candidates",
    "reports_table": "interview_reports"
}

# API rate limits and settings
API_SETTINGS = {
    "assemblyai": {
        "rate_limit_per_hour": 100,
        "max_file_size_mb": 500,
        "supported_formats": SUPPORTED_AUDIO_FORMATS
    },
    "azure_openai": {
        "rate_limit_per_minute": 60,
        "max_tokens": 4000,
        "temperature": 0.3
    }
}

# Logging configuration
LOGGING_CONFIG = {
    "interview_log_file": OUTPUT_BASE_DIR / "logs" / "interview_analysis.log",
    "log_level": "INFO",
    "log_format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
}

# Create logs directory
(OUTPUT_BASE_DIR / "logs").mkdir(exist_ok=True)













