import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

dotenv.config({ path: envPath });

if (!process.env.GROQ_API_KEY && process.env.GROQ_KEY) {
  process.env.GROQ_API_KEY = process.env.GROQ_KEY;
}

if (!process.env.GROQ_KEY && process.env.GROQ_API_KEY) {
  process.env.GROQ_KEY = process.env.GROQ_API_KEY;
}
