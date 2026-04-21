"use client";

import { useState } from "react";

type Tab = "dashboard" | "chat";

const LR_RED = "#E8001C";
const LR_BLACK = "#000000";
const LR_WHITE = "#FFFFFF";
const LR_GRAY_BG = "#F5F5F5";
const LR_GRAY_BORDER = "#DDDDDD";
const LR_PURPLE = "#6B2D8B";
const LR_DARK_NAV = "#1A1A1A";

const TICKER_TEXT =
  "TRM HOY  $ 4.187,50  |  COLCAP  2.281,86  −0,23%  |  PETRÓLEO WTI  US$ 92,13  +3,81%  |  CAFÉ COLOMBIAN MILDS  US$ 3,32  +1,22%  |  TASA DE USURA  26,76%  |  IBR  9,856%  |  TRM HOY  $ 4.187,50  |  COLCAP  2.281,86  −0,23%  |  PETRÓLEO WTI  US$ 92,13  +3,81%  |  CAFÉ COLOMBIAN MILDS  US$ 3,32  +1,22%  |  TASA DE USURA  26,76%  |  IBR  9,856%";

const NAV_ITEMS = [
  "FINANZAS",
  "ECONOMÍA",
  "EMPRESAS",
  "OCIO",
  "GLOBOECONOMÍA",
  "AGRONEGOCIOS",
  "ANÁLISIS",
  "ASUNTOS LEGALES",
  "CAJA FUERTE",
  "INDICADORES",
];

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const iframeSrc = activeTab === "dashboard" ? "/dashboard" : "/chat";

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        backgroundColor: LR_GRAY_BG,
        minHeight: "100vh",
        minWidth: "1280px",
      }}
    >
      {/* ── Global styles ─────────────────────────────────────── */}
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .lr-marquee {
          display: flex;
          width: max-content;
          animation: marquee 40s linear infinite;
          white-space: nowrap;
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
        .live-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${LR_RED};
          animation: livePulse 1.4s ease-in-out infinite;
          margin-right: 6px;
          flex-shrink: 0;
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════
          1. TOP TICKER BAR
         ══════════════════════════════════════════════════════════ */}
      <div
        style={{
          background: LR_BLACK,
          color: LR_WHITE,
          height: "30px",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          fontSize: "11px",
          letterSpacing: "0.04em",
        }}
      >
        <div
          style={{
            background: LR_RED,
            color: LR_WHITE,
            padding: "0 10px",
            height: "100%",
            display: "flex",
            alignItems: "center",
            fontWeight: 700,
            fontSize: "10px",
            flexShrink: 0,
            letterSpacing: "0.08em",
          }}
        >
          MERCADOS
        </div>
        <div style={{ overflow: "hidden", flex: 1 }}>
          <div className="lr-marquee">
            <span style={{ paddingRight: "80px" }}>{TICKER_TEXT}</span>
            <span style={{ paddingRight: "80px" }}>{TICKER_TEXT}</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          2. MAIN HEADER
         ══════════════════════════════════════════════════════════ */}
      <header
        style={{
          background: LR_WHITE,
          borderBottom: `3px solid ${LR_RED}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Left — logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              background: LR_RED,
              color: LR_WHITE,
              fontWeight: 900,
              fontSize: "28px",
              padding: "6px 12px",
              lineHeight: 1,
              fontFamily: "Georgia, serif",
            }}
          >
            LR
          </div>
          <div>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 700,
                fontSize: "22px",
                color: LR_BLACK,
                lineHeight: 1.1,
              }}
            >
              LA REPÚBLICA
            </div>
            <div
              style={{
                fontSize: "9px",
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginTop: "2px",
              }}
            >
              DIARIO ECONÓMICO, EMPRESARIAL Y FINANCIERO DE COLOMBIA
            </div>
          </div>
        </div>

        {/* Right — subscribe + date */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", color: "#888" }}>
              MARTES, 21 DE ABRIL DE 2026
            </div>
            <div style={{ fontSize: "10px", color: "#aaa" }}>
              Edición digital
            </div>
          </div>
          <button
            style={{
              background: LR_RED,
              color: LR_WHITE,
              border: "none",
              padding: "10px 20px",
              fontWeight: 700,
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            SUSCRÍBASE
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          3. NAVIGATION BAR
         ══════════════════════════════════════════════════════════ */}
      <nav
        style={{
          background: LR_RED,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: "0",
          overflowX: "hidden",
        }}
      >
        {NAV_ITEMS.map((item) => (
          <div
            key={item}
            style={{
              color: LR_WHITE,
              fontWeight: 700,
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "10px 13px",
              cursor: "default",
              borderRight: "1px solid rgba(255,255,255,0.2)",
              whiteSpace: "nowrap",
            }}
          >
            {item}
          </div>
        ))}

        {/* Highlighted — HERRAMIENTAS IA */}
        <div
          style={{
            color: LR_WHITE,
            fontWeight: 700,
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "10px 13px",
            cursor: "default",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          HERRAMIENTAS IA
          <span
            style={{
              background: LR_BLACK,
              color: LR_WHITE,
              fontSize: "8px",
              fontWeight: 900,
              padding: "1px 5px",
              letterSpacing: "0.06em",
            }}
          >
            NUEVO
          </span>
        </div>
      </nav>

      {/* ══════════════════════════════════════════════════════════
          4. SECTION BANNER
         ══════════════════════════════════════════════════════════ */}
      <div
        style={{
          background: LR_WHITE,
          padding: "20px 24px",
          borderBottom: `1px solid ${LR_GRAY_BORDER}`,
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          {/* Left decorator */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
            <span style={{ color: LR_PURPLE, fontSize: "10px" }}>■</span>
            <div style={{ flex: 1, height: "1px", background: LR_GRAY_BORDER }} />
            <span style={{ color: LR_PURPLE, fontSize: "10px" }}>■</span>
          </div>

          {/* Title */}
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 700,
                fontSize: "20px",
                textTransform: "uppercase",
                color: LR_BLACK,
                letterSpacing: "0.05em",
              }}
            >
              GESTIÓN EMPRESARIAL
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#777",
                fontStyle: "italic",
                marginTop: "3px",
              }}
            >
              Herramientas de inteligencia artificial para su empresa
            </div>
          </div>

          {/* Right decorator */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
            <span style={{ color: LR_PURPLE, fontSize: "10px" }}>■</span>
            <div style={{ flex: 1, height: "1px", background: LR_GRAY_BORDER }} />
            <span style={{ color: LR_PURPLE, fontSize: "10px" }}>■</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          5. DEMO CONTENT AREA
         ══════════════════════════════════════════════════════════ */}
      <main
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "24px",
          display: "flex",
          gap: "24px",
          alignItems: "flex-start",
        }}
      >
        {/* ── LEFT COLUMN (65%) ───────────────────────────────── */}
        <div style={{ flex: "0 0 65%", maxWidth: "65%" }}>
          {/* Label */}
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: LR_RED,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "8px",
            }}
          >
            SOLUCIÓN TECNOLÓGICA
          </div>

          {/* Main card */}
          <div
            style={{
              background: LR_WHITE,
              boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
              borderTop: `4px solid ${LR_RED}`,
            }}
          >
            {/* Card header */}
            <div style={{ padding: "16px 20px 12px" }}>
              <div
                style={{
                  fontFamily: "Georgia, serif",
                  fontWeight: 700,
                  fontSize: "20px",
                  color: LR_BLACK,
                  lineHeight: 1.3,
                }}
              >
                Ventanilla Única — Copiloto Financiero y Tributario
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#666",
                  marginTop: "6px",
                  lineHeight: 1.5,
                }}
              >
                Tecnología para gestionar facturas, IVA, retenciones y flujo de caja en tiempo real
              </div>
            </div>

            {/* Tab switcher */}
            <div
              style={{
                display: "flex",
                borderTop: `1px solid ${LR_GRAY_BORDER}`,
                borderBottom: `1px solid ${LR_GRAY_BORDER}`,
              }}
            >
              {(
                [
                  { id: "dashboard" as Tab, label: "PANEL DE CONTROL" },
                  { id: "chat" as Tab, label: "ASISTENTE FINANCIERO" },
                ] as { id: Tab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.08em",
                    cursor: "pointer",
                    border: "none",
                    borderBottom:
                      activeTab === tab.id
                        ? `3px solid ${LR_RED}`
                        : "3px solid transparent",
                    background:
                      activeTab === tab.id ? LR_WHITE : LR_GRAY_BG,
                    color: activeTab === tab.id ? LR_RED : "#666",
                    transition: "all 0.15s",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Iframe */}
            <iframe
              src={iframeSrc}
              style={{
                width: "100%",
                height: "600px",
                border: "none",
                display: "block",
              }}
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          </div>
        </div>

        {/* ── RIGHT COLUMN (33%) ──────────────────────────────── */}
        <div style={{ flex: "0 0 33%", maxWidth: "33%", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Widget 1 — EN VIVO */}
          <div
            style={{
              background: LR_WHITE,
              border: `1px solid ${LR_GRAY_BORDER}`,
              padding: "16px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "10px",
              }}
            >
              <span className="live-dot" />
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 900,
                  color: LR_RED,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                EN VIVO
              </span>
            </div>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 700,
                fontSize: "15px",
                color: LR_BLACK,
                lineHeight: 1.4,
                marginBottom: "10px",
              }}
            >
              Análisis en tiempo real de su portafolio de facturas
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#444",
                lineHeight: 1.6,
                marginBottom: "10px",
              }}
            >
              Ventanilla Única detecta automáticamente facturas vencidas,
              calcula su exposición al IVA y genera un plan de acción
              semanal personalizado.
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#888",
                fontStyle: "italic",
                borderTop: `1px solid ${LR_GRAY_BORDER}`,
                paddingTop: "8px",
              }}
            >
              Powered by IA — Motor determinístico + Gemini
            </div>
          </div>

          {/* Widget 2 — LO MÁS LEÍDO / FUNCIONALIDADES */}
          <div
            style={{
              background: LR_GRAY_BG,
              border: `1px solid ${LR_GRAY_BORDER}`,
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 900,
                color: LR_RED,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "12px",
                paddingBottom: "8px",
                borderBottom: `2px solid ${LR_RED}`,
              }}
            >
              FUNCIONALIDADES CLAVE
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {[
                "Priorización automática de pagos por riesgo legal",
                "Cálculo de provisión fiscal mensual (IVA + Renta)",
                "Cola de revisión con nivel de confianza por factura",
                "Plan semanal de caja con escenarios de inacción",
                "Acciones en lote desde el dashboard",
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    gap: "10px",
                    padding: "8px 0",
                    borderBottom: i < 4 ? `1px solid ${LR_GRAY_BORDER}` : "none",
                    fontSize: "12px",
                    color: "#222",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 900,
                      color: LR_RED,
                      fontSize: "13px",
                      flexShrink: 0,
                      minWidth: "16px",
                    }}
                  >
                    {i + 1}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Widget 3 — CTA (red) */}
          <div
            style={{
              background: LR_RED,
              padding: "20px 16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 700,
                fontSize: "15px",
                color: LR_WHITE,
                lineHeight: 1.4,
                marginBottom: "16px",
              }}
            >
              ¿Quiere implementar esta solución en su empresa?
            </div>
            <button
              style={{
                background: LR_WHITE,
                color: LR_RED,
                border: "none",
                padding: "12px 24px",
                fontWeight: 900,
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: "pointer",
                width: "100%",
              }}
            >
              SOLICITAR DEMO
            </button>
          </div>

        </div>
      </main>

      {/* ══════════════════════════════════════════════════════════
          6. FOOTER
         ══════════════════════════════════════════════════════════ */}
      <footer
        style={{
          background: LR_DARK_NAV,
          color: LR_WHITE,
          padding: "14px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
          marginTop: "40px",
        }}
      >
        <span style={{ color: "#aaa" }}>
          LA REPÚBLICA © 2026 — Todos los derechos reservados
        </span>
        <span style={{ color: "#aaa" }}>larepublica.co</span>
      </footer>
    </div>
  );
}
