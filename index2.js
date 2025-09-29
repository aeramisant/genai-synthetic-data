import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
