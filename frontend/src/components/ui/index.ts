/** Hireeaze design system — import from `../components/ui` */

export { cn } from "@/lib/utils";
export { cva } from "../../lib/variants";
export { useControllableState } from "../../lib/hooks/useControllableState";

export { Alert, PageAlerts } from "./Alert";
export type { AlertProps, AlertTone, PageAlertsProps } from "./Alert";

export { Button, ButtonLink, buttonVariants } from "./Button";
export type { ButtonProps, ButtonLinkProps, ButtonAnchorProps, ButtonVariant, ButtonSize } from "./Button";
export { ButtonAnchor } from "./Button";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./Card";
export type { CardProps } from "./Card";

export { WorkflowCard } from "./WorkflowCard";
export type { WorkflowCardProps, StepTone } from "./WorkflowCard";

export { FormField, SelectField, TextAreaField, TextField, ExcelNameInput } from "./Form";
export type {
  FormFieldProps,
  SelectFieldProps,
  TextAreaFieldProps,
  TextFieldProps,
  ExcelNameInputProps,
  SelectOption,
} from "./Form";

export { Input, Textarea, NativeSelect } from "./primitives/Input";
export type { InputProps, TextareaProps, NativeSelectProps } from "./primitives/Input";

export { Spinner } from "./primitives/Spinner";
export type { SpinnerProps } from "./primitives/Spinner";

export { Slot } from "./primitives/Slot";

export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlProps, SegmentedOption } from "./SegmentedControl";

export { FileDropzone, SingleFileDropzone } from "./FileDropzone";
export { MetricGrid } from "./MetricGrid";
export type { MetricGridProps } from "./MetricGrid";
export { PageStack } from "./PageStack";
export { UserSelectBar } from "./UserSelectBar";
export { FilterToolbar } from "./FilterToolbar";
export type { FilterToolbarProps } from "./FilterToolbar";
export { ActionRow } from "./ActionRow";
export type { ActionRowProps } from "./ActionRow";

export { DataTable, TablePagination } from "./DataTable";
export type { DataTableProps, TablePaginationProps } from "./DataTable";

export { DataGrid } from "./DataGrid";
export type { DataGridProps, DataGridColumn } from "./DataGrid";

export { Skeleton, TableSkeleton, MetricSkeleton } from "./Skeleton";
export type { SkeletonProps, TableSkeletonProps, MetricSkeletonProps } from "./Skeleton";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Modal, ConfirmDialog } from "./Modal";
export type { ModalProps, ConfirmDialogProps } from "./Modal";

export { ToastProvider, useToast } from "./Toast";
export type { ToastTone } from "./Toast";

export { Breadcrumbs } from "./Breadcrumbs";
export type { BreadcrumbsProps, BreadcrumbItem } from "./Breadcrumbs";

export { StatusBadge, statusToneFromLabel } from "./StatusBadge";
export type { StatusBadgeProps, StatusBadgeTone } from "./StatusBadge";
