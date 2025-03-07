const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const axios = require("axios");
const { PromptTemplate } = require("@langchain/core/prompts");
const beautify = require("js-beautify");
require("dotenv").config();

const app = express();
const PORT = 5000;

// CORS Configuration - Allow requests only from your Vercel frontend
const corsOptions = {
  origin: "https://spear-frontend.vercel.app",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true, // Allow cookies/auth headers if needed
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash"; // Using Gemini 2.0 Flash

// Function to fetch responses from Gemini
async function fetchGeminiResponse(userMessage) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const requestBody = {
    contents: [{ parts: [{ text: userMessage }] }],
  };

  try {
    const response = await axios.post(API_URL, requestBody, {
      headers: { "Content-Type": "application/json" },
    });

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
  } catch (error) {
    console.error("Gemini API Error:", error.response?.data || error.message);
    return "Error: Unable to fetch response from Gemini.";
  }
}

// Coding Prompt for LeftPanel
const codingPrompt = PromptTemplate.fromTemplate(`
  This is the user prompt: "{userprompt}"
  You are a coding engine. Generate **fully executable** HTML, CSS, and JavaScript code.
  Ensure the response is in **valid JSON** format:
  {{
    "HTML Code": "<html code>",
    "CSS Code": "<css code>",
    "JavaScript Code": "<javascript code>"
  }}
`);

app.post("/generate-code", async (req, res) => {
  const { prompt } = req.body;

  try {
    const formattedPrompt = await codingPrompt.format({ userprompt: prompt });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: formattedPrompt }],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const gptResponse = completion.choices[0].message.content.trim();
    let parsedResponse;

    try {
      parsedResponse = JSON.parse(gptResponse);
    } catch (jsonError) {
      console.error("Error parsing JSON from OpenAI:", jsonError);
      return res.status(500).json({ error: "Invalid JSON response from OpenAI" });
    }

    // Format HTML, CSS, and JavaScript using js-beautify
    const formattedHtml = beautify.html(parsedResponse["HTML Code"] || "", { indent_size: 2 });
    const formattedCss = beautify.css(parsedResponse["CSS Code"] || "", { indent_size: 2 });
    const formattedJs = beautify.js(parsedResponse["JavaScript Code"] || "", { indent_size: 2 });

    res.json({
      message: gptResponse,
      htmlCode: formattedHtml,
      cssCode: formattedCss,
      jsCode: formattedJs,
    });
  } catch (error) {
    console.error("Error communicating with OpenAI:", error.message);
    res.status(500).json({ error: "Failed to generate code" });
  }
});

// Chatbot for RightPanel with UI/UX Suggestions & Code Editing Support
app.post("/chat", async (req, res) => {
  const { message, htmlCode, cssCode, jsCode } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Step 1: Determine Request Type
    const instructionPrompt = `
      User Message: "${message}"
      
      Carefully analyze this request. Does it require:
      - "CODE_UPDATE" → If the user asks to modify or generate HTML, CSS, or JavaScript.
      - "UX_SUGGESTION" → If the user asks for UI/UX improvement ideas (e.g., "How can I improve my design?").
      - "NORMAL_CHAT" → If it is a general conversation.

      Your response must be exactly one of these three words: "CODE_UPDATE", "UX_SUGGESTION", or "NORMAL_CHAT".
    `;

    const instructionCheck = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: instructionPrompt }],
      max_tokens: 5,
      temperature: 0.3,
    });

    const responseType = instructionCheck.choices[0].message.content.trim().toUpperCase();

    if (responseType === "CODE_UPDATE") {
      // Step 2: Modify Code Based on User Request
      const modifyCodePrompt = `
        Modify the following code based on the user request:
        - HTML: ${htmlCode}
        - CSS: ${cssCode}
        - JavaScript: ${jsCode}
        
        User Request: "${message}"
        
        Ensure the response is in **valid JSON** format:
        {{
          "HTML Code": "<updated html>",
          "CSS Code": "<updated css>",
          "JavaScript Code": "<updated javascript>"
        }}
      `;

      const modificationResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: modifyCodePrompt }],
        max_tokens: 1000,
        temperature: 0.7,
      });

      const modifiedCode = modificationResponse.choices[0].message.content.trim();

      try {
        const parsedCode = JSON.parse(modifiedCode);
        return res.json({
          reply: JSON.stringify(
            {
              htmlCode: parsedCode["HTML Code"] || htmlCode,
              cssCode: parsedCode["CSS Code"] || cssCode,
              jsCode: parsedCode["JavaScript Code"] || jsCode,
            },
            null,
            2
          ),
          updateCode: true,
          isTextResponse: false,
        });
        
      } catch (jsonError) {
        console.error("Error parsing modified code:", jsonError);
        return res.json({ reply: "Error processing code modification request.", updateCode: false });
      }
    } else if (responseType === "UX_SUGGESTION" || responseType === "NORMAL_CHAT") {
      // Step 3: Handle UX Suggestions and Normal Chat using Gemini
      const geminiResponse = await fetchGeminiResponse(message);

      return res.json({
        reply: geminiResponse,
        updateCode: false,
        isTextResponse: true,
      });
    }

  } catch (error) {
    console.error("OpenAI API Error:", error.message);
    res.status(500).json({ error: "Failed to fetch AI response" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
