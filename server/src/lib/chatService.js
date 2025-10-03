import { GoogleGenerativeAI } from '@google/generative-ai';

class ChatService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    });
  }

  async generateResponse(message) {
    try {
      const result = await this.model.generateContent(message);
      return result.response.text();
    } catch (error) {
      console.error('Error generating chat response:', error);
      throw error;
    }
  }

  async testDDLUnderstanding(ddl) {
    try {
      const prompt = `You are a database expert. Analyze this DDL schema and explain:
1. What tables exist and their purposes
2. Key relationships between tables
3. Any potential data validation rules you notice

Schema DDL:
${ddl}`;

      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Error testing DDL understanding:', error);
      throw error;
    }
  }

  async testDataGeneration(schema, tableName, count = 5) {
    try {
      // Build foreign key context information
      let fkContext = '';
      if (tableName === 'Books' && schema.tables['Authors']) {
        fkContext =
          '\nAvailable Authors:\n' +
          `1. Jane Austen (British) - Known for: Pride and Prejudice, Sense and Sensibility\n` +
          `2. Gabriel Garcia Marquez (Colombian) - Known for: One Hundred Years of Solitude, Love in the Time of Cholera\n` +
          `3. Haruki Murakami (Japanese) - Known for: Norwegian Wood, Kafka on the Shore\n` +
          `4. Chimamanda Ngozi Adichie (Nigerian) - Known for: Purple Hibiscus, Half of a Yellow Sun\n` +
          `5. Stephen King (American) - Known for: The Shining, It\n`;
      }

      const prompt = `You are a data generation expert. Generate ${count} rows of realistic test data for the following table.

Table Schema:
${JSON.stringify(schema.tables[tableName], null, 2)}
${fkContext}
Requirements:
1. Follow all NOT NULL constraints
2. Generate realistic and diverse data
3. Return ONLY a JSON array of records
4. For any foreign key fields, use ONLY values between 1-5, as only these IDs exist in referenced tables
5. For books, match authors with their actual works or plausible titles in their style

Response format example:
[
  { "column1": "value1", "column2": "value2" },
  ...
]
`;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();

      // Clean up response to ensure it's valid JSON
      const cleanJson = text.replace(/```json\n|```/g, '').trim();
      return {
        rawResponse: text,
        data: JSON.parse(cleanJson),
      };
    } catch (error) {
      console.error('Error testing data generation:', error);
      throw error;
    }
  }
}

export default ChatService;
