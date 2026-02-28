'use client';

import { useEffect, useState } from 'react';

interface AlertBannerProps {
  detectedAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AlertBanner({ detectedAt }: AlertBannerProps) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => setShow(false), 3000);
    return () => clearTimeout(timer);
  }, [detectedAt]);

  if (!show) return null;

  return (
    <div className="w-full bg-[#ff4444] py-4 px-6 animate-in slide-in-from-top duration-300">
      <div className="text-center font-bold text-white text-lg flex items-center justify-center gap-2">
        <span>🔴</span>
        <span>ANOMALIE FDI DÉTECTÉE — {formatDate(detectedAt)}</span>
      </div>
    </div>
  );
}
