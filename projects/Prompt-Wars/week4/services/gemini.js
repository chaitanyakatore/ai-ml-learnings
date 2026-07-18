// StadiumPulse AI — Gemini Model Integration Service
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not defined in env. AI features will require fallback values.");
}

const ai = new GoogleGenAI({ apiKey });

/**
 * Standard utility wrapper for Google Gemini generation
 * @param {string} prompt User message/content prompt
 * @param {string} systemInstruction Optional system instruction guidelines
 * @param {boolean} jsonMode Force JSON output mime-type
 * @param {object} schema Structured JSON schema enforcement
 */
export async function callGemini(prompt, systemInstruction = '', jsonMode = false, schema = null) {
  try {
    const config = {
      temperature: 0.2
    };
    
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    
    if (jsonMode) {
      config.responseMimeType = 'application/json';
      if (schema) {
        config.responseJsonSchema = schema;
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: config
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API Service Error:", error);
    throw error;
  }
}
