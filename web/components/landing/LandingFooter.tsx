'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const RANDOM_EMOJIS = [
  "❤️", "💙", "💚", "💛", "💜", "🧡",
  "✨", "🌟", "⭐", "💫", "🌈",
  "🔥", "⚡", "💥", "🚀",
  "🎨", "🎭", "🎪", "🎯",
  "🦉", "🦆", "🐧", "🦜",
  "☕", "🍕", "🌮", "🍔",
  "🎵", "🎸", "🎹", "🎤",
  "💻", "🖥️", "⌨️", "🖱️",
  "🎲", "🎮", "🕹️",
  "🌙", "☀️", "⛅", "🌤️",
];

export function LandingFooter() {
  const [emoji, setEmoji] = useState("❤️");

  useEffect(() => {
    const randomEmoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
    setEmoji(randomEmoji);
  }, []);

  return (
    <footer className="border-t border-border/50 bg-card/30">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          {/* Logo and tagline */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/owlette-icon.png"
                alt="Owlette"
                width={28}
                height={28}
              />
              <span className="text-lg font-semibold">Owlette</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Always watching. Always ready.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-8 text-sm">
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms of Service
            </Link>
            <a
              href="mailto:support@owlette.app"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact
            </a>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t border-border/30 text-center">
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
            <span>&copy; 2026</span>
            <a
              href="https://tec.design"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              TEC
            </a>
            <span className="mx-2">·</span>
            <span>Made with</span>
            <span className="text-base leading-none">{emoji}</span>
            <span>in California</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
