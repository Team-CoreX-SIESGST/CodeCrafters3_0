// Backend URLs (used by Next.js API routes when proxying; server-side only)
export const SERVER_URL = process.env.NEXT_PUBLIC_GRAPH_API_URL || "http://localhost:5002";
export const SERVER_URL_1 = process.env.LUNA_API_URL || process.env.NEXT_PUBLIC_LUNA_API_URL || "http://localhost:5001";