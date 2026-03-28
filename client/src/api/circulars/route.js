import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

function formatDate(dateValue) {
  if (!dateValue) return "Unknown date";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function normalizeCategory(type) {
  if (!type || typeof type !== "string") return "Circular";
  return type.trim();
}

export async function GET() {
  const structuredDir = path.resolve(process.cwd(), "../server/src/structured");

  try {
    const files = await fs.readdir(structuredDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const parsedCirculars = await Promise.all(
      jsonFiles.map(async (fileName) => {
        try {
          const filePath = path.join(structuredDir, fileName);
          const content = await fs.readFile(filePath, "utf8");
          const parsed = JSON.parse(content);

          const circular = parsed?.circular ?? {};
          const obligations = Array.isArray(parsed?.obligations) ? parsed.obligations : [];

          const fallbackId = fileName.replace(/\.json$/, "");
          const rawDate = typeof circular.date === "string" ? circular.date : null;
          const sortDate = rawDate ? new Date(rawDate).getTime() : 0;

          return {
            id: circular.id || fallbackId,
            ref: circular.circular_number || circular.id || fallbackId,
            date: formatDate(rawDate),
            category: normalizeCategory(circular.type),
            title: circular.title || fallbackId.replaceAll("-", " "),
            summary: circular.summary || "No summary available.",
            obligations: obligations.length,
            obligationItems: obligations.map((obligation, index) => ({
              id: `${fallbackId}-${index}`,
              text: obligation?.plain_english || obligation?.text || "Obligation detail not available.",
              frequency: obligation?.frequency || "Ongoing",
              sourceClause: obligation?.source_clause || "N/A",
            })),
            topic: circular.topic || "General",
            status: circular.status || "Unknown",
            sortDate: Number.isNaN(sortDate) ? 0 : sortDate,
          };
        } catch {
          return null;
        }
      })
    );

    const circulars = parsedCirculars
      .filter((item) => item !== null)
      .sort((a, b) => b.sortDate - a.sortDate)
      .map(({ sortDate, ...rest }) => rest);

    return NextResponse.json({ circulars });
  } catch (error) {
    return NextResponse.json(
      {
        circulars: [],
        error: error instanceof Error ? error.message : "Failed to load circulars",
      },
      { status: 500 }
    );
  }
}
