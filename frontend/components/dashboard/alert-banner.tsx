'use client';

import { useEffect, useState } from 'react';

interface Alert {
  sensorId: string;
  score: number;
}

interface AlertBannerProps {
  alert: Alert;
}

export default function AlertBanner({ alert }: AlertBannerProps) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [alert]);

  if (!show) return null;

  return (
    <div className="w-full bg-[#ff4444] py-4 px-6 animate-in slide-in-from-top duration-300">
      <div className="text-center font-bold text-white text-lg flex items-center justify-center gap-2">
        <span>🔴</span>
        <span>ATTAQUE DÉTECTÉE ET BLOQUÉE — Capteur {alert.sensorId}</span>
        <span className="ml-4 text-sm bg-black/20 px-3 py-1 rounded">
          Score: {alert.score}%
        </span>
      </div>
    </div>
  );
}
