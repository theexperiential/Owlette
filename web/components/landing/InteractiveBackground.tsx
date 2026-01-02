'use client';

import { useEffect, useRef, useState } from 'react';

interface MousePosition {
  x: number;
  y: number;
}

export function InteractiveBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState<MousePosition>({ x: 0.5, y: 0.5 });
  const animationRef = useRef<number | null>(null);
  const targetPos = useRef<MousePosition>({ x: 0.5, y: 0.5 });
  const currentPos = useRef<MousePosition>({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      targetPos.current = { x, y };
    };

    // Smooth animation loop with simple lerp
    const animate = () => {
      const lerp = 0.08;

      currentPos.current = {
        x: currentPos.current.x + (targetPos.current.x - currentPos.current.x) * lerp,
        y: currentPos.current.y + (targetPos.current.y - currentPos.current.y) * lerp,
      };

      setMousePos({ ...currentPos.current });
      animationRef.current = requestAnimationFrame(animate);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Subtle parallax offset
  const offsetX = (mousePos.x - 0.5) * 40;
  const offsetY = (mousePos.y - 0.5) * 40;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
    >
      {/* Primary glow - follows mouse */}
      <div
        className="absolute w-[900px] h-[900px] rounded-full blur-3xl"
        style={{
          background: 'radial-gradient(circle, oklch(0.75 0.18 195 / 0.12) 0%, transparent 60%)',
          left: `calc(${mousePos.x * 100}% - 450px)`,
          top: `calc(${mousePos.y * 100}% - 450px)`,
        }}
      />

      {/* Dot grid - base layer (rendered twice: under and over the fade) */}
      <div
        className="absolute inset-0 dot-grid opacity-30"
        style={{
          transform: `translate3d(${offsetX * 0.02}px, ${offsetY * 0.02}px, 0)`,
        }}
      />

      {/* Dot grid spotlight - brighter dots near mouse */}
      <div
        className="absolute w-[800px] h-[800px] pointer-events-none"
        style={{
          left: `calc(${mousePos.x * 100}% - 400px)`,
          top: `calc(${mousePos.y * 100}% - 400px)`,
          maskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
          WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
        }}
      >
        <div className="absolute inset-0 dot-grid opacity-70" />
      </div>

      {/* Blueprint grid - subtle */}
      <div className="absolute inset-0 blueprint-grid opacity-15" />
      <div className="absolute inset-0 blueprint-grid-accent opacity-8" />

      {/* Radial fade overlay */}
      <div className="absolute inset-0 blueprint-fade" />

      {/* Dot grid - top layer visible outside fade */}
      <div
        className="absolute inset-0 dot-grid opacity-50 pointer-events-none"
        style={{
          transform: `translate3d(${offsetX * 0.02}px, ${offsetY * 0.02}px, 0)`,
        }}
      />
    </div>
  );
}
