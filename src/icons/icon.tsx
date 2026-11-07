import { useId, type SVGProps } from "react";
import { BY_NAME, renderInner, type Variant } from "./render.ts";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  name: string;
  variant?: Variant;
  stroke?: number;
  size?: number | string;
}

export function Icon({ name, variant = "line", stroke = 2, size = "1em", ...props }: IconProps) {
  const id = `m${useId().replace(/[^\w-]/g, "")}`;
  const def = BY_NAME.get(name);
  if (!def) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      {...props}
      dangerouslySetInnerHTML={{ __html: renderInner(def, { variant, stroke, id }) }}
    />
  );
}

/** Named stand-ins for the lucide icons the Glint components import, so the whole site runs on its own set. */
const named = (name: string) => {
  const C = (props: Omit<IconProps, "name">) => <Icon name={name} variant="solid" {...props} />; // filled by default
  C.displayName = name;
  return C;
};
export const ChevronDown = named("chevron-down");
export const X = named("close");
export const Loader2 = named("loader");
export const CircleAlert = named("alert-circle");
export const CircleCheck = named("check-circle");
export const Info = named("info");
export const TriangleAlert = named("warning");
export const Check = named("check");
export const Copy = named("copy");
export const FileCode2 = named("file-code");
export const ChevronLeft = named("chevron-left");
export const ChevronRight = named("chevron-right");
export const ChevronsLeft = named("chevrons-left");
export const ChevronsRight = named("chevrons-right");
export const MoreHorizontal = named("more-horizontal");
