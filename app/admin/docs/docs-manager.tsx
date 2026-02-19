"use client";

import { FormEvent, useEffect, useState } from "react";

type DocumentItem = {
  id: string;
  title: string;
  category: "tax" | "deductions" | "hiring" | "finance";
  storage_path: string;
  created_at: string;
};

const categoryOptions: Array<DocumentItem["category"]> = [
  "tax",
  "deductions",
  "hiring",
  "finance",
];

export function DocsManager() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentItem["category"]>("tax");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDocuments() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/documents", { method: "GET" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudieron cargar documentos.");
      }

      setDocuments(data.documents ?? []);
    } catch {
      setError("No se pudieron cargar documentos.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !file) {
      setError("Completa titulo, categoria y archivo PDF.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("category", category);
      formData.append("file", file);

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo subir el documento.");
      }

      setTitle("");
      setCategory("tax");
      setFile(null);
      await loadDocuments();
    } catch {
      setError("No se pudo subir el documento.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Administrar documentos</h1>

      <form
        onSubmit={handleSubmit}
        className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Titulo del documento"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isUploading}
          />
          <label className="sr-only" htmlFor="document-category">
            Categoria
          </label>
          <select
            id="document-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as DocumentItem["category"])}
            title="Categoria"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isUploading}
          >
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <label className="sr-only" htmlFor="document-file">
          Archivo PDF
        </label>
        <input
          id="document-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          title="Archivo PDF"
          className="mt-3 block w-full text-sm"
          disabled={isUploading}
        />

        <button
          type="submit"
          className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          disabled={isUploading}
        >
          {isUploading ? "Subiendo..." : "Subir PDF"}
        </button>

        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </form>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-medium">Documentos</h2>

        {isLoading ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Cargando...</p>
        ) : documents.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            No hay documentos cargados.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {documents.map((documentItem) => (
              <li
                key={documentItem.id}
                className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">{documentItem.title}</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Categoria: {documentItem.category}
                </p>
                <p className="break-all text-zinc-600 dark:text-zinc-400">
                  Storage: {documentItem.storage_path}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
