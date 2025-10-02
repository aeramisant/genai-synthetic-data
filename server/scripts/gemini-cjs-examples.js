require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
const GOOGLE_GENAI_USE_VERTEXAI =
  process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';

async function generateContentFromMLDev() {
  const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
  const result = await model.generateContent('why is the sky blue?');
  console.debug(result.response.text());
}

async function generateContentFromVertexAI() {
  const ai = new GoogleGenerativeAI({
    vertexai: true,
    project: GOOGLE_CLOUD_PROJECT,
    location: GOOGLE_CLOUD_LOCATION,
  });
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
  const result = await model.generateContent('why is the sky blue?');
  console.debug(result.response.text());
}

async function main() {
  if (GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    await generateContentFromVertexAI().catch((e) =>
      console.error('got error', e)
    );
  } else {
    await generateContentFromMLDev().catch((e) =>
      console.error('got error', e)
    );
  }
}

main();

/*
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function main() {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  try {
    const result = await model.generateContent('Why is sky blue?');
    console.log(result.response.text());
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
*/
