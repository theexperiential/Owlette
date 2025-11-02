import { Heart } from "lucide-react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 w-full bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pt-8 pb-6 z-10 pointer-events-none">
      <div className="container mx-auto px-4 pointer-events-auto">
        <p className="text-center text-xs text-slate-500">
          Made with{" "}
          <Heart className="inline-block h-3 w-3 text-red-500 fill-red-500" />{" "}
          in California by{" "}
          <Link
            href="https://tec.design"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-300 hover:underline transition-colors"
          >
            TEC
          </Link>
        </p>
      </div>
    </footer>
  );
}
