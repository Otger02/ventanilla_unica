import Link from "next/link";
import { MessageSquare, ShieldCheck, Zap } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <main className="w-full max-w-2xl rounded-xl border border-border bg-surface p-10 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Zap className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Ventanilla Unica
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
            Experimenta el sistema de auto-gestion inteligente. Una aplicacion equipada con IA, Next.js y Supabase para automatizar el ciclo de tus facturas y tributos.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-lg grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col items-center rounded-xl bg-surface-secondary p-5 text-center">
            <MessageSquare className="mb-3 h-6 w-6 text-muted" />
            <h3 className="text-sm font-semibold text-foreground">Chatbook AI</h3>
            <p className="mt-1 text-xs text-muted text-balance">
              Habla directamente con tus datos y facturas en tiempo real.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-surface-secondary p-5 text-center">
            <ShieldCheck className="mb-3 h-6 w-6 text-muted" />
            <h3 className="text-sm font-semibold text-foreground">Seguro y Privado</h3>
            <p className="mt-1 text-xs text-muted text-balance">
              Almacenamiento segregado por RLS mediante en base de datos.
            </p>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/login"
            className="group flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:bg-accent/90 hover:shadow-lg"
          >
            Acceder al Chat
            <MessageSquare className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </main>
    </div>
  );
}
