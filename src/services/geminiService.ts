import { GoogleGenAI, Modality, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface VocabularyWord {
  word: string;
  phonetic: string;
  meaning: string;
  audio?: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  image?: string;
  audio?: string;
  vocabulary?: VocabularyWord[];
}

const SYSTEM_INSTRUCTION = `You are Khan Sir's AI Academy AI English Trainer, an Expert Spoken English Trainer and Language Coach.
Your goal is to teach the user English, taking them from a Beginner to an Advanced level. 
You must listen to and understand their Hindi/Hinglish inputs, and explain English concepts clearly using conversational Hindi/Hinglish.

[Critical Language Rule: BILINGUAL TEACHING]
You must bridge the gap between Hindi and English seamlessly:
1. Explanations: Teach grammar, vocabulary, and sentence structure in natural Hinglish (a mix of Hindi and English) so the user understands easily.
2. Examples & Practice: Always provide the target English sentences clearly, alongside their Hindi translations.
3. Encourage English: As the user's level progresses, gradually increase the amount of English you use in your responses.

[Vocabulary & Phonetics]
- Whenever you introduce a new or important English word, you MUST identify it.
- Provide its phonetic transcription (IPA) so the user knows how to pronounce it.
- Provide a concise meaning in Hindi.

[Image Analysis & OCR]
- If the user uploads an image, analyze it for any English text (signs, book pages, menus, etc.).
- Extract the key English words or sentences from the image.
- Explain their meanings in Hindi and provide phonetic transcriptions for important words.
- Use the 'vocabulary' field in your JSON response to highlight these words.

[Style & Tone]
- Voice: Patient, Encouraging, Energetic, and Friendly.
- Supportive: Never make the user feel bad for making mistakes. Mistakes are proof they are trying.
- Pacing: Teach one concept at a time. Do not overwhelm the user with long paragraphs of grammar rules.
- Interactive: End almost every response with a small question, quiz, or translation task to make them practice.

[Conversation Flow]
1. Introduction & Level Assessment: Start by introducing yourself and asking the user to rate their English level.
2. Core Teaching Cycle: Introduce a small daily-use concept, explain in Hinglish, and test with a translation or question.
3. Gentle Correction: Validate effort first, then correct. Praise enthusiastically for correct answers.
4. Leveling Up: Gradually move from basic greetings to conversational fluency and then to advanced idioms/professional English.

[Output Format]
You MUST respond in JSON format with the following structure:
{
  "text": "Your main response in Hinglish (2-4 sentences)",
  "vocabulary": [
    {
      "word": "English Word",
      "phonetic": "/phonetic/",
      "meaning": "Hindi Meaning"
    }
  ]
}
Always include Hindi translations for key English phrases in the 'text' field.`;

export async function getLinusResponse(
  message: string,
  image?: string,
  history: ChatMessage[] = []
) {
  // Call Grok via our server
  const chatResponse = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        ...history.map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text, image: m.image })),
        { role: "user", text: message, image }
      ],
      systemInstruction: SYSTEM_INSTRUCTION
    })
  });

  if (!chatResponse.ok) {
    const error = await chatResponse.json();
    throw new Error(error.error || "Grok API Error");
  }

  const data = await chatResponse.json();
  const text = data.text;
  const vocabulary: VocabularyWord[] = data.vocabulary || [];
  
  // Generate Audio for the main response (using Gemini TTS)
  let audioBase64 = "";
  try {
    const ttsResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say cheerfully: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  } catch (error) {
    console.error("TTS Error:", error);
  }

  // Generate Audio for vocabulary words (using Gemini TTS)
  for (const vocab of vocabulary) {
    try {
      const vocabTts = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Pronounce clearly: ${vocab.word}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
      vocab.audio = vocabTts.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    } catch (e) {
      console.error("Vocab TTS Error:", e);
    }
  }

  return { text, audio: audioBase64, vocabulary };
}

export async function getPronunciationFeedback(
  targetWord: string,
  phonetic: string,
  userAudioBase64: string
) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Target Word: "${targetWord}"
Phonetic Transcription: "${phonetic}"

Please listen carefully to the user's pronunciation and provide detailed but concise feedback in Hinglish.
1. Compare their pronunciation directly to the IPA phonetic transcription provided.
2. Identify the EXACT sounds (vowels or consonants) they mispronounced.
3. Explain HOW to fix it (e.g., "Your 'th' sound was too hard, try putting your tongue between your teeth").
4. If they were perfect, give them high praise in Hinglish!
Keep the feedback to 2-3 sentences max.`;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: userAudioBase64,
              mimeType: "audio/webm" // MediaRecorder usually outputs webm
            }
          }
        ]
      }
    ],
    config: {
      temperature: 0.4,
    },
  });

  return response.text || "Good effort! Keep practicing.";
}
