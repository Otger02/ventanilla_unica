import { validateSharedToken } from "@/lib/shared-views/validateToken";
import { fetchOwnerDashboardData } from "@/lib/shared-views/fetchOwnerDashboardData";
import { SharedDashboardView } from "./SharedDashboardView";

export const dynamic = "force-dynamic";

type SharedPageProps = {
  params: Promise<{ token: string }>;
};

const ERROR_MESSAGES = {
  not_found: "Este enlace compartido no existe o ya no es válido.",
  inactive: "Este enlace compartido ha sido desactivado por el propietario.",
  expired: "Este enlace compartido ha expirado.",
} as const;

export default async function SharedViewPage({ params }: SharedPageProps) {
  const { token } = await params;
  const result = await validateSharedToken(token);

  if (!result.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-3">
          <div className="text-4xl">🔒</div>
          <h1 className="text-lg font-semibold text-foreground">Enlace no disponible</h1>
          <p className="text-sm text-muted">{ERROR_MESSAGES[result.reason]}</p>
        </div>
      </div>
    );
  }

  const data = await fetchOwnerDashboardData(result.sharedView.owner_user_id);

  return (
    <SharedDashboardView
      data={data}
      accessMode={result.sharedView.access_mode}
      sharedWithEmail={result.sharedView.shared_with_email}
    />
  );
}
