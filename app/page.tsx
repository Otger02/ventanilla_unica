import Link from "next/link";
import { MessageSquare, ShieldCheck, Zap } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <main className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-10 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Zap className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Ventanilla Unica
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Experimenta el sistema de auto-gestion inteligente. Una aplicacion equipada con IA, Next.js y Supabase para automatizar el ciclo de tus facturas y tributos.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-lg grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col items-center rounded-xl bg-zinc-50 p-5 text-center dark:bg-zinc-950/50">
            <MessageSquare className="mb-3 h-6 w-6 text-zinc-500 dark:text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chatbook AI</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 text-balance">
              Habla directamente con tus datos y facturas en tiempo real.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-zinc-50 p-5 text-center dark:bg-zinc-950/50">
            <ShieldCheck className="mb-3 h-6 w-6 text-zinc-500 dark:text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Seguro y Privado</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 text-balance">
              Almacenamiento segregado por RLS mediante en base de datos.
            </p>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/login"
            className="group flex items-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Acceder al Chat
            <MessageSquare className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </main>
    </div>
  );
}
