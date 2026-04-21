const fs = require('fs');

const content = fs.readFileSync('app/chat/chat-client.tsx', 'utf8');

// Find the last return (
const matches = [...content.matchAll(/  return \([\s]*<PageShell/g)];
if (matches.length === 0) {
  console.log("Could not find the return statement");  
  process.exit(1);
}

const returnStart = matches[matches.length - 1].index;


const beforeReturn = content.substring(0, returnStart);

let pStart = content.indexOf('title="Perfil fiscal"');
let pSectionStart = content.lastIndexOf('<SectionCard', pStart);
let pSectionEnd = content.indexOf('</SectionCard>', pStart) + '</SectionCard>'.length;
const sectionProfile = content.substring(pSectionStart, pSectionEnd);

let mStart = content.indexOf('title="Operación Mensual Estimada"');
let mSectionStart = content.lastIndexOf('<SectionCard', mStart);
let mSectionEnd = content.indexOf('</SectionCard>', mStart) + '</SectionCard>'.length;
const sectionMensual = content.substring(mSectionStart, mSectionEnd);


let fStart = content.indexOf('title="Facturas"');
let fSectionStart = content.lastIndexOf('<SectionCard', fStart);
let fSectionInnerStart = content.indexOf('>', fSectionStart) + 1;
// This part could be problematic if there's a nested SectionCard, but there isn't.
let fSectionEnd = content.indexOf('</SectionCard>', fStart);
let facturasInnerContent = content.substring(fSectionInnerStart, fSectionEnd);

facturasInnerContent = facturasInnerContent.replace('{demoMode ? (', '{/* DEMO MODE CHECKS */}\\n{demoMode ? (');

const rightColFacturas = `
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-950 shadow-sm relative">
                <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Facturas Pendientes</h3>
                  <Button type="button" variant="outline" size="sm" onClick={handleInvoicePickerClick} disabled={isUploadingInvoice}>
                    {isUploadingInvoice ? "Subiendo..." : "Añadir"}
                  </Button>
                </div>
${facturasInnerContent}
              </div>
            </div>
`;

// Extract Chat Bubble mapping which is quite long
const chatStart = content.indexOf('<ul className="space-y-3">');
const chatEnd = content.indexOf('</ul>', chatStart) + 5;
const chatContent = content.substring(chatStart, chatEnd);

const newReturn = `  return (
    <PageShell className="!h-[100dvh] flex flex-col overflow-hidden !px-0 !py-0 sm:!px-0 !max-w-none">
      {/* Header de Identidad (Top Bar) */}
      <div className="flex-none bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 md:px-6 py-3 flex items-center justify-between z-50 shadow-sm relative">
        <div>
          {entityName && entityNit ? (
            <>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{entityName}</h1>
              <p className="text-xs md:text-sm font-medium text-zinc-500 dark:text-zinc-400">
                NIT: {entityNit} {isEsal ? " | ESAL" : ""}
              </p>
            </>
          ) : (
            <div className="animate-pulse flex flex-col gap-1.5">
               <div className="h-6 w-64 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
               <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
            </div>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <div className="hidden sm:inline-flex items-center justify-center px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-full border border-emerald-200 dark:border-emerald-800">
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Perfil Activo
          </div>
          {!demoMode ? (
            <Button
              type="button"
              onClick={handleSignOut}
              variant="outline"
              size="sm"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Cerrando..." : "Cerrar sesión"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Main Workspace Layout (2 Columnas) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-0 lg:gap-6 p-0 lg:p-6 min-h-0 bg-zinc-50/40 dark:bg-black/20">
        
        {/* Mobile Tabs */}
        <div className="col-span-1 lg:hidden flex-none px-4 pt-4">
          <Tabs
            value={mobileTab}
            onChange={(value) => setMobileTab(value as "chat" | "datos")}
            items={[
              { value: "chat", label: "Chat" },
              { value: "datos", label: "Tablero de Acción" },
            ]}
          />
        </div>

        {/* Columna Izquierda: Chat y Drag & Drop (60% - lg:col-span-3) */}
        <div 
          className={\`\${mobileTab === "chat" ? "flex" : "hidden"} m-4 space-y-0 lg:m-0 lg:col-span-3 lg:flex flex-col relative min-h-0 bg-white dark:bg-zinc-900/80 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden\`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
             <div className="absolute inset-0 z-50 bg-blue-50/90 dark:bg-blue-900/20 backdrop-blur-[2px] border-2 border-dashed border-blue-500 flex items-center justify-center rounded-xl transition-all">
               <div className="bg-white dark:bg-zinc-900 px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center border border-blue-100 dark:border-blue-800">
                 <FileText className="h-12 w-12 text-blue-600 dark:text-blue-400 mb-3 animate-bounce" />
                 <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Suelta tu factura o recibo aquí</p>
                 <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">Archivos PDF, PNG, JPG aceptados</p>
               </div>
             </div>
          )}

          <div className="flex-none px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">Asistente Virtual (CFO)</h2>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5">Haz consultas o arrastra documentos al panel.</p>
            </div>
            {demoMode ? (
              <span className="rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
                DEMO MODE
              </span>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-5 flex flex-col custom-scrollbar">
            {showDemoDebug ? (
              <div className="mb-4 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 shrink-0">
                DEMO DEBUG → process.env.DEMO_MODE: {demoModeRawEnv} | demoMode(): {String(demoMode)}
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-80">
                 <p className="text-[14px] text-zinc-500 dark:text-zinc-400 max-w-[280px]">
                   Hola, soy tu CFO virtual. Tráeme tus dudas tributarias o suelta una factura aquí para empezar.
                 </p>
              </div>
            ) : (
              ${chatContent}
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex-none p-4 pb-5 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/80">
            {messages.length === 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Sugerencias rápidas</p>
                <div className="flex flex-wrap gap-2">
                  {exampleQuestions.map((q) => (
                    <button key={q} type="button" onClick={() => void sendMessage(q)} disabled={isSending} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-[5px] text-[12px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2 relative">
               <input
                 value={input}
                 onChange={(event) => setInput(event.target.value)}
                 placeholder="Escribe tu mensaje..."
                 className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-[14px] text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 shadow-sm transition-all"
                 disabled={isSending}
               />
               <Button type="submit" variant="primary" size="md" disabled={isSending} className="px-6 rounded-lg font-medium">
                 Enviar
               </Button>
            </form>
          </div>
        </div>

        {/* Columna Derecha: Tablero de Acción (40% - lg:col-span-2) */}
        <div className={\`\${mobileTab === "datos" ? "flex" : "hidden"} px-4 lg:px-0 lg:col-span-2 lg:flex flex-col min-h-0 overflow-y-auto pb-10 custom-scrollbar\`}>
          
          <div className="mb-4">
            <TaxTimeline />
          </div>
          
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3 px-1">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-1.5 rounded-md">
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                Bandeja de Acciones
              </h2>
              ${rightColFacturas}
            </div>

            <div className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-6">
               <details className="group border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-sm bg-white dark:bg-zinc-900 overflow-hidden">
                 <summary className="font-semibold text-[14px] cursor-pointer list-none flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors px-5 py-4">
                   Ficha Fiscal & Estimación
                   <span className="transition duration-300 group-open:-rotate-180">
                     <svg fill="none" height="20" shape-rendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="20"><path d="M6 9l6 6 6-6"></path></svg>
                   </span>
                 </summary>
                 <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 space-y-6">
                    <div>
                       <h3 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-200 mb-3">Provisión estimada al cierre de mes</h3>
                       {!isLoadingEstimate && estimate ? (
                          <div className="space-y-2.5 text-[14px] bg-zinc-50/50 dark:bg-zinc-950/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-zinc-600 dark:text-zinc-400">Total provisión</span>
                              <span className="font-semibold">{formatCop(estimate.totalProvision)}</span>
                            </div>
                            <div className="flex items-center justify-between opacity-80 text-[13px]">
                              <span className="text-zinc-500">IVA</span>
                              <span>{formatCop(estimate.ivaProvision)}</span>
                            </div>
                            <div className="flex items-center justify-between opacity-80 text-[13px] text-zinc-500">
                              <span className="text-zinc-500">Renta</span>
                              <span>{formatCop(estimate.rentaProvision)}</span>
                            </div>
                            <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800 my-2"></div>
                            <div className="flex items-center justify-between font-semibold">
                              <span>Caja post-provisión</span>
                              <span className={estimate.cashAfterProvision < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>{formatCop(estimate.cashAfterProvision)}</span>
                            </div>
                          </div>
                       ) : <p className="text-[13px] text-zinc-500">Cargando estimador...</p>}
                    </div>
                    
                    ${sectionProfile}
                    ${sectionMensual}
                    
                    <div className="pt-2">
                      <Button type="button" onClick={handleSaveTaxData} variant="primary" size="md" className="w-full font-medium" disabled={isLoadingTaxData || isSavingTaxData}>
                        {isSavingTaxData ? "Guardando..." : "Guardar Ficha Fiscal"}
                      </Button>
                    </div>
                 </div>
               </details>
            </div>
          </div>

        </div>
      </div>
    </PageShell>
  );
}
`;

fs.writeFileSync('app/chat/chat-client.tsx', beforeReturn + newReturn);
console.log("SUCCESS!");
