import { forwardRef, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";
import { Input, NativeSelect, Textarea } from "./primitives/Input";

export type FormFieldProps = {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export function FormField({ label, htmlFor, hint, error, required, children, className }: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)} data-slot="form-field">
      <Label htmlFor={htmlFor} className={cn(error && "text-destructive")}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
};

export function SelectField({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  id: idProp,
  placeholder,
  required,
  disabled,
}: SelectFieldProps) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <NativeSelect
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

export type TextAreaFieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
};

export function TextAreaField({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 6,
  id: idProp,
  placeholder,
  required,
  disabled,
}: TextAreaFieldProps) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        intent={error ? "error" : "default"}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export type TextFieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  disabled?: boolean;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    value,
    onChange,
    type = "text",
    id: idProp,
    placeholder,
    required,
    minLength,
    autoComplete,
    disabled,
  },
  ref
) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <Input
        ref={ref}
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        disabled={disabled}
        intent={error ? "error" : "default"}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
});

TextField.displayName = "TextField";

export type ExcelNameInputProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
};

export function ExcelNameInput({ label, hint, error, value, onChange, placeholder, id: idProp }: ExcelNameInputProps) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error}>
      <div className="he-excel-name">
        <Input
          id={id}
          type="text"
          className="he-excel-name__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          intent={error ? "error" : "default"}
        />
        <span className="he-excel-name__suffix" aria-hidden>
          .xlsx
        </span>
      </div>
    </FormField>
  );
}
