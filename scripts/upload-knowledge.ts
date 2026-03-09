// scripts/upload-knowledge.ts
import { GoogleAIFileManager } from "@google/generative-ai/server";
import dotenv from "dotenv";
import path from "path";

// Cargar variables de entorno (.env)
dotenv.config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ FALTA GEMINI_API_KEY en .env.local");
  process.exit(1);
}

const fileManager = new GoogleAIFileManager(apiKey);
const docsDir = path.join(process.cwd(), "tax-docs");

// Lista de archivos a subir
const filesToUpload = [
  { name: "estatuto-tributario-2025.pdf", displayName: "Estatuto Tributario Nacional Colombia" },
  { name: "ley-2277-reforma.pdf", displayName: "Ley 2277 de 2022 (Reforma Tributaria)" },
  { name: "calendario-tributario-2026.pdf", displayName: "Calendario Tributario DIAN 2026" },
];

async function uploadDocs() {
  console.log("🚀 Iniciando carga de conocimiento legal a Gemini...");

  for (const file of filesToUpload) {
    const filePath = path.join(docsDir, file.name);
    console.log(`📤 Subiendo: ${file.displayName}...`);

    try {
      const uploadResponse = await fileManager.uploadFile(filePath, {
        mimeType: "application/pdf",
        displayName: file.displayName,
      });

      console.log(`✅ Subido con éxito! URI: ${uploadResponse.file.uri}`);
      console.log(`   Nombre interno: ${uploadResponse.file.name}`);
      
      // Esperar a que Google lo procese (ACTIVE state)
      let state = uploadResponse.file.state;
      while (state === "PROCESSING") {
        process.stdout.write(".");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const check = await fileManager.getFile(uploadResponse.file.name);
        state = check.state;
      }
      console.log(`\n   Estado final: ${state}`);

    } catch (error: any) {
      console.error(`🔥 Error subiendo ${file.name}:`, error.message);
    }
  }
  
  console.log("\n🎉 Carga completada. Guarda las URIs anteriores, las necesitaremos para el chat.");
}

uploadDocs();