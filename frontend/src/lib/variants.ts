import { cn } from "./cn";

type VariantConfig<V extends Record<string, Record<string, string>>> = {
  variants: V;
  defaultVariants?: { [K in keyof V]?: keyof V[K] & string };
};

/**
 * Class-variance-authority style helper (no extra package).
 * @example const btn = cva("he-btn", { variants: { variant: { primary: "he-btn--primary" } } });
 */
export function cva<Base extends string, V extends Record<string, Record<string, string>>>(
  base: Base,
  config: VariantConfig<V>
): (props?: { [K in keyof V]?: keyof V[K] & string } & { className?: string }) => string {
  return (props) => {
    const parts: string[] = [base];
    for (const key of Object.keys(config.variants) as (keyof V)[]) {
      const map = config.variants[key];
      const chosen =
        (props?.[key] as string | undefined) ??
        (config.defaultVariants?.[key] as string | undefined);
      if (chosen && map[chosen]) parts.push(map[chosen]);
    }
    return cn(...parts, props?.className);
  };
}
