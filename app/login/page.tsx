import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/chat");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <main className="w-full rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold">Iniciar sesion</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Recibe un Magic Link en tu correo para entrar al chat.
        </p>
        <LoginForm />
      </main>
    </div>
  );
}
