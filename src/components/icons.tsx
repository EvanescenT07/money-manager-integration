import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function baseIconProps(size: number, props: IconProps) {
  const { size: _ignoredSize, className, "aria-label": ariaLabel, ...rest } = props;
  void _ignoredSize;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": ariaLabel ? undefined : (true as const),
    "aria-label": ariaLabel,
    className,
    ...rest,
  };
}

export function CheckCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.25 10.75 14.5 15.5 9.5" />
    </svg>
  );
}

export function ClockPendingIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v4.75l3 1.75" />
    </svg>
  );
}

export function ShieldBlockIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M12 3.5 5 6.5v5.25c0 4.3 3 7.6 7 8.75 4-1.15 7-4.45 7-8.75V6.5l-7-3Z" />
      <path d="m9 15 6-6" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.75" />
      <path d="M12 16.25h.01" />
    </svg>
  );
}

export function AlertTriangleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M10.45 4.65 3.6 16.75A1.75 1.75 0 0 0 5.12 19.4h13.76a1.75 1.75 0 0 0 1.52-2.65L13.55 4.65a1.75 1.75 0 0 0-3.1 0Z" />
      <path d="M12 9.25v4" />
      <path d="M12 16.25h.01" />
    </svg>
  );
}

export function SignalWaveIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M5.5 17.5a9.2 9.2 0 0 1 0-11" />
      <path d="M8.75 14.75a4.6 4.6 0 0 1 0-5.5" />
      <path d="M18.5 6.5a9.2 9.2 0 0 1 0 11" />
      <path d="M15.25 9.25a4.6 4.6 0 0 1 0 5.5" />
      <circle cx="12" cy="12" r="1.25" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M12 4.5v10.5" />
      <path d="m8 11.25 4 4 4-4" />
      <path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

export function LogoutIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M9.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3.5" />
      <path d="M15.25 8.25 19.5 12l-4.25 3.75" />
      <path d="M19.25 12H9.5" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M19.25 10.5A7.5 7.5 0 0 0 6.3 6.9L4.5 8.75" />
      <path d="M4.5 4.75v4h4" />
      <path d="M4.75 13.5a7.5 7.5 0 0 0 12.95 3.6l1.8-1.85" />
      <path d="M19.5 19.25v-4h-4" />
    </svg>
  );
}

export function SmartphoneIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <rect x="7" y="3.5" width="10" height="17" rx="2" />
      <path d="M10.5 6.5h3" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

export function ServerNodeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <rect x="4" y="4.5" width="16" height="6" rx="1.25" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.25" />
      <path d="M7.5 7.5h.01" />
      <path d="M7.5 16.5h.01" />
      <path d="M11 7.5h5.5" />
      <path d="M11 16.5h5.5" />
    </svg>
  );
}

export function ProcessorIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
      <path d="M9.5 3.5v3" />
      <path d="M14.5 3.5v3" />
      <path d="M9.5 17.5v3" />
      <path d="M14.5 17.5v3" />
      <path d="M3.5 9.5h3" />
      <path d="M3.5 14.5h3" />
      <path d="M17.5 9.5h3" />
      <path d="M17.5 14.5h3" />
    </svg>
  );
}

export function DatabaseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <ellipse cx="12" cy="6.25" rx="7.25" ry="2.75" />
      <path d="M4.75 6.25v11.5c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75V6.25" />
      <path d="M4.75 12c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75" />
    </svg>
  );
}

export function WebhookIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <circle cx="6.5" cy="17.5" r="2.25" />
      <circle cx="17.5" cy="17.5" r="2.25" />
      <circle cx="12" cy="6.5" r="2.25" />
      <path d="M10.8 8.4 7.7 15.6" />
      <path d="M13.2 8.4l3.1 7.2" />
      <path d="M8.75 17.5h6.5" />
    </svg>
  );
}

export function MessageSquareIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H9.5l-4.5 3.5V7A1.5 1.5 0 0 1 6.5 5.5H5Z" />
      <path d="M8.5 10h7" />
      <path d="M8.5 13h4.5" />
    </svg>
  );
}

export function ScanReceiptIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M7 4.5H5.5a1 1 0 0 0-1 1V8" />
      <path d="M17 4.5h1.5a1 1 0 0 1 1 1V8" />
      <path d="M4.5 16v2.5a1 1 0 0 0 1 1H7" />
      <path d="M19.5 16v2.5a1 1 0 0 1-1 1H17" />
      <path d="M4.5 12h15" />
      <path d="M8.5 8.5h7" />
      <path d="M8.5 15.5h5" />
    </svg>
  );
}

export function InspectCodeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="m8.5 8.5-3.5 3.5 3.5 3.5" />
      <path d="m15.5 8.5 3.5 3.5-3.5 3.5" />
      <path d="m13.25 6.5-2.5 11" />
    </svg>
  );
}

export function CloseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="m6.5 6.5 11 11" />
      <path d="m17.5 6.5-11 11" />
    </svg>
  );
}

export function LockKeyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.75" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
      <path d="M12 14.25v2.25" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M7 17 17 7" />
      <path d="M9.25 7H17v7.75" />
    </svg>
  );
}

export function ArrowDownLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M17 7 7 17" />
      <path d="M14.75 17H7V9.25" />
    </svg>
  );
}

export function ListTelemetryIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...baseIconProps(size, props)}>
      <path d="M8.5 7h11" />
      <path d="M8.5 12h11" />
      <path d="M8.5 17h11" />
      <path d="M4.5 7h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 17h.01" />
    </svg>
  );
}
