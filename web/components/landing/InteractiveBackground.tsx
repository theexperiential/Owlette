'use client';

import { useEffect, useRef, useState } from 'react';

interface MousePosition {
  x: number;
  y: number;
}

export function InteractiveBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState<MousePosition>({ x: 0.5, y: 0.5 });
  const [isHovering, setIsHovering] = useState(false);
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

    const handleMouseEnter = () => setIsHovering(true);
    const handleMouseLeave = () => {
      setIsHovering(false);
      // Slowly drift back to center
      targetPos.current = { x: 0.5, y: 0.5 };
    };

    // Smooth animation loop
    const animate = () => {
      const lerp = 0.05; // Smoothing factor (lower = smoother)

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
      container.addEventListener('mouseenter', handleMouseEnter);
      container.addEventListener('mouseleave', handleMouseLeave);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseenter', handleMouseEnter);
        container.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Calculate displacement based on mouse position
  const offsetX = (mousePos.x - 0.5) * 100; // -50 to 50 range
  const offsetY = (mousePos.y - 0.5) * 100;

  // Subtle rotation based on mouse position
  const rotateX = (mousePos.y - 0.5) * -5; // -2.5 to 2.5 degrees
  const rotateY = (mousePos.x - 0.5) * 5;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ perspective: '1000px' }}
    >
      {/* Primary glow - follows mouse */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-3xl transition-opacity duration-500"
        style={{
          background: 'radial-gradient(circle, oklch(0.75 0.18 195 / 0.08) 0%, transparent 70%)',
          left: `calc(${mousePos.x * 100}% - 300px)`,
          top: `calc(${mousePos.y * 100}% - 300px)`,
          opacity: isHovering ? 1 : 0.6,
          transform: `translate3d(${offsetX * 0.2}px, ${offsetY * 0.2}px, 0)`,
        }}
      />

      {/* Secondary glow - opposite direction for depth */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full blur-3xl"
        style={{
          background: 'radial-gradient(circle, oklch(0.65 0.25 250 / 0.06) 0%, transparent 70%)',
          left: `calc(${(1 - mousePos.x) * 80 + 10}% - 250px)`,
          top: `calc(${(1 - mousePos.y) * 80 + 10}% - 250px)`,
          transform: `translate3d(${-offsetX * 0.15}px, ${-offsetY * 0.15}px, 0)`,
        }}
      />

      {/* Tertiary subtle glow */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full blur-2xl opacity-40"
        style={{
          background: 'radial-gradient(circle, oklch(0.75 0.18 195 / 0.04) 0%, transparent 70%)',
          left: `calc(50% + ${offsetX * 0.5}px - 200px)`,
          top: `calc(60% + ${offsetY * 0.5}px - 200px)`,
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
        className="absolute w-[600px] h-[600px] pointer-events-none"
        style={{
          left: `calc(${mousePos.x * 100}% - 300px)`,
          top: `calc(${mousePos.y * 100}% - 300px)`,
          background: 'radial-gradient(circle, oklch(0.75 0.18 195 / 0.15) 0%, transparent 50%)',
          maskImage: 'radial-gradient(circle, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 70%)',
        }}
      >
        <div className="absolute inset-0 dot-grid opacity-80" />
      </div>

      {/* Blueprint grid with subtle 3D tilt */}
      <div
        className="absolute inset-0 blueprint-grid opacity-20"
        style={{
          transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transformOrigin: 'center center',
          transition: 'transform 0.1s ease-out',
        }}
      />
      <div
        className="absolute inset-0 blueprint-grid-accent opacity-10"
        style={{
          transform: `rotateX(${rotateX * 0.5}deg) rotateY(${rotateY * 0.5}deg)`,
          transformOrigin: 'center center',
          transition: 'transform 0.1s ease-out',
        }}
      />

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
