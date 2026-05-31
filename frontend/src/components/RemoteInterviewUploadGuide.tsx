import { Video } from "lucide-react";
import { Alert, Button } from "./ui";
import { cn } from "@/lib/utils";

type RemoteInterviewUploadGuideProps = {
  onGoToUpload?: () => void;
  className?: string;
};

/**
 * Stable workflow for remote interviews: record in Zoom/Meet/Teams, then upload the file.
 */
export default function RemoteInterviewUploadGuide({ onGoToUpload, className }: RemoteInterviewUploadGuideProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3",
        className
      )}
      data-slot="remote-interview-guide"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary" aria-hidden>
          <Video className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-display text-sm font-semibold text-foreground m-0">
            Remote interview (Zoom, Teams, Google Meet)
          </p>
          <p className="text-sm text-muted-foreground m-0 leading-relaxed">
            Record in your meeting app, then upload the file here. This captures{" "}
            <strong className="font-medium text-foreground">both you and the candidate</strong> reliably — no browser
            tab sharing.
          </p>
        </div>
      </div>
      <ol className="m-0 list-decimal space-y-2 pl-5 text-sm text-muted-foreground marker:font-semibold marker:text-foreground">
        <li>
          At the start of the call, click <strong className="text-foreground">Record</strong> in Zoom, Teams, or Meet.
        </li>
        <li>Run the interview as usual.</li>
        <li>
          When finished, <strong className="text-foreground">download</strong> the recording (MP4, M4A, etc.).
        </li>
        <li>
          Upload it below and choose <strong className="text-foreground">Generate transcript &amp; summary</strong>.
        </li>
      </ol>
      <Alert tone="info" className="text-sm">
        Do not use the in-person mic tab for remote calls — use this upload flow instead.
      </Alert>
      {onGoToUpload ? (
        <Button type="button" variant="outline" size="sm" onClick={onGoToUpload}>
          Focus upload area
        </Button>
      ) : null}
    </div>
  );
}
