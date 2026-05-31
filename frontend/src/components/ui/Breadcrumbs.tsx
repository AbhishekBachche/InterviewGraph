import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

export type BreadcrumbItem = {
  label: string;
  to?: string;
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav className={cn("he-breadcrumbs", className)} aria-label="Breadcrumb" data-slot="breadcrumbs">
      <ol className="he-breadcrumbs__list">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="he-breadcrumbs__item">
              {i > 0 ? (
                <ChevronRight className="he-breadcrumbs__sep" size={14} aria-hidden />
              ) : null}
              {item.to && !isLast ? (
                <Link to={item.to} className="he-breadcrumbs__link">
                  {item.label}
                </Link>
              ) : (
                <span className="he-breadcrumbs__current" aria-current={isLast ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
