"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const RANDOM_EMOJIS = [
  "❤️", "💙", "💚", "💛", "💜", "🧡", // hearts
  "✨", "🌟", "⭐", "💫", "🌈", // sparkles
  "🔥", "⚡", "💥", "🚀", // energy
  "🎨", "🎭", "🎪", "🎯", // creative
  "🦉", "🦆", "🐧", "🦜", // birds (owlette!)
  "☕", "🍕", "🌮", "🍔", // food
  "🎵", "🎸", "🎹", "🎤", // music
  "💻", "🖥️", "⌨️", "🖱️", // tech
  "🎲", "🎮", "🕹️", // games
  "🌙", "☀️", "⛅", "🌤️", // weather
  "🤪", "😜", "😝", "🥴", "😵‍💫", "🤡", "🥳", "😎", // goofy faces
  "💨", "🌪️", "💩", "🧻", // wind/farts
  "🦄", "🦖", "🦕", "🐙", "🦑", "🦞", // silly animals
  "🍌", "🥒", "🌽", "🍆", "🥑", "🧀", // funny food
  "🎃", "👻", "💀", "👽", "🤖", "🛸", // spooky/weird
  "🦷", "👀", "👁️", "🧠", "🦴", // body parts (weird!)
  "💯", "🆒", "🤙", "🤘", "✌️", "🫰", // gestures
  "🪐", "🌮", "🦥", "🐢", "🐌", // random fun
];

export function Footer() {
  const [emoji, setEmoji] = useState("❤️");
  const pathname = usePathname();

  useEffect(() => {
    // Pick a random emoji whenever the route changes
    const randomEmoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
    setEmoji(randomEmoji);
  }, [pathname]);

  // Hide footer on admin pages (admin panel has its own footer)
  // Hide footer on landing page (has its own LandingFooter)
  if (pathname?.startsWith('/admin') || pathname === '/') {
    return null;
  }

  return (
    <footer className="fixed bottom-0 left-0 right-0 w-full bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pt-8 pb-6 z-10 pointer-events-none">
      <div className="container mx-auto px-4 pointer-events-auto">
        <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1">
          <span>Made with</span>
          <span className="text-base leading-none -translate-y-0.4">{emoji}</span>
          <span>in California by</span>
          <Link
            href="https://tec.design"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-300 hover:underline transition-colors"
          >
            TEC
          </Link>
        </p>
        <p className="text-center text-xs text-slate-600 mt-2 flex items-center justify-center gap-2">
          <Link
            href="/privacy"
            className="hover:text-slate-400 transition-colors"
          >
            Privacy
          </Link>
          <span>&middot;</span>
          <Link
            href="/terms"
            className="hover:text-slate-400 transition-colors"
          >
            Terms
          </Link>
        </p>
      </div>
    </footer>
  );
}
