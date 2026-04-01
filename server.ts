import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.env?.url || import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "",
    baseURL: "https://api.groq.com/openai/v1",
  });

  // Groq Chat Endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, systemInstruction } = req.body;
      
      if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY is not set in environment variables." });
      }

      const hasImage = messages.some((m: any) => m.image);
      const model = hasImage ? "llama-3.2-90b-vision-preview" : "llama-3.3-70b-versatile";

      // Format messages for Groq (OpenAI compatible)
      const formattedMessages = [
        { role: "system", content: systemInstruction },
        ...messages.map((m: any) => {
          if (m.image) {
            return {
              role: m.role,
              content: [
                { type: "text", text: m.text || "Analyze this image" },
                { type: "image_url", image_url: { url: m.image } }
              ]
            };
          }
          return { role: m.role, content: m.text };
        })
      ];

      const response = await groq.chat.completions.create({
        model, 
        messages: formattedMessages as any,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      res.json(JSON.parse(content || "{}"));
    } catch (error: any) {
      console.error("Groq API Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
