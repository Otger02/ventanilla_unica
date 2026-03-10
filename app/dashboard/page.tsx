"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";

// Mock data (temporary until 'ventas/ingresos' table is implemented)
const mockData = [
  { month: "Ene", Ingresos: 45000000, Egresos: 32000000 },
  { month: "Feb", Ingresos: 52000000, Egresos: 38000000 },
  { month: "Mar", Ingresos: 48000000, Egresos: 35000000 },
  { month: "Abr", Ingresos: 61000000, Egresos: 41000000 },
  { month: "May", Ingresos: 59000000, Egresos: 39000000 },
  { month: "Jun", Ingresos: 65000000, Egresos: 43000000 },
];

export default function DashboardPage() {
  const [isRegistrando, setIsRegistrando] = useState(false);

  // KPIs calculations
  const totalIngresos = mockData.reduce((acc, curr) => acc + curr.Ingresos, 0);
  const totalEgresos = mockData.reduce((acc, curr) => acc + curr.Egresos, 0);
  const flujoNeto = totalIngresos - totalEgresos;

  const formatCOP = (value: number) => {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <PageShell className="!h-[100dvh] flex flex-col overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex-none bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/chat">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> 
              Volver al Chat
            </Button>
          </Link>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Resumen Financiero
          </h1>
        </div>
        <div>
          <Button 
            onClick={() => setIsRegistrando(true)}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
          >
            <Plus className="w-4 h-4" /> 
            Registrar Ingreso
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 md:p-8 space-y-8 max-w-7xl mx-auto w-full">
        
        {/* Row 1: KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Ingresos Totales (YTD)</h3>
              <div className="bg-emerald-100 dark:bg-emerald-900/40 p-2 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatCOP(totalIngresos)}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Egresos Totales (YTD)</h3>
              <div className="bg-red-100 dark:bg-red-900/40 p-2 rounded-lg">
                <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatCOP(totalEgresos)}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Flujo de Caja Neto</h3>
              <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg">
                <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatCOP(flujoNeto)}
            </div>
          </div>
        </div>

        {/* Row 2: Chart */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm h-[450px] flex flex-col">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
            Evolución: Ingresos vs Egresos
          </h2>
          <div className="flex-1 min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={mockData}
                margin={{
                  top: 5,
                  right: 30,
                  left: 20,
                  bottom: 5,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#52525b" opacity={0.2} />
                <XAxis 
                  dataKey="month" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#71717a' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#71717a' }}
                  tickFormatter={(value) => String(value / 1000000) + "M"}
                />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e4e4e7',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' 
                  }}
                  formatter={(value: any) => formatCOP(Number(value) || 0)}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Bar 
                  dataKey="Ingresos" 
                  fill="#10b981" 
                  radius={[4, 4, 0, 0]} 
                  maxBarSize={40}
                />
                <Bar 
                  dataKey="Egresos" 
                  fill="#ef4444" 
                  radius={[4, 4, 0, 0]} 
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </PageShell>
  );
}