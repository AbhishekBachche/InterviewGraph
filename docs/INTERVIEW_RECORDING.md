# Interview audio — stable workflow

## Recommended: remote interviews (Zoom, Teams, Google Meet)

Browsers **cannot reliably** capture both sides of a remote call from inside HireEaze (tab/screen sharing fails often and is confusing).

**Stable approach:**

1. In Zoom / Meet / Teams, click **Record** (cloud or computer) at the start of the interview.
2. When finished, **download** the recording (MP4, M4A, etc.).
3. In HireEaze → **Interview Analyzer** → **Upload file**.
4. Choose **Transcript + summary** (default) → **Generate transcript & summary**.

Both voices are in the file. AssemblyAI transcribes; Azure generates the summary.

## In-person interviews

Use **In-person mic** tab: simple microphone recording in the browser (one room, one mic).

## Full Round-1 analysis

On **Upload file**, select **Full interview analysis** for scores, feedback, evaluation HTML, and PDF.

**Google Drive** tab runs full analysis from a shared file link.

## API

| Path | Use |
|------|-----|
| `POST /api/interview/process-recording` | Upload or in-person mic → transcript + summary |
| `POST /api/interview/analyze` | Upload / Drive → full analysis |

## Environment

`ASSEMBLYAI_API_KEY`, `AZURE_FOUNDRY_*`, `AZURE_DEPLOYMENT_NAME`
