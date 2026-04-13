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
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center bg-background px-4">
      <main className="w-full rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Iniciar sesion</h1>
        <p className="mt-2 text-sm text-muted">
          Recibe un Magic Link en tu correo para entrar al chat.
        </p>
        <LoginForm />
      </main>
    </div>
  );
}
