import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "./Button";
import { FormField } from "./Form";

export function FileDropzone({
  label,
  hint,
  accept,
  multiple,
  files,
  onFilesChange,
  id: idProp,
}: {
  label: string;
  hint?: ReactNode;
  accept?: string;
  multiple?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
  id?: string;
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (!list.length) return;
      onFilesChange(multiple ? [...files, ...list] : [list[0]]);
    },
    [files, multiple, onFilesChange]
  );

  const removeAt = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <div
        className={`he-dropzone${dragActive ? " he-dropzone--active" : ""}${files.length ? " he-dropzone--has-files" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="he-dropzone__input"
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="he-dropzone__inner">
          <span className="he-dropzone__icon" aria-hidden>
            <Upload size={22} strokeWidth={1.75} />
          </span>
          <p className="he-dropzone__title">
            Drag & drop {multiple ? "files" : "a file"} here, or{" "}
            <Button type="button" variant="ghost" size="sm" className="he-dropzone__browse" onClick={() => inputRef.current?.click()}>
              browse
            </Button>
          </p>
          {accept ? <p className="he-dropzone__meta">Accepted: {accept.replaceAll(",", ", ")}</p> : null}
        </div>
      </div>
      {files.length > 0 ? (
        <ul className="he-file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="he-file-list__item">
              <span className="he-file-list__name" title={f.name}>
                {f.name}
              </span>
              <span className="he-file-list__size">{(f.size / 1024).toFixed(1)} KB</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="he-file-list__remove"
                aria-label={`Remove ${f.name}`}
                onClick={() => removeAt(i)}
              >
                <X size={16} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </FormField>
  );
}

export function SingleFileDropzone({
  label,
  hint,
  accept,
  file,
  onFileChange,
  id: idProp,
}: {
  label: string;
  hint?: ReactNode;
  accept?: string;
  file: File | null;
  onFileChange: (f: File | null) => void;
  id?: string;
}) {
  return (
    <FileDropzone
      label={label}
      hint={hint}
      accept={accept}
      multiple={false}
      files={file ? [file] : []}
      onFilesChange={(list) => onFileChange(list[0] ?? null)}
      id={idProp}
    />
  );
}
