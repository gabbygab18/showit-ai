"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";

// Served from GitHub Releases: upload the installer with this exact name on each release.
export const REL = "https://github.com/gabbygab18/showit-ai/releases/latest/download";
export const WIN_URL = `${REL}/Showit-AI-win-x64-setup.exe`;

/** Windows logo (the icon set has no brand marks). */
export function WinLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M3 5.5 10.5 4.4v7.2H3zm8.5-1.2L21 3v8.6h-9.5zM3 12.6h7.5v7.1L3 18.6zm8.5 0H21V21l-9.5-1.4z" />
    </svg>
  );
}

/** True on a Mac, where the Windows-only app can't run (best effort). */
function useMac() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setMac(/mac|iphone|ipad/i.test(`${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`));
  }, []);
  return mac;
}

/** The main download button, with a note for Mac visitors. */
export function PrimaryDownload({ className = "", onBlue = false }: { className?: string; onBlue?: boolean }) {
  const mac = useMac();
  return (
    <span className={`inline-flex flex-col items-center gap-2 ${className}`}>
      <a
        href={WIN_URL}
        className={`inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-sm font-semibold active:scale-[0.98] ${onBlue ? "btn-white" : "btn-blue"}`}
      >
        <WinLogo className="size-4" />
        Download for Windows
      </a>
      {mac && <span className={`text-xs ${onBlue ? "text-white/70" : "text-ink-soft"}`}>Windows only for now. Grab it on your Windows PC.</span>}
    </span>
  );
}

/** Small "Get Started ↗" pill for the nav and cards. */
export function DownloadInline({ label = "Get Started" }: { label?: string }) {
  return (
    <a href={WIN_URL} className="btn-blue inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold active:scale-[0.98]">
      {label}
      <Icon name="arrow-up-right" className="size-3.5" />
    </a>
  );
}
